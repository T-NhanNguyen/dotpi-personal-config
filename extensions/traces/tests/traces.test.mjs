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
const hostPiAiCompat = (() => {
	const candidates = [
		path.join(path.dirname(host), 'pi-ai/dist/compat.js'),
		path.join(host, 'node_modules/@earendil-works/pi-ai/dist/compat.js'),
	];
	for (const candidate of candidates) {
		if (fs.existsSync(candidate)) return candidate;
	}
	throw new Error('Cannot locate @earendil-works/pi-ai compat.js next to the test host.');
})();
const alias = {
  '@earendil-works/pi-coding-agent': path.join(host, 'dist/index.js'),
  '@earendil-works/pi-ai': hostPiAiCompat,
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

  const classified = await call(append, {
    ...base,
    title: 'Demo cannot resolve the test host',
    agent: 'explore',
    failureClass: 'missing-test-host',
  });
  checked('append persists the failure class', () => {
    assert.equal(classified.details.record.failureClass, 'missing-test-host');
    const file = path.join(temporary, '.dev-vault/traces/demo/trace.jsonl');
    const records = fs.readFileSync(file, 'utf8').trim().split('\n').map((line) => JSON.parse(line));
    assert.equal(records.at(-1).failureClass, 'missing-test-host');
  });

  await call(append, {
    ...base,
    trace: 'other',
    title: 'Other cannot resolve the test host',
    agent: 'worker',
    failureClass: 'missing-test-host',
  });
  await call(append, {
    ...base,
    trace: 'other',
    title: 'A separate failure',
    agent: 'worker',
    failureClass: 'stale-fixture',
  });
  const patterns = await call(query, { action: 'patterns' });
  checked('patterns aggregates failure classes across traces', () => {
    assert.equal(patterns.details.total, 2);
    const repeated = patterns.details.patterns[0];
    assert.equal(repeated.failureClass, 'missing-test-host');
    assert.equal(repeated.count, 2);
    assert.equal(repeated.traceCount, 2);
    assert.deepEqual(repeated.agents, ['explore', 'worker']);
    assert.deepEqual(repeated.records.map((record) => `${record.trace}/${record.id}`), ['demo/f3', 'other/f1']);
    assert.match(text(patterns), /missing-test-host \| records=2 traces=2 agents=2/);
  });
  const demoPatterns = await call(query, { action: 'patterns', trace: 'demo' });
  checked('patterns can restrict aggregation to one trace', () => {
    assert.equal(demoPatterns.details.total, 1);
    assert.equal(demoPatterns.details.patterns[0].count, 1);
    assert.equal(demoPatterns.details.patterns[0].records[0].trace, 'demo');
  });
  await assert.rejects(() => call(append, { ...base, failureClass: 'not a slug' }), /Failure class/);
  checked('rejects an invalid failure class', () => {});

  await call(append, { ...base, trace: 'other', kind: 'deadend', title: 'Dead end with class', failureClass: 'flaky-harness' });
  const visiblePatterns = await call(query, { action: 'patterns' });
  checked('patterns excludes deadends by default', () => {
    assert.equal(visiblePatterns.details.total, 2);
    assert.ok(visiblePatterns.details.patterns.every((pattern) => pattern.failureClass !== 'flaky-harness'));
  });
  const deadendPatterns = await call(query, { action: 'patterns', kind: 'deadend', includeDeadends: true });
  checked('patterns respects kind and includeDeadends', () => {
    assert.equal(deadendPatterns.details.total, 1);
    assert.equal(deadendPatterns.details.patterns[0].failureClass, 'flaky-harness');
    assert.equal(deadendPatterns.details.patterns[0].count, 1);
  });
  const pagedPatterns = await call(query, { action: 'patterns', limit: 1, offset: 1 });
  checked('patterns paginates classes with limit and offset', () => {
    assert.equal(pagedPatterns.details.total, 2);
    assert.equal(pagedPatterns.details.patterns.length, 1);
    assert.equal(pagedPatterns.details.patterns[0].failureClass, 'stale-fixture');
  });
  const emptyPatterns = await call(query, { action: 'patterns', trace: 'demo', kind: 'decision' });
  checked('patterns reports the empty state', () => {
    assert.equal(emptyPatterns.details.total, 0);
    assert.match(text(emptyPatterns), /No failure classes found\./);
  });

  const unnormalized = await call(append, {
    ...base,
    title: 'Demo host unresolved again',
    agent: 'explore',
    failureClass: '  Missing-Test-Host  ',
  });
  const mergedPatterns = await call(query, { action: 'patterns' });
  checked('patterns normalizes classes and counts records separately from traces', () => {
    assert.equal(unnormalized.details.record.failureClass, 'missing-test-host');
    const merged = mergedPatterns.details.patterns[0];
    assert.equal(merged.failureClass, 'missing-test-host');
    assert.equal(merged.count, 3);
    assert.equal(merged.traceCount, 2);
    assert.deepEqual(merged.agents, ['explore', 'worker']);
    assert.deepEqual(merged.records.map((record) => `${record.trace}/${record.id}`), ['demo/f3', 'demo/f4', 'other/f1']);
  });

  const found = text(await call(query, { action: 'search', query: 'finding' }));
  checked('search finds matching records', () => assert.match(found, /demo\/f1/));

  const review = await call(append, { ...base, kind: 'review', title: 'Human sign-off', agent: 'human', supports: ['f1'] });
  const outlineWithReview = text(await call(query, { action: 'outline', trace: 'demo' }));
  checked('review records get r-prefixed ids and appear in outline by default', () => {
    assert.match(text(review), /r1/);
    assert.match(outlineWithReview, /r1 \[review\] Human sign-off/);
  });
  const provWithReview = text(await call(mermaid, { trace: 'demo', diagram: 'provenance' }));
  checked('review records are edges in provenance diagrams', () => {
    assert.match(provWithReview, /f1 --> r1/);
    assert.match(provWithReview, /r1\{\{"r1: review/);
  });
  const sessionCtx = { cwd: temporary, sessionManager: { getSessionId: () => 'session-abc' } };
  const stamped = await append.execute('test', { ...base, title: 'Stamped' }, undefined, undefined, sessionCtx);
  checked('append stamps the session id when the host provides one', () => {
    assert.equal(stamped.details.record.session, 'session-abc');
  });
  checked('append omits the session field when the host has no session manager', () => {
    assert.equal(first.details.record.session, undefined);
  });

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
