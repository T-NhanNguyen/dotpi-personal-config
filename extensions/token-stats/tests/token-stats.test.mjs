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
const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
let count = 0;
const checked = (label, fn) => { fn(); count++; console.log(`ok ${count}: ${label}`); };

const core = await jiti.import(path.join(root, 'core.ts'));

const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'token-stats-test-'));
const sessionFile = path.join(temporary, '2026-11-20T10-00-00-000Z_abc123.jsonl');
const lines = [
	{ type: 'session', version: 3, id: 'abc123', timestamp: '2026-11-20T10:00:00.000Z', cwd: '/tmp/demo' },
	{ type: 'model_change', id: 'm1', parentId: null, timestamp: '2026-11-20T10:00:01.000Z', provider: 'deepseek', modelId: 'v4' },
	{ type: 'message', id: 'u1', parentId: null, timestamp: '2026-11-20T10:00:02.000Z', message: { role: 'user', content: [{ type: 'text', text: 'hi' }] } },
	{
		type: 'message', id: 'a1', parentId: 'u1', timestamp: '2026-11-20T10:00:03.000Z',
		message: {
			role: 'assistant',
			usage: { input: 1000, output: 200, cacheRead: 5000, cacheWrite: 0, reasoning: 50, cost: { total: 0.01 } },
			content: [{ type: 'toolCall', id: 't1', name: 'bash', arguments: { command: 'ls' } }],
		},
	},
	{
		type: 'message', id: 'r1', parentId: 'a1', timestamp: '2026-11-20T10:00:04.000Z',
		message: { role: 'toolResult', toolCallId: 't1', toolName: 'bash', content: [{ type: 'text', text: 'x'.repeat(400) }], isError: false, durationMs: 120 },
	},
	{ type: 'model_change', id: 'm2', parentId: 'r1', timestamp: '2026-11-20T10:00:05.000Z', provider: 'kimi', modelId: 'k3' },
	{
		type: 'message', id: 'a2', parentId: 'r1', timestamp: '2026-11-20T10:00:06.000Z',
		message: {
			role: 'assistant',
			usage: { input: 2000, output: 300, cacheRead: 0, cacheWrite: 100, reasoning: 0, cost: { total: 0.02 } },
			content: [{ type: 'toolCall', id: 't2', name: 'subagent', arguments: { agent: 'explore', task: 'x' } }, { type: 'text', text: 'done' }],
		},
	},
	'{malformed trailing line',
];
fs.writeFileSync(sessionFile, lines.map((l) => (typeof l === 'string' ? l : JSON.stringify(l))).join('\n') + '\n');

checked('parseSessionFile sums usage across models', () => {
	const stats = core.parseSessionFile(sessionFile);
	assert.equal(stats.usage.input, 3000);
	assert.equal(stats.usage.output, 500);
	assert.equal(stats.usage.cacheRead, 5000);
	assert.equal(stats.usage.cacheWrite, 100);
	assert.equal(stats.usage.reasoning, 50);
	assert.ok(Math.abs(stats.usage.cost - 0.03) < 1e-9);
});

checked('per-model attribution follows model_change entries', () => {
	const stats = core.parseSessionFile(sessionFile);
	assert.deepEqual(stats.models, ['deepseek/v4', 'kimi/k3']);
	assert.equal(stats.perModel.get('deepseek/v4').input, 1000);
	assert.equal(stats.perModel.get('kimi/k3').input, 2000);
});

checked('tool calls, results, and subagent counts', () => {
	const stats = core.parseSessionFile(sessionFile);
	assert.equal(stats.toolCalls.get('bash'), 1);
	assert.equal(stats.toolCalls.get('subagent'), 1);
	assert.equal(stats.subagentCalls, 1);
	const bash = stats.toolResults.get('bash');
	assert.equal(bash.count, 1);
	assert.equal(bash.bytes, 400);
	assert.equal(bash.durationMs, 120);
	assert.equal(stats.messages.user, 1);
	assert.equal(stats.messages.assistant, 2);
	assert.equal(stats.messages.toolResult, 1);
});

