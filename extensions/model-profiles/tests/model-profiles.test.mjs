import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const host = (() => {
  const candidates = [
    process.env.PI_TEST_HOST,
    path.join(os.homedir(), '.bun/install/global/node_modules/@earendil-works/pi-coding-agent'),
    path.join(execSync('npm root -g', { encoding: 'utf8' }).trim(), '@earendil-works/pi-coding-agent'),
  ];
  for (const candidate of candidates) {
    if (candidate && fs.existsSync(path.join(candidate, 'package.json'))) return candidate;
  }
  throw new Error('Cannot locate @earendil-works/pi-coding-agent. Set PI_TEST_HOST to its install dir.');
})();
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
const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'model-profiles-test-'));
const previous = process.env.PI_CODING_AGENT_DIR;
process.env.PI_CODING_AGENT_DIR = temporary;
let count = 0;
const checked = async (label, fn) => { await fn(); console.log(`ok ${++count}: ${label}`); };
try {
  const { updateProfiles, example, profileStatus } = await jiti.import(path.join(root, 'store.ts'));
  const factory = await jiti.import(path.join(root, 'index.ts'), { default: true });
  const model = { provider: 'fixture', id: 'literal/model:low', api: 'openai-responses', reasoning: true };
  const target = { provider: model.provider, model: model.id };
  const file = name => path.join(temporary, name);
  const modelsFile = file('models.json'), configFile = file('model-profiles.json'), stateFile = file('model-profiles.state.json');
  const write = (name, value) => fs.writeFileSync(file(name), JSON.stringify(value));
  const read = name => JSON.parse(fs.readFileSync(file(name), 'utf8').replace(/^\uFEFF/, ''));
  const original = { providers: { fixture: { apiKey: 'do-not-expose', baseUrl: 'https://example.invalid', modelOverrides: { [model.id]: { name: 'Keep name', samplingParams: { top_p: 0.91, extra: 'keep' } }, other: { temperature: 1 } } }, unrelated: { apiKey: 'keep-too' } }, custom: { enabled: true } };
  const reset = (config = example(model), models = original) => {
    for (const name of ['models.json', 'model-profiles.json', 'model-profiles.state.json', 'model-profiles.lock']) fs.rmSync(file(name), { force: true });
    write('models.json', models); write('model-profiles.json', config);
  };
  const apply = name => updateProfiles(temporary, name, [model], model);
  const params = () => read('models.json').providers.fixture.modelOverrides[model.id].samplingParams;
  const disk = () => [modelsFile, configFile, stateFile].map(f => fs.existsSync(f) ? fs.readFileSync(f, 'utf8') : undefined);
  await checked('preserves unrelated provider/model data and exact IDs', () => {
    reset(); apply('coding');
    const expected = structuredClone(original);
    expected.providers.fixture.modelOverrides[model.id].samplingParams.temperature = 0.2;
    assert.deepEqual(read('models.json'), expected);
    assert.equal(read('model-profiles.state.json').owned[0].original.present, false);
  });
  await checked('cycling restores missing temperature and existing top_p', () => {
    const config = example(model); config.profiles.writing = { top_p: 0.8 };
    reset(config); apply('coding'); apply('writing');
    assert.deepEqual(params(), { top_p: 0.8, extra: 'keep' });
    apply('education'); assert.deepEqual(params(), { top_p: 0.91, extra: 'keep', temperature: 0.4 });
    apply('restore'); assert.deepEqual(read('models.json'), original);
    assert.deepEqual(read('model-profiles.state.json').owned, []);
  });
  await checked('restore ignores corrupt profile config and preserves its exact bytes', () => {
    for (const corrupt of [Buffer.from('\uFEFF{ malformed config\r\n'), Buffer.from('{"version":99}')]) {
      const config = example(model); config.profiles.coding = { temperature: 0.2, top_p: 0.8 };
      reset(config); apply('coding');
      fs.writeFileSync(configFile, corrupt);
      assert.match(updateProfiles(temporary, 'restore', []), /Restored owned sampling keys/);
      assert.deepEqual(read('models.json'), original);
      assert.deepEqual(read('model-profiles.state.json'), { version: 1, profile: null, owned: [] });
      assert.deepEqual(fs.readFileSync(configFile), corrupt);
    }
  });
  await checked('existing zero values survive repeated switches and restore', () => {
    const initial = structuredClone(original); initial.providers.fixture.modelOverrides[model.id].samplingParams.temperature = 0;
    reset(example(model), initial); apply('coding'); apply('writing'); apply('coding'); apply('restore');
    assert.deepEqual(read('models.json'), initial);
  });
  await checked('target removal restores old keys without touching unrelated edits', () => {
    reset(); apply('coding');
    const changed = read('models.json'); changed.custom.enabled = false; write('models.json', changed);
    const config = example(model); config.targets = [{ provider: 'fixture', model: 'second' }]; write('model-profiles.json', config);
    updateProfiles(temporary, 'writing', [model, { ...model, id: 'second' }], model);
    assert.equal(params().temperature, undefined); assert.equal(read('models.json').custom.enabled, false);
    apply('restore'); assert.equal(read('models.json').providers.fixture.modelOverrides.second.samplingParams.temperature, undefined);
  });
  await checked('manual changes and deleted owned keys block switch and restore without writes', () => {
    for (const deleted of [false, true]) {
      reset(); apply('coding'); const changed = read('models.json'); const p = changed.providers.fixture.modelOverrides[model.id].samplingParams;
      if (deleted) delete p.temperature; else p.temperature = 0.6;
      write('models.json', changed); const before = disk();
      for (const action of ['writing', 'restore']) { assert.throws(() => apply(action), /conflict/); assert.deepEqual(disk(), before); }
    }
  });
  await checked('malformed/commented JSON and malformed state are rejected without writes', () => {
    for (const [name, text] of [['models.json', '{/* comment */ "providers": {}}'], ['models.json', '{'], ['model-profiles.json', '{// comment\n}'], ['model-profiles.state.json', '{"version":99}'], ['model-profiles.state.json', '{}']]) {
      reset(); fs.writeFileSync(file(name), text); const before = disk();
      assert.throws(() => apply('coding'), /JSON|Invalid/); assert.deepEqual(disk(), before);
    }
  });
  await checked('BOM is retained while preserving existing JSON values', () => {
    reset(); fs.writeFileSync(modelsFile, `\uFEFF${JSON.stringify(original)}`); apply('coding'); apply('restore');
    assert(fs.readFileSync(modelsFile, 'utf8').startsWith('\uFEFF')); assert.deepEqual(read('models.json'), original);
  });
  await checked('invalid profiles and empty/duplicate targets cause no writes', () => {
    const invalid = [c => c.profiles.coding.temperature = 2.1, c => c.profiles.coding = { top_p: -0.1 }, c => c.profiles.coding = { top_p: '0.9' }, c => c.profiles.coding = {}, c => c.profiles.coding = { seed: 1 }, c => c.targets = [], c => c.targets.push(target), c => c.targets[0].model = ''];
    for (const mutate of invalid) {
      const config = example(model); mutate(config); reset(config); const before = disk();
      assert.throws(() => apply('coding')); assert.deepEqual(disk(), before);
    }
  });
  await checked('unsupported or unknown targets reject the entire activation', () => {
    for (const catalog of [[{ ...model, api: 'anthropic-messages' }], []]) {
      reset(); const before = disk();
      assert.throws(() => updateProfiles(temporary, 'writing', catalog, model), /Unsupported API|Target not found/); assert.deepEqual(disk(), before);
    }
  });
  await checked('init never targets all models and does not overwrite config', () => {
    reset(); fs.unlinkSync(configFile);
    updateProfiles(temporary, 'init', [model], { ...model, api: 'anthropic-messages' });
    assert.deepEqual(read('model-profiles.json').targets, []);
    const before = disk(); apply('init'); assert.deepEqual(disk(), before);
    fs.unlinkSync(configFile); apply('coding'); assert.deepEqual(read('model-profiles.json').targets, [target]);
  });
  await checked('init reports existing malformed config without changing disk', () => {
    reset(); fs.writeFileSync(configFile, '{ malformed config\r\n');
    const before = disk();
    assert.match(apply('init'), /already exists; edit it/);
    assert.deepEqual(disk(), before);
  });
  await checked('exclusive lock rejects competing commands and is not stolen', () => {
    reset(); fs.writeFileSync(file('model-profiles.lock'), 'busy'); const before = disk();
    assert.throws(() => apply('coding'), /locked/); assert.deepEqual(disk(), before); assert.equal(fs.readFileSync(file('model-profiles.lock'), 'utf8'), 'busy');
    fs.unlinkSync(file('model-profiles.lock'));
    apply('coding'); assert(!fs.existsSync(file('model-profiles.lock')));
  });
  function runtime(ui = true) {
    const commands = {}, notices = [], events = [];
    let thinking = 'high', refreshError, fresh, refreshCount = 0;
    const ctx = { hasUI: ui, model, ui: { notify: (text, level) => notices.push({ text, level }), select: async () => 'writing' },
      waitForIdle: async () => { events.push('idle'); },
      modelRegistry: { getAll: () => [model], refresh: async options => { assert.deepEqual(options, { allowNetwork: false }); events.push('refresh'); refreshCount++; fresh = { ...model, samplingParams: params() }; }, getError: () => refreshCount >= 2 ? refreshError : undefined, find: () => fresh } };
    factory({ registerCommand: (name, command) => { commands[name] = command; }, getThinkingLevel: () => thinking,
      setThinkingLevel: value => { thinking = value; events.push('thinking'); }, setModel: async selected => { assert.equal(selected, fresh); thinking = 'off'; events.push('model'); return true; } });
    return { run: arg => commands['model-profile'].handler(arg, ctx), notices, events, thinking: () => thinking, failRefresh: () => { refreshError = 'secret-provider-error'; } };
  }
  await checked('command waits for idle, refreshes fresh active model and preserves thinking', async () => {
    reset(); const r = runtime(); await r.run('coding');
    assert.deepEqual(r.events, ['idle', 'refresh', 'refresh', 'model', 'thinking']); assert.equal(r.thinking(), 'high'); assert.match(r.notices.at(-1).text, /thinking preserved/);
    assert.match(profileStatus(temporary), /coding/);
  });
  await checked('reload failure reports persisted disk separately without provider secrets', async () => {
    reset(); const r = runtime(); r.failRefresh(); await r.run('education');
    assert.equal(params().temperature, 0.4); assert.equal(r.notices.at(-1).level, 'error'); assert.match(r.notices.at(-1).text, /Runtime reload failed/); assert(!r.notices.at(-1).text.includes('secret-provider-error'));
  });
  await checked('no args offers built-in selection; headless prints usage without mutations', async () => {
    reset(); const r = runtime(); await r.run(''); assert.equal(params().temperature, 0.7);
    const before = disk(), headless = runtime(false), previousWrite = process.stderr.write;
    let printed = ''; process.stderr.write = text => { printed += text; return true; };
    try { await headless.run(''); } finally { process.stderr.write = previousWrite; }
    assert.match(printed, /\/model-profile/); assert.deepEqual(disk(), before);
  });
  console.log(`Passed ${count} model profile checks.`);
} finally {
  if (previous === undefined) delete process.env.PI_CODING_AGENT_DIR; else process.env.PI_CODING_AGENT_DIR = previous;
  fs.rmSync(temporary, { recursive: true, force: true });
}
