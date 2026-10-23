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
const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'subagent-profiles-test-'));
const previous = process.env.PI_CODING_AGENT_DIR;
const previousArgv = process.argv[1];
process.env.PI_CODING_AGENT_DIR = temporary;
const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
let count = 0;
const checked = (label, fn) => { fn(); console.log(`ok ${++count}: ${label}`); };
try {
  const picker = await jiti.import(path.join(root, 'model-picker.ts'));
  const profiles = await jiti.import(path.join(root, 'session-profiles.ts'));
  const { SessionManager } = await jiti.import(path.join(host, 'dist/index.js'));
  const { discoverAgents } = await jiti.import(path.join(root, 'agents.ts'));
  fs.mkdirSync(path.join(temporary, 'agents'));
  for (const [name, model] of [['explore', 'old/model:low'], ['worker', 'old/model:medium'], ['defaults', 'old/model']]) {
    fs.writeFileSync(path.join(temporary, 'agents', `${name}.md`), `---\nname: ${name}\ndescription: Test\nmodel: ${model}\n---\nTest.\n`);
  }
  const config = picker.preferencesPath();
  fs.writeFileSync(config, JSON.stringify({ version: 2, agents: { worker: { model: 'old/model', thinking: 'high' } } }));
  const original = fs.readFileSync(config, 'utf8');
  const muse = { provider: 'openrouter', id: 'meta/muse-spark-1.3-contributor', name: 'Meta: Muse Spark 1.3 Contributor', reasoning: true };
  let models = [muse, { provider: 'old', id: 'model', reasoning: true }, { provider: 'openai', id: 'gpt-6.1-sol', reasoning: true }, { provider: 'deepseek', id: 'deepseek-v4.1-flash', reasoning: true }];
  const agents = () => discoverAgents(temporary, 'user').agents;
  function runtime(manager = SessionManager.inMemory(temporary), ui = true) {
    const commands = {}, notices = [];
    const ctx = { cwd: temporary, mode: ui ? 'rpc' : 'print', hasUI: ui, sessionManager: manager,
      modelRegistry: { refresh: async () => {}, getAll: () => models, getAvailable: () => models },
      ui: { notify: (text, level) => notices.push({ text, level }), select: () => assert.fail('Profiles need no dialogs') } };
    picker.registerModelPicker({ registerCommand: (name, value) => { commands[name] = value; }, appendEntry: (type, data) => manager.appendCustomEntry(type, data) });
    const run = async (name, args = '') => { await commands[name].handler(args, ctx); return notices.at(-1)?.text; };
    const effective = () => picker.applyModelPreferences(agents(), picker.effectivePreferences(ctx, agents()).preferences, models);
    return { commands, ctx, manager, run, effective, notices };
  }
  // First case is the requested Muse switch with the same thinking levels.
  const a = runtime();
  await a.run('subagent-profile', 'muse');
  checked('Muse uses actual provider ID and preserves saved/suffix/default thinking', () => {
    const result = a.effective();
    assert.equal(result.find(x => x.name === 'worker').thinking, 'high');
    assert.equal(result.find(x => x.name === 'explore').thinking, 'low');
    assert.equal(result.find(x => x.name === 'defaults').thinking, undefined);
    assert(result.every(x => x.model === 'openrouter/meta/muse-spark-1.3-contributor'));
    assert.equal(fs.readFileSync(config, 'utf8'), original);
    assert.equal(a.notices.at(-1).level, 'info');
  });
  const b = runtime();
  checked('parallel sessions in same directory do not inherit marker', () => {
    assert.equal(b.effective().find(x => x.name === 'worker').model, 'old/model');
  });
  const list = await a.run('subagent-model', 'list');
  checked('list shows effective Muse choices and session source', () => {
    assert.match(list, /worker — openrouter\/meta\/muse-spark-1.3-contributor \| thinking: high \| source: session profile \(muse\)/);
  });
  const reloaded = runtime(a.manager);
  checked('new extension instance restores marker without cached memory', () => assert.deepEqual(reloaded.effective(), a.effective()));
  const museEntry = a.manager.getLeafId();
  await a.run('subagent-profile', 'gpt');
  const gptEntry = a.manager.getLeafId();
  checked('profile switch works; latest snapshot wins', () => assert(a.effective().every(x => x.model === 'openai/gpt-6.1-sol')));
  a.manager.branch(museEntry);
  checked('tree navigation ignores newer abandoned GPT branch', () => assert(a.effective().every(x => x.model.startsWith('openrouter/'))));
  await a.run('subagent-profile', 'clear');
  checked('clear writes reset marker, restores globals and leaves history intact', () => {
    assert.equal(a.effective().find(x => x.name === 'worker').model, 'old/model');
    assert.equal(profiles.readSessionProfile(a.ctx), undefined);
    assert.equal(fs.readFileSync(config, 'utf8'), original);
    assert(a.manager.getEntries().some(e => e.id === gptEntry));
  });
  a.manager.branch(museEntry);
  checked('branch before clear retains Muse', () => assert.equal(profiles.readSessionProfile(a.ctx).profile, 'muse'));
  a.manager.createBranchedSession(museEntry);
  checked('fork inherits marker on copied ancestry', () => {
    assert(a.effective().every(x => x.model.startsWith('openrouter/')));
  });
  const project = { ...agents()[0], source: 'project', model: 'project/pinned', thinking: 'medium' };
  checked('project agent never overridden', () => assert.deepEqual(picker.applyModelPreferences([project], picker.effectivePreferences(a.ctx, [project]).preferences, models), [project]));
  checked('literal colon model ID is not mistaken for thinking', () => {
    const snapshot = profiles.createProfileMarker('muse', muse, [{ ...agents()[0], model: 'local/coder:low', thinking: undefined }], [{ provider: 'local', id: 'coder:low', reasoning: true }]);
    assert.equal(Object.values(snapshot.assignments)[0].thinking, undefined);
  });
  const savedSet = await a.run('subagent-model', 'set worker openai/gpt-6.1-sol:medium');
  checked('legacy set warns that session wins and does not change snapshot', () => {
    assert.match(savedSet, /Session profile 'muse' still takes precedence/);
    assert.equal(a.effective().find(x => x.name === 'worker').thinking, 'high');
  });
  fs.writeFileSync(config, original);
  const beforeInvalid = a.manager.getEntries().length;
  await a.run('subagent-profile', 'missing');
  checked('unknown profile leaves marker untouched', () => assert.equal(a.manager.getEntries().length, beforeInvalid));
  models = [{ ...muse, thinkingLevelMap: { low: null } }, ...models.slice(1)];
  await a.run('subagent-profile', 'muse');
  checked('unsupported thinking rejects whole activation, no clamp', () => {
    assert.equal(a.manager.getEntries().length, beforeInvalid);
    assert.match(a.notices.at(-1).text, /does not support thinking 'low'/);
  });
  models = [muse, { ...muse, provider: 'other' }, ...models.slice(1)];
  await a.run('subagent-profile', 'muse');
  checked('ambiguous providers reject rather than choosing arbitrarily', () => {
    assert.equal(a.manager.getEntries().length, beforeInvalid);
    assert.match(a.notices.at(-1).text, /ambiguous/);
  });
  models = models.slice(2);
  await a.run('subagent-profile', 'muse');
  checked('unavailable model never saved as literal name', () => assert.equal(a.manager.getEntries().length, beforeInvalid));
  checked('saved unsupported model blocks spawn resolution rather than falling back', () => assert.throws(() => a.effective(), /No automatic thinking escalation/));
  models = [muse, ...models];
  // A disk-backed session needs a first assistant message before Pi flushes it.
  const disk = SessionManager.create(temporary, path.join(temporary, 'sessions'));
  disk.appendMessage({ role: 'assistant', content: [{ type: 'text', text: 'fixture' }], api: 'test', provider: 'test', model: 'test', usage: {}, stopReason: 'stop', timestamp: Date.now() });
  const persisted = runtime(disk);
  await persisted.run('subagent-profile', 'muse');
  const sessionFile = disk.getSessionFile();
  checked('disk reopen (resume/continue path) restores assignments', () => {
    assert(fs.existsSync(sessionFile));
    assert.deepEqual(runtime(SessionManager.open(sessionFile)).effective(), persisted.effective());
  });
  const leaf = disk.getLeafId();
  disk.appendCompaction('summary', leaf, 100);
  checked('compaction retains raw marker ancestry', () => assert.equal(profiles.readSessionProfile(persisted.ctx).profile, 'muse'));
  checked('custom profile metadata is excluded from model context', () => assert(!JSON.stringify(disk.buildSessionContext().messages).includes('assignments')));
  const print = runtime(undefined, false);
  const oldWrite = process.stderr.write;
  let printed = '';
  process.stderr.write = text => { printed += text; return true; };
  try { await print.run('subagent-profile', 'muse'); } finally { process.stderr.write = oldWrite; }
  checked('headless command uses stderr without UI calls', () => assert.match(printed, /Session profile: muse/));
  // Profile definitions and default selection are optional, and legacy setters preserve them.
  fs.writeFileSync(config, JSON.stringify({ version: 2, agents: {}, profiles: { fallback: 'openai/gpt-6.1-sol' }, defaultProfile: 'fallback' }));
  await picker.savePreference('worker', { model: 'old/model', thinking: 'medium' });
  checked('legacy setter preserves profile definitions/default', () => assert.equal(JSON.parse(fs.readFileSync(config)).defaultProfile, 'fallback'));
  const fresh = runtime();
  checked('new session uses configured default profile', () => assert(fresh.effective().every(x => x.model === 'openai/gpt-6.1-sol')));
  await fresh.run('subagent-profile', 'muse');
  await fresh.run('subagent-profile', 'clear');
  checked('clear returns to configured default', () => assert(fresh.effective().every(x => x.model === 'openai/gpt-6.1-sol')));
  // Fake child process captures actual arguments in all spawn modes.
  const factory = await jiti.import(path.join(root, 'index.ts'), { default: true });
  let tool;
  factory({ registerCommand: () => {}, registerTool: x => { tool = x; } });
  const fixture = path.join(temporary, 'fake-pi.mjs');
  fs.writeFileSync(fixture, `console.log(JSON.stringify({type:'message_end',message:{role:'assistant',content:[{type:'text',text:JSON.stringify(process.argv.slice(2))}],stopReason:'stop'}}));`);
  process.argv[1] = fixture;
  for (const [mode, params] of [['single', { agent: 'worker', task: 'test' }], ['parallel', { tasks: [{ agent: 'worker', task: 'test' }] }], ['chain', { chain: [{ agent: 'worker', task: 'test' }] }]]) {
    const result = await tool.execute('test', params, undefined, undefined, persisted.ctx);
    checked(`${mode} real child receives Muse model and original high thinking`, () => {
      assert(!result.isError);
      const args = JSON.parse(result.details.results[0].messages.at(-1).content[0].text);
      assert.equal(args[args.indexOf('--model') + 1], 'openrouter/meta/muse-spark-1.3-contributor');
      assert.equal(args[args.indexOf('--thinking') + 1], 'high');
    });
  }
  a.manager.appendCustomEntry(profiles.PROFILE_ENTRY, { version: 99 });
  checked('invalid marker fails visibly', () => assert.throws(() => a.effective(), /Invalid session profile/));
  await a.run('subagent-profile', 'clear');
  checked('clear recovers invalid marker', () => assert.doesNotThrow(() => a.effective()));
  // The repository deliberately loads a tracked local fork instead of package code.
  const local = await jiti.import(path.resolve(root, '../../.pi/extensions/subagent/model-picker.ts'));
  const localConfig = local.preferencesPath();
  const localBefore = fs.existsSync(localConfig) ? fs.readFileSync(localConfig, 'utf8') : undefined;
  const localBaseline = local.applyModelPreferences(agents(), undefined, [], new Set());
  const localManager = SessionManager.inMemory(temporary);
  const localCtx = { ...a.ctx, sessionManager: localManager };
  const localCommands = {};
  local.registerModelPicker({ registerCommand: (name, value) => { localCommands[name] = value; }, appendEntry: (type, data) => localManager.appendCustomEntry(type, data) });
  await localCommands['subagent-profile'].handler('muse', localCtx);
  const localPrefs = local.effectivePreferences(localCtx, agents()).preferences;
  checked('tracked project fork supports Muse with unchanged project thinking', () => {
    const result = local.applyModelPreferences(agents(), localPrefs, models);
    assert(result.every(x => x.model === 'openrouter/meta/muse-spark-1.3-contributor'));
    assert.deepEqual(result.map(x => x.thinking), localBaseline.map(x => x.thinking));
    assert.match(a.notices.at(-1).text, /Session profile: muse/);
    assert.equal(fs.existsSync(localConfig) ? fs.readFileSync(localConfig, 'utf8') : undefined, localBefore);
  });
  const localFactory = await jiti.import(path.resolve(root, '../../.pi/extensions/subagent/index.ts'), { default: true });
  let localTool;
  localFactory({ registerCommand: () => {}, registerTool: x => { localTool = x; } });
  const localResult = await localTool.execute('test', { agent: 'worker', task: 'test' }, undefined, undefined, localCtx);
  checked('project fork spawn uses session profile', () => {
    assert(!localResult.isError);
    const args = JSON.parse(localResult.details.results[0].messages.at(-1).content[0].text);
    assert.equal(args[args.indexOf('--model') + 1], 'openrouter/meta/muse-spark-1.3-contributor');
    assert.equal(args[args.indexOf('--thinking') + 1], localBaseline.find(x => x.name === 'worker').thinking);
  });
  await localCommands['subagent-profile'].handler('clear', localCtx);
  checked('project fork clear restores unchanged defaults', () => assert.deepEqual(local.applyModelPreferences(agents(), local.effectivePreferences(localCtx, agents()).preferences, [], new Set()), localBaseline));
  console.log(`PASS: ${count} session profile checks (no provider requests).`);
} finally {
  process.argv[1] = previousArgv;
  if (previous === undefined) delete process.env.PI_CODING_AGENT_DIR; else process.env.PI_CODING_AGENT_DIR = previous;
  fs.rmSync(temporary, { recursive: true, force: true });
}