checked('duration comes from first and last timestamps', () => {
	const stats = core.parseSessionFile(sessionFile);
	assert.equal(stats.durationMs, 6000);
});

checked('encodeCwd matches the harness session dir naming', () => {
	assert.equal(core.encodeCwd('/Users/nhan/ai-workspace/dotpi-personal-config'), '--Users-nhan-ai-workspace-dotpi-personal-config--');
	assert.equal(core.encodeCwd('/private/tmp'), '--private-tmp--');
});

checked('renderers produce lines without throwing', () => {
	const stats = core.parseSessionFile(sessionFile);
	assert.ok(core.renderSessionDetail(stats).length >= 5);
	assert.ok(core.renderSessionTable([stats], 10).length === 3);
	assert.ok(core.renderRollup('project', [stats]).some((l) => l.includes('1 sessions')));
});

checked('aggregate combines sessions', () => {
	const stats = core.parseSessionFile(sessionFile);
	const rollup = core.aggregate([stats, stats]);
	assert.equal(rollup.sessions, 2);
	assert.equal(rollup.usage.input, 6000);
	assert.equal(rollup.toolCalls.get('bash'), 2);
});

checked('traceLinkage collects distinct session ids and counts records', () => {
	const traceFile = path.join(temporary, 'trace.jsonl');
	fs.writeFileSync(traceFile, [
		JSON.stringify({ id: 'f1', kind: 'finding', session: 'abc123' }),
		JSON.stringify({ id: 'f2', kind: 'finding', session: 'abc123' }),
		JSON.stringify({ id: 'd1', kind: 'decision' }),
	].join('\n') + '\n');
	const linkage = core.traceLinkage(traceFile);
	assert.equal(linkage.recordCount, 3);
	assert.deepEqual(linkage.sessionIds, ['abc123']);
	assert.equal(core.traceLinkage(path.join(temporary, 'nope.jsonl')), undefined);
});

checked('findSessionsById locates transcripts by filename suffix', () => {
	const root2 = fs.mkdtempSync(path.join(os.tmpdir(), 'token-stats-root-'));
	const proj = path.join(root2, '--tmp-demo--');
	fs.mkdirSync(proj, { recursive: true });
	fs.copyFileSync(sessionFile, path.join(proj, '2026-11-20T10-00-00-000Z_abc123.jsonl'));
	const { found, missing } = core.findSessionsById(root2, ['abc123', 'gone']);
	assert.ok(found.has('abc123'));
	assert.deepEqual(missing, ['gone']);
	fs.rmSync(root2, { recursive: true, force: true });
});

checked('renderTraceStats reports coverage and cost', () => {
	const stats = core.parseSessionFile(sessionFile);
	const lines = core.renderTraceStats('demo', { recordCount: 3, withSession: 1, sessionIds: ['abc123'] }, [stats], []);
	assert.ok(lines[0].includes('3 records, 1 linked sessions'));
	const empty = core.renderTraceStats('old', { recordCount: 2, withSession: 0, sessionIds: [] }, [], []);
	assert.ok(empty.some((l) => l.includes('not attributable')));
});

// Cross-check the parser against a real transcript if one exists for this repo.
const realRoot = core.sessionsRoot();
const realDir = path.join(realRoot, core.encodeCwd(process.cwd()));
const realFiles = core.listSessionFiles(realDir);
if (realFiles.length > 0) {
	checked('parses a real session transcript', () => {
		const stats = core.parseSessionFile(realFiles[realFiles.length - 1]);
		assert.ok(stats.usage.input + stats.usage.output + stats.usage.cacheRead > 0, 'real session has usage');
		assert.ok(stats.messages.assistant > 0, 'real session has assistant messages');
	});
}

console.log(`token-stats: ${count} checks passed`);
fs.rmSync(temporary, { recursive: true, force: true });
