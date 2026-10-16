import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const host = process.env.PI_TEST_HOST || path.join(execSync('npm root -g', { encoding: 'utf8' }).trim(), '@earendil-works/pi-coding-agent');
const require = createRequire(path.join(host, 'package.json'));
const { createJiti } = require('jiti');
const alias = {
  '@earendil-works/pi-coding-agent': path.join(host, 'dist/index.js'),
  '@earendil-works/pi-ai': path.join(host, 'node_modules/@earendil-works/pi-ai/dist/compat.js'),
  '@earendil-works/pi-agent-core': path.join(host, 'node_modules/@earendil-works/pi-agent-core/dist/index.js'),
  '@earendil-works/pi-tui': path.join(host, 'node_modules/@earendil-works/pi-tui/dist/index.js'),
  typebox: require.resolve('typebox'),
};
const jiti = createJiti(import.meta.url, { alias, moduleCache: false });
const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'subagent-references-test-'));
const previous = process.env.PI_CODING_AGENT_DIR;
const previousArgv = process.argv[1];
process.env.PI_CODING_AGENT_DIR = temporary;
const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
let count = 0;
const checked = (label, fn) => { fn(); count++; console.log(`ok ${count}: ${label}`); };
try {
  const agentsDir = path.join(temporary, 'agents');
  fs.mkdirSync(agentsDir);
  const define = (name, references) => fs.writeFileSync(path.join(agentsDir, `${name}.md`), `---\nname: ${name}\ndescription: Test agent\n${references === undefined ? '' : `references: ${references}\n`}---\nOriginal instructions.\n`);
  const reference = (name, body) => fs.writeFileSync(path.join(agentsDir, name), body);
  reference('one,ref.md', '---\nsecret: hidden-frontmatter\n---\nFirst reference body.\n');
  reference('two.md', 'Second reference body.\n');
  fs.writeFileSync(path.join(temporary, 'external.md'), 'External reference body.\n');
  define('scalar', '"  one,ref.md  "');
  define('ordered', '\n  - two.md\n  - ""\n  - 42\n  - false\n  - "  one,ref.md  "\n  - null');
  define('external', '../external.md');
  define('missing', '\n  - two.md\n  - absent.md');
  define('absolute', JSON.stringify(path.join(agentsDir, 'two.md')));
  define('url', 'https://example.com/ref.md');
  define('home', '~/ref.md');
  define('directory', '.');
  fs.symlinkSync(path.join(agentsDir, 'two.md'), path.join(agentsDir, 'alias.md'));
  define('duplicates', '\n  - two.md\n  - ./two.md\n  - alias.md');
  define('plain');
  define('empty', '[]');
  fs.writeFileSync(path.join(agentsDir, 'parked.md'), '---\nname: parked\ndescription: Parked agent\ndisabled: true\n---\nParked.\n');
  fs.writeFileSync(path.join(agentsDir, 'active.md'), '---\nname: active\ndescription: Active agent\n---\nActive.\n');

  const discovery = await jiti.import(path.join(root, 'agents.ts'));
  const discovered = discovery.discoverAgents(temporary, 'user').agents;
  checked('discovery trims scalar without comma splitting and filters list metadata', () => {
    assert.deepEqual(discovered.find(a => a.name === 'scalar').references, ['one,ref.md']);
    assert.deepEqual(discovered.find(a => a.name === 'ordered').references, ['two.md', 'one,ref.md']);
    assert(discovered.some(a => a.name === 'missing'));
  });
  checked('disabled agents are hidden from discovery', () => {
    assert(!discovered.some(a => a.name === 'parked'));
    assert(discovered.some(a => a.name === 'active'));
  });
  const factory = await jiti.import(path.join(root, 'index.ts'), { default: true });
  let tool;
  factory({ registerCommand: () => {}, registerTool: value => { tool = value; } });
  const fixture = path.join(temporary, 'fake-pi.mjs');
  const spawns = path.join(temporary, 'spawns.log');
  fs.writeFileSync(fixture, `import fs from 'node:fs';
const args = process.argv.slice(2);
fs.appendFileSync(${JSON.stringify(spawns)}, 'spawn\\n');
const promptPath = args[args.indexOf('--append-system-prompt') + 1];
const prompt = args.includes('--append-system-prompt') ? fs.readFileSync(promptPath, 'utf8') : null;
console.log(JSON.stringify({type:'message_end',message:{role:'assistant',content:[{type:'text',text:JSON.stringify({args,prompt,promptPath})}],stopReason:'stop'}}));`);
  process.argv[1] = fixture;
  const ctx = { cwd: temporary, hasUI: false, modelRegistry: { getAvailable: () => [], getAll: () => [], refresh: async () => {} } };
  const execute = params => tool.execute('test', params, undefined, undefined, ctx);
  const run = agent => execute({ agent, task: 'test' });
  const childOutput = result => {
    assert(!result.isError, JSON.stringify(result));
    const child = result.details.results[0];
    assert.equal(child.exitCode, 0);
    const output = JSON.parse(child.messages.at(-1).content[0].text);
    assert(output.args.includes('--append-system-prompt'));
    assert(!fs.existsSync(output.promptPath), 'temporary prompt is cleaned up after spawn');
    return output.prompt;
  };
  const scalar = childOutput(await run('scalar'));
  checked('scalar reference is child-visible with frontmatter stripped', () => {
    assert(scalar.startsWith('Original instructions.'));
    assert(scalar.includes('## Preloaded references\nThese references are already loaded into your context. Do not read them with a tool.\n\n'));
    assert(scalar.includes('### Reference: one,ref.md\nFirst reference body.'));
    assert(!scalar.includes('hidden-frontmatter'));
  });
  const ordered = childOutput(await run('ordered'));
  checked('YAML list preserves declaration order', () => assert(ordered.indexOf('Second reference body.') < ordered.indexOf('First reference body.')));
  const external = childOutput(await run('external'));
  checked('parent-relative reference may resolve outside agents directory', () => assert(external.includes('### Reference: ../external.md\nExternal reference body.')));
  const duplicates = childOutput(await run('duplicates'));
  checked('canonical duplicate targets retain only first heading/body', () => {
    assert.equal(duplicates.match(/Second reference body\./g).length, 1);
    assert(duplicates.includes('### Reference: two.md'));
    assert(!duplicates.includes('### Reference: ./two.md'));
    assert(!duplicates.includes('### Reference: alias.md'));
  });
  for (const name of ['plain', 'empty']) {
    const prompt = childOutput(await run(name));
    checked(`${name} references preserve exact original prompt`, () => assert.equal(prompt, discovered.find(a => a.name === name).systemPrompt));
  }
  const spawnCount = () => fs.readFileSync(spawns, 'utf8').trim().split('\n').length;
  for (const [name, declared, cause] of [
    ['missing', 'absent.md', 'ENOENT'],
    ['absolute', path.join(agentsDir, 'two.md'), 'relative file path'],
    ['url', 'https://example.com/ref.md', 'relative file path'],
    ['home', '~/ref.md', 'relative file path'],
    ['directory', '.', 'not a regular file'],
  ]) {
    const before = spawnCount();
    const result = await run(name);
    checked(`${name} reference hard-fails before spawn with diagnostic paths`, () => {
      assert.equal(result.isError, true);
      const child = result.details.results[0];
      assert.equal(child.exitCode, 1);
      assert.deepEqual(child.messages, []);
      assert(child.stderr.includes(`Agent "${name}"`));
      assert(child.stderr.includes(`reference "${declared}"`));
      assert(child.stderr.includes(`base: "${fs.realpathSync(agentsDir)}"`));
      assert(child.stderr.includes(`resolved path: "${path.resolve(fs.realpathSync(agentsDir), declared)}"`));
      assert(child.stderr.includes(cause));
      assert.equal(spawnCount(), before);
    });
  }
  const beforeChain = spawnCount();
  const chain = await execute({ chain: [{ agent: 'missing', task: 'fail' }, { agent: 'scalar', task: 'not reached' }] });
  checked('reference failure stops chains', () => {
    assert.equal(chain.isError, true);
    assert.equal(chain.details.results.length, 1);
    assert.equal(spawnCount(), beforeChain);
  });
  const parallel = await execute({ tasks: [{ agent: 'missing', task: 'fail' }, { agent: 'scalar', task: 'success' }] });
  checked('parallel siblings still report success and failure', () => {
    assert.deepEqual(parallel.details.results.map(r => r.exitCode), [1, 0]);
    assert.equal(spawnCount(), beforeChain + 1);
  });

  // Directory and individual file symlinks must resolve relative to the actual definition.
  const actualRoot = path.join(temporary, 'actual');
  fs.mkdirSync(actualRoot);
  fs.renameSync(agentsDir, path.join(actualRoot, 'agents'));
  fs.symlinkSync(path.join(actualRoot, 'agents'), agentsDir, 'dir');
  fs.writeFileSync(path.join(actualRoot, 'external.md'), 'Real directory reference body.\n');
  const symlinkedDir = childOutput(await run('external'));
  checked('symlinked agents directory uses real definition base', () => {
    assert(symlinkedDir.includes('Real directory reference body.'));
    assert(!symlinkedDir.includes('External reference body.'));
  });
  const definitionDir = path.join(temporary, 'definitions');
  fs.mkdirSync(definitionDir);
  fs.writeFileSync(path.join(definitionDir, 'linked.md'), '---\nname: linked\ndescription: Linked agent\nreferences: ./local.md\n---\nLinked instructions.\n');
  fs.writeFileSync(path.join(definitionDir, 'local.md'), 'Individual symlink reference body.\n');
  fs.symlinkSync(path.join(definitionDir, 'linked.md'), path.join(agentsDir, 'linked.md'));
  const linked = childOutput(await run('linked'));
  checked('individual agent file symlink uses canonical parent directory', () => assert(linked.includes('Individual symlink reference body.')));
  console.log(`PASS: ${count} checks; metadata discovery + real child-process preloaded prompt tests.`);
} finally {
  process.argv[1] = previousArgv;
  if (previous === undefined) delete process.env.PI_CODING_AGENT_DIR;
  else process.env.PI_CODING_AGENT_DIR = previous;
  fs.rmSync(temporary, { recursive: true, force: true });
}
