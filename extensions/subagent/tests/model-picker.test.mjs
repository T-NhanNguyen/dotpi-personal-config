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
const dependency = (name, file) => {
  const found = require.resolve.paths(name).map(dir => path.join(dir, name, file)).find(file => fs.existsSync(file));
  if (!found) throw new Error(`Cannot find test dependency ${name}/${file}`);
  return found;
};
const alias = {
  '@earendil-works/pi-coding-agent': path.join(host, 'dist/index.js'),
  '@earendil-works/pi-ai': dependency('@earendil-works/pi-ai', 'dist/compat.js'),
  '@earendil-works/pi-agent-core': dependency('@earendil-works/pi-agent-core', 'dist/index.js'),
  '@earendil-works/pi-tui': dependency('@earendil-works/pi-tui', 'dist/index.js'),
  typebox: require.resolve('typebox'),
};
const jiti = createJiti(import.meta.url, { alias, moduleCache: false });
const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'subagent-picker-test-'));
const previous = process.env.PI_CODING_AGENT_DIR;
const previousArgv = process.argv[1];
process.env.PI_CODING_AGENT_DIR = temporary;
const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
let count = 0;
const checked = (label, fn) => { fn(); count++; console.log(`ok ${count}: ${label}`); };
try {
  fs.mkdirSync(path.join(temporary, 'agents'));
  for (const name of ['explore', 'worker']) fs.writeFileSync(path.join(temporary, 'agents', `${name}.md`), `---\nname: ${name}\ndescription: Test agent\nmodel: old/model\n---\nRead only.\n`);
  const module = await jiti.import(path.join(root, 'model-picker.ts'));
  const config = module.preferencesPath();
  const models = [
    { provider: 'p', id: 'a', name: 'Fast reasoner', reasoning: true },
    { provider: 'q', id: 'a', name: 'Plain chat', reasoning: false },
    { provider: 'p', id: 'restricted', name: 'Restricted reasoner', reasoning: true, thinkingLevelMap: { low: null, off: null } },
    { provider: 'local', id: 'coder:7b', name: 'Local coder', reasoning: true },
    { provider: 'p', id: 'literal', name: 'Suffix collision base', reasoning: true },
    { provider: 'p', id: 'literal:low', name: 'Literal colon model', reasoning: false },
  ];
  const agent = { name: 'explore', source: 'user', model: 'old/model' };
  checked('missing config', () => assert.equal(Object.keys(module.readPreferences()).length, 0));
  const legacy = JSON.stringify({ version: 1, agents: { explore: null, worker: 'p/a' } });
  fs.writeFileSync(config, legacy);
  checked('legacy migration in memory only', () => {
    assert.deepEqual(module.readPreferences().explore, { model: null });
    assert.deepEqual(module.readPreferences().worker, { model: 'p/a' });
    assert.equal(fs.readFileSync(config, 'utf8'), legacy);
  });
  await module.savePreference('explore', { model: 'p/a', thinking: 'low' });
  checked('explicit thinking with nonmutating resolution', () => {
    assert.equal(JSON.parse(fs.readFileSync(config)).version, 2);
    const effective = module.applyModelPreferences([agent], undefined, models)[0];
    assert.equal(effective.model, 'p/a');
    assert.equal(effective.thinking, 'low');
    assert.equal(agent.model, 'old/model');
    assert.deepEqual(module.agentModelArgs(effective), ['--model', 'p/a', '--thinking', 'low']);
    assert.equal(module.readPreferences().worker.model, 'p/a');
  });
  checked('project agents unaffected', () => assert.equal(module.applyModelPreferences([{ ...agent, source: 'project' }], undefined, models)[0].model, 'old/model'));
  await module.savePreference('explore', { model: 'p/restricted', thinking: 'low' });
  checked('unsupported level blocks, never clamps upward', () => assert.throws(() => module.applyModelPreferences([agent], undefined, models), /No automatic thinking escalation/));
  checked('unrequested agent does not block other work', () => assert.doesNotThrow(() => module.applyModelPreferences([agent], undefined, models, new Set(['worker']))));
  await module.savePreference('explore', { model: 'missing/model', thinking: 'low' });
  checked('missing fixed model with thinking blocks', () => assert.throws(() => module.applyModelPreferences([agent], undefined, models), /choose again/));
  await module.savePreference('explore', null);
  checked('pi default clears model and thinking', () => assert.deepEqual(module.agentModelArgs(module.applyModelPreferences([agent])[0]), []));
  await module.savePreference('explore', undefined);
  checked('reset restores definition', () => assert.equal(module.applyModelPreferences([agent])[0].model, 'old/model'));
  await Promise.all([module.savePreference('one', 'p/a'), module.savePreference('two', 'q/a')]);
  checked('concurrent preference writes preserve both', () => { assert.equal(module.readPreferences().one.model, 'p/a'); assert.equal(module.readPreferences().two.model, 'q/a'); });

  let command;
  module.registerModelPicker({ registerCommand(name, definition) { if (name === 'subagent-model') command = definition; } });
  let replies = [], inputs = [], dialogs = [], notices = [], refreshes = 0;
  const ctx = {
    cwd: temporary, hasUI: true,
    modelRegistry: { getAvailable: () => models, getAll: () => models, refresh: async () => { refreshes++; } },
    get thinkingLevel() { assert.fail('Must not read parent thinking'); },
    get model() { assert.fail('Must not read parent model'); },
    ui: {
      notify: (...args) => notices.push(args),
      select: async (title, options) => {
        dialogs.push({ title, options });
        const reply = replies.shift();
        return typeof reply === 'function' ? reply(options) : reply;
      },
      input: async () => inputs.shift(),
    },
  };
  const flow = async (selections, text = [], name = 'explore') => {
    replies = [...selections]; inputs = [...text]; dialogs = []; notices = [];
    await command.handler(name, ctx);
    assert.equal(replies.length, 0);
  };
  for (const [label, selections, text, name] of [
    ['agent dialog cancellation', [undefined], [], ''],
    ['model dialog cancellation', [undefined], [], 'explore'],
    ['search input cancellation', ['Search models…'], [undefined], 'explore'],
    ['thinking dialog cancellation', ['p/a', undefined], [], 'explore'],
  ]) {
    const before = fs.readFileSync(config, 'utf8');
    await flow(selections, text, name);
    checked(label, () => assert.equal(fs.readFileSync(config, 'utf8'), before));
  }
  await flow(['Search models…', 'p/a', 'low'], ['FAST p']);
  checked('case-insensitive multiword search by name/provider', () => {
    assert(dialogs[1].options.includes('p/a'));
    assert(!dialogs[1].options.includes('q/a'));
    assert.deepEqual(module.readPreferences().explore, { model: 'p/a', thinking: 'low' });
    assert(!dialogs[2].options.includes('xhigh'));
  });
  await flow(['Search models…', 'Search models…', 'local/coder:7b', 'minimal'], ['no-such-model', '']);
  checked('empty results remain recoverable and blank clears filter', () => {
    assert(notices.some(([text]) => text.includes('No matching')));
    assert(dialogs[2].options.includes('local/coder:7b'));
    assert.equal(module.readPreferences().explore.thinking, 'minimal');
  });
  await flow(['q/a', 'off']);
  checked('nonreasoning native options', () => assert.deepEqual(dialogs[1].options, ['off', 'Use child thinking defaults (may be high)']));
  await flow(['p/restricted', 'medium']);
  checked('model-specific unsupported levels excluded', () => { assert(!dialogs[1].options.includes('low')); assert(!dialogs[1].options.includes('off')); });
  await flow([options => options.find(value => value.startsWith('explore —')), undefined], [], '');
  checked('agent labels show model and thinking', () => assert(dialogs[0].options.some(value => value.includes('p/restricted | thinking: medium'))));
  await flow(['p/a', 'Use child thinking defaults (may be high)']);
  checked('child-default thinking is explicit opt-in', () => assert.deepEqual(module.readPreferences().explore, { model: 'p/a' }));
  await flow([options => options.find(value => value.startsWith('Use pi default'))]);
  checked('pi-default model clears independent thinking', () => assert.deepEqual(module.readPreferences().explore, { model: null }));
  await flow([options => options.find(value => value.startsWith('Use agent definition'))]);
  checked('reset removes both preferences', () => assert(!Object.hasOwn(module.readPreferences(), 'explore')));
  const headless = {
    cwd: temporary, hasUI: false, modelRegistry: ctx.modelRegistry,
    ui: {
      notify: () => assert.fail('No-UI must write to stderr'),
      select: () => assert.fail('No-UI must not select'),
      input: () => assert.fail('No-UI must not request input'),
    },
  };
  const runHeadless = async (args, context = headless) => {
    const write = process.stderr.write;
    let output = '';
    process.stderr.write = (text) => { output += text; return true; };
    try { await command.handler(args, context); }
    finally { process.stderr.write = write; }
    return output;
  };
  const beforeList = fs.readFileSync(config, 'utf8');
  const listed = await runHeadless('list');
  checked('headless list shows definition/default and saved sources without writing', () => {
    assert.match(listed, /explore — old\/model \| thinking: child defaults \| source: definition\/default \(default\)/);
    assert.match(listed, /worker — p\/a \| thinking: child defaults \| source: saved override/);
    assert.equal(fs.readFileSync(config, 'utf8'), beforeList);
  });
  const aliasList = await runHeadless(' ls ');
  checked('ls alias', () => assert.equal(aliasList, listed));
  await flow([], [], 'list');
  checked('UI list uses info output without dialogs', () => {
    assert.equal(dialogs.length, 0);
    assert.equal(notices.at(-1)[1], 'info');
    assert.equal(notices.at(-1)[0], listed.trimEnd());
  });
  const saved = await runHeadless('  set   explore   p/a:low  ');
  checked('headless set saves model and thinking atomically', () => {
    assert.deepEqual(module.readPreferences().explore, { model: 'p/a', thinking: 'low' });
    assert.equal(module.readPreferences().worker.model, 'p/a');
    assert.match(saved, /explore: p\/a \| thinking: low/);
    assert.match(saved, /future subagent runs; main session unchanged/);
    assert.equal(JSON.parse(fs.readFileSync(config)).version, 2);
  });
  const overrideList = await runHeadless('list');
  checked('list reports saved thinking', () => assert.match(overrideList, /explore — p\/a \| thinking: low \| source: saved override/));
  for (const [requested, expected] of [
    ['local/coder:7b', { model: 'local/coder:7b' }],
    ['local/coder:7b:minimal', { model: 'local/coder:7b', thinking: 'minimal' }],
    ['literal:low', { model: 'p/literal:low' }],
    ['p/literal:low', { model: 'p/literal:low' }],
    ['p/a', { model: 'p/a' }],
  ]) {
    await runHeadless(`set explore ${requested}`);
    checked(`exact IDs and last-colon parsing: ${requested}`, () => assert.deepEqual(module.readPreferences().explore, expected));
  }
  for (const args of ['set explore p/restricted:low', 'set explore q/a:low', 'set explore missing/model', 'set nonexistent p/a', 'set explore', 'set explore p/a extra']) {
    const before = fs.readFileSync(config, 'utf8');
    const output = await runHeadless(args);
    checked(`invalid set does not mutate: ${args}`, () => {
      assert.equal(fs.readFileSync(config, 'utf8'), before);
      assert.match(output, /Unknown|Usage:/);
    });
  }
  for (const args of ['', 'explore']) {
    const output = await runHeadless(args);
    checked(`headless usage plus list: ${JSON.stringify(args)}`, () => {
      assert.match(output, /Usage:/);
      assert.match(output, /explore —/);
    });
  }
  for (const args of ['nonexistent', 'list extra']) {
    const output = await runHeadless(args);
    checked(`unknown command prints usage: ${args}`, () => assert.match(output, /^Usage:/));
  }
  for (const registry of [undefined, { refresh: async () => { throw new Error('unavailable'); } }]) {
    const output = await runHeadless('set explore private/model:low', { ...headless, modelRegistry: registry });
    checked('unavailable headless registry preserves literal unvalidated model', () => {
      assert.deepEqual(module.readPreferences().explore, { model: 'private/model:low' });
      assert.match(output, /not registry-validated/);
    });
  }
  await module.savePreference('explore', null);
  const defaultList = await runHeadless('list');
  checked('saved pi default is an override, not a definition default', () => {
    assert.match(defaultList, /explore — Pi default \| thinking: child defaults \| source: saved override/);
    assert(!defaultList.split('\n').find(line => line.startsWith('explore —')).includes('(default)'));
  });
  await flow([], [], 'set explore p/a:low');
  checked('UI set saves directly without opening dialogs', () => {
    assert.equal(dialogs.length, 0);
    assert.deepEqual(module.readPreferences().explore, { model: 'p/a', thinking: 'low' });
    assert.equal(notices.at(-1)[1], 'info');
  });
  const beforeEmptyRegistry = fs.readFileSync(config, 'utf8');
  const emptyRegistryOutput = await runHeadless('set explore p/a', { ...headless, modelRegistry: { refresh: async () => {}, getAvailable: () => [] } });
  checked('available empty registry rejects instead of skipping validation', () => {
    assert.match(emptyRegistryOutput, /Unknown available model/);
    assert.equal(fs.readFileSync(config, 'utf8'), beforeEmptyRegistry);
  });
  const malformed = await runHeadless('set explore :', { ...headless, modelRegistry: undefined });
  checked('unvalidated model must still be well formed', () => {
    assert.match(malformed, /Invalid model/);
    assert.equal(fs.readFileSync(config, 'utf8'), beforeEmptyRegistry);
  });
  await command.handler('nonexistent', ctx);
  checked('unknown user agent prints usage', () => {
    assert.equal(notices.at(-1)[1], 'info');
    assert.match(notices.at(-1)[0], /Usage:/);
  });
  fs.writeFileSync(config, '{bad json');
  await command.handler('explore', ctx);
  checked('malformed config is not overwritten', () => { assert.equal(fs.readFileSync(config, 'utf8'), '{bad json'); assert.equal(notices.at(-1)[1], 'error'); });
  fs.writeFileSync(config, JSON.stringify({ version: 2, agents: { explore: { model: null, thinking: 'low' } } }));
  checked('thinking without fixed model rejected', () => assert.throws(() => module.readPreferences()));
  fs.unlinkSync(config);

  // Real child process smoke tests use a fake pi script, never a model provider.
  await module.savePreference('explore', { model: 'p/a', thinking: 'low' });
  const factory = await jiti.import(path.join(root, 'index.ts'), { default: true });
  let tool;
  factory({ registerCommand: () => {}, registerTool: value => { tool = value; } });
  const fixture = path.join(temporary, 'fake-pi.mjs');
  fs.writeFileSync(fixture, `console.log(JSON.stringify({type:'message_end',message:{role:'assistant',content:[{type:'text',text:JSON.stringify(process.argv.slice(2))}],stopReason:'stop'}}));`);
  process.argv[1] = fixture;
  for (const [mode, params] of [
    ['single', { agent: 'explore', task: 'test' }],
    ['parallel', { tasks: [{ agent: 'explore', task: 'one' }, { agent: 'explore', task: 'two' }] }],
    ['chain', { chain: [{ agent: 'explore', task: 'one' }, { agent: 'explore', task: 'two {previous}' }] }],
  ]) {
    const result = await tool.execute('test', params, undefined, undefined, ctx);
    checked(`${mode} real process receives explicit model/thinking`, () => {
      assert(!result.isError, JSON.stringify(result));
      assert(result.details.results.length > 0);
      for (const child of result.details.results) {
        assert.equal(child.exitCode, 0);
        const args = JSON.parse(child.messages.at(-1).content[0].text);
        assert.equal(args[args.indexOf('--model') + 1], 'p/a');
        assert.equal(args[args.indexOf('--thinking') + 1], 'low');
      }
    });
  }
  await module.savePreference('explore', { model: 'p/restricted', thinking: 'low' });
  await assert.rejects(() => tool.execute('test', { agent: 'explore', task: 'test' }, undefined, undefined, ctx), /No automatic thinking escalation/);
  count++; console.log(`ok ${count}: invocation rejects stale incompatible preference before spawning`);
  checked('registry refreshed for picker and spawn', () => assert(refreshes > 3));
  console.log(`PASS: ${count} checks; portable mocked dialogs + real child-process CLI smoke tests.`);
} finally {
  process.argv[1] = previousArgv;
  if (previous === undefined) delete process.env.PI_CODING_AGENT_DIR;
  else process.env.PI_CODING_AGENT_DIR = previous;
  fs.rmSync(temporary, { recursive: true, force: true });
}
