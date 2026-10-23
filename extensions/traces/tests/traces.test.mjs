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
const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'traces-test-'));
const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
let count = 0;
const checked = (label, fn) => { fn(); count++; console.log(`ok ${count}: ${label}`); };

try {
  const factory = await jiti.import(path.join(root, 'index.ts'), { default: true });
  let append;
  let query;
  let mermaid;
  factory({
    registerTool: (tool) => {
      if (tool.name === 'trace_append') append = tool;
      else if (tool.name === 'trace_query') query = tool;
      else if (tool.name === 'trace_mermaid') mermaid = tool;
    },
    registerCommand: () => {},
  });
  assert(append && query && mermaid, 'all trace tools registered');

  const ctx = { cwd: temporary };
  const call = (tool, params) => tool.execute('test', params, undefined, undefined, ctx);
  const base = { trace: 'demo', kind: 'finding', title: 'A finding', body: 'The body.', refs: [{ type: 'file', path: 'a.c', lines: '1-2' }] };
  const text = (result) => result.content.map((part) => part.text).join('\n');

  const first = await call(append, base);
  checked('append assigns a kind-prefixed id', () => assert.match(text(first), /f1/));
  checked('append writes one JSONL record', () => {
    const file = path.join(temporary, '.dev-vault/traces/demo/trace.jsonl');
    assert.equal(fs.readFileSync(file, 'utf8').trim().split('\n').length, 1);
  });

  await call(append, { ...base, kind: 'decision', title: 'A decision' });
  await call(append, { ...base, kind: 'deadend', title: 'A dead end' });
  await call(append, { ...base, kind: 'evidence', title: 'Evidence record' });
  await call(append, { ...base, kind: 'finding', title: 'Depends on evidence', supports: ['e1'] });
  await call(append, { ...base, kind: 'decision', title: 'Choose Timer2', supports: ['e1'] });
  await call(append, { ...base, kind: 'deadend', title: 'Reject Timer0', supports: ['d2'] });
  await call(append, {
    ...base,
    kind: 'path',
    title: 'Narrow the manual',
    steps: [
      { action: 'read capabilities', ref: 'p.334' },
      { action: 'follow init recipe', ref: 'pp.342-343' },
    ],
  });

  const outline = text(await call(query, { action: 'outline', trace: 'demo' }));
  checked('outline excludes deadends by default', () => {
    assert.match(outline, /f1/);
    assert.match(outline, /d1/);
    assert.doesNotMatch(outline, /A dead end/);
  });
  const outlineAll = text(await call(query, { action: 'outline', trace: 'demo', includeDeadends: true }));
  checked('outline includes deadends on request', () => assert.match(outlineAll, /A dead end/));

  const got = text(await call(query, { action: 'get', trace: 'demo', ids: ['f1'] }));
  checked('get returns the selected body and refs', () => {
    assert.match(got, /The body\./);
    assert.match(got, /a\.c/);
  });

  const evidence = text(await call(query, { action: 'evidence', trace: 'demo', ids: ['f1'] }));
  checked('evidence returns refs only', () => {
    assert.match(evidence, /a\.c/);
    assert.doesNotMatch(evidence, /The body\./);
  });

  const found = text(await call(query, { action: 'search', query: 'finding' }));
  checked('search finds matching records', () => assert.match(found, /demo\/f1/));

  const list = text(await call(query, { action: 'list' }));
  checked('list shows the trace root', () => assert.match(list, /demo/));

  const prov = text(await call(mermaid, { trace: 'demo', diagram: 'provenance' }));
  checked('provenance diagram renders dependencies', () => {
    assert.match(prov, /flowchart LR/);
    assert.match(prov, /e1 --> f2/);
    assert.match(prov, /e1 --> d2/);
    assert.doesNotMatch(prov, /Reject Timer0/);
  });
  const provAll = text(await call(mermaid, { trace: 'demo', diagram: 'provenance', includeDeadends: true }));
  checked('provenance includes deadends on request', () => assert.match(provAll, /Reject Timer0/));

  const pathDiagram = text(await call(mermaid, { trace: 'demo', diagram: 'path' }));
  checked('path diagram renders steps', () => {
    assert.match(pathDiagram, /read capabilities/);
    assert.match(pathDiagram, /follow init recipe/);
  });

  const decisionDiagram = text(await call(mermaid, { trace: 'demo', diagram: 'decision' }));
  checked('decision diagram links a rejected deadend', () => assert.match(decisionDiagram, /d2 -\.-> x2/));

  await call(mermaid, { trace: 'demo', diagram: 'provenance', write: true });
  checked('write saves the mmd file', () => {
    const file = path.join(temporary, '.dev-vault/traces/demo/diagram-provenance.mmd');
    assert.ok(fs.existsSync(file));
    assert.match(fs.readFileSync(file, 'utf8'), /flowchart LR/);
  });

  await assert.rejects(() => call(append, { ...base, refs: [] }), /At least one ref/);
  checked('rejects a record with no refs', () => {});
  await assert.rejects(() => call(append, { ...base, trace: '../escape' }), /lowercase slug/);
  checked('rejects a path-traversal trace id', () => {});
  await assert.rejects(() => call(append, { ...base, body: 'x'.repeat(1201) }), /1200/);
  checked('rejects an oversized body', () => {});
  await assert.rejects(() => call(query, { action: 'get', trace: 'missing' }), /not found or empty/);
  checked('rejects a missing trace', () => {});
} finally {
  fs.rmSync(temporary, { recursive: true, force: true });
}

console.log(`PASS: ${count} checks; trace append/query behavior.`);
