/**
 * Plain-node checks for the trace viewer server. Spawns the real server via
 * tsx against a fixture .dev-vault/traces tree and a fixture sessions dir,
 * then exercises every API endpoint. Prints `ok N: ...` per check and a final
 * PASS line. Run: node tests/server.test.mjs (after npm install).
 */

import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { readRecords } from '../../extensions/traces/core.ts';

const viewer = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const serverFile = path.join(viewer, 'server.ts');
const tsx = path.join(viewer, 'node_modules', '.bin', 'tsx');
const fixtureCwd = fs.mkdtempSync(path.join(os.tmpdir(), 'trace-viewer-cwd-'));
const secondCwd = fs.mkdtempSync(path.join(os.tmpdir(), 'trace-viewer-second-'));
const sessionsDir = path.join(fixtureCwd, 'sessions');
const configPath = path.join(fixtureCwd, 'viewer-config.json');
const SESSION_ID = '11111111-2222-3333-4444-555555555555';
const SECOND_SESSION_ID = '66666666-7777-8888-9999-000000000000';

let count = 0;
const checked = async (label, fn) => {
	await fn();
	count += 1;
	console.log(`ok ${count}: ${label}`);
};

/** Same encoding rule the server uses; kept tiny so fixtures are explicit. */
const encodeSessionDir = (cwd) => `--${cwd.replace(/^[/\\]+/, '').replace(/[/\\:]/g, '-')}--`;

function writeTrace(name, records, created, root = fixtureCwd) {
	const dir = path.join(root, '.dev-vault', 'traces', name);
	fs.mkdirSync(dir, { recursive: true });
	fs.writeFileSync(path.join(dir, 'meta.json'), `${JSON.stringify({ trace: name, created }, null, 2)}\n`);
	fs.writeFileSync(path.join(dir, 'trace.jsonl'), records.map((record) => `${JSON.stringify(record)}\n`).join(''));
}

const ts = (day) => `2026-01-0${day}T00:00:00.000Z`;
writeTrace('alpha', [
	{ id: 'f1', trace: 'alpha', kind: 'finding', title: 'First finding', body: 'Body one.', refs: [], session: SESSION_ID, ts: ts(1) },
	{ id: 'f2', trace: 'alpha', kind: 'finding', title: 'Second finding', body: 'Body two.', refs: [], supports: ['f1'], failureClass: 'bad-flash', agent: 'worker-a', ts: ts(2) },
	{ id: 'd1', trace: 'alpha', kind: 'decision', title: 'A decision', body: 'Decided.', refs: [], supports: ['f1'], failureClass: 'bad-flash', agent: 'worker-b', ts: ts(3) },
], ts(1));
writeTrace('beta', [
	{ id: 'e1', trace: 'beta', kind: 'evidence', title: 'Evidence', body: 'Proof.', refs: [], failureClass: 'bad-flash', agent: 'worker-a', ts: ts(2) },
	{ id: 'x1', trace: 'beta', kind: 'deadend', title: 'Dead end', body: 'Blocked.', refs: [], failureClass: 'stale-lock', ts: ts(3) },
], ts(2));
writeTrace('gamma', [
	{ id: 'f1', trace: 'gamma', kind: 'finding', title: 'No session here', body: 'None.', refs: [], ts: ts(4) },
], ts(4));

const sessionDir = path.join(sessionsDir, encodeSessionDir(fixtureCwd));
fs.mkdirSync(sessionDir, { recursive: true });

// A second project vault, discoverable through its own encoded sessions dir.
writeTrace('delta', [
	{ id: 's1', trace: 'delta', kind: 'finding', title: 'Second vault finding', body: 'Other project.', refs: [], session: SECOND_SESSION_ID, ts: ts(5) },
], ts(5), secondCwd);
const secondSessionDir = path.join(sessionsDir, encodeSessionDir(secondCwd));
fs.mkdirSync(secondSessionDir, { recursive: true });
fs.writeFileSync(
	path.join(secondSessionDir, `2026-01-05T00-00-00-000Z_${SECOND_SESSION_ID}.jsonl`),
	[
		{ type: 'session', version: 3, id: SECOND_SESSION_ID, timestamp: ts(5), cwd: secondCwd },
		{ type: 'model_change', id: 'm9', parentId: null, timestamp: ts(5), provider: 'test', modelId: 'test-model' },
		{ type: 'message', id: 'u9', parentId: 'm9', timestamp: ts(5), message: { role: 'user', content: 'Second project hello', timestamp: 5 } },
	].map((entry) => `${JSON.stringify(entry)}\n`).join(''),
);
const sessionEntries = [
	{ type: 'session', version: 3, id: SESSION_ID, timestamp: ts(1), cwd: fixtureCwd },
	{ type: 'model_change', id: 'm1', parentId: null, timestamp: ts(1), provider: 'test', modelId: 'test-model' },
	{ type: 'message', id: 'u1', parentId: 'm1', timestamp: ts(1), message: { role: 'user', content: 'Hello agent', timestamp: 1 } },
	{ type: 'message', id: 'a1', parentId: 'u1', timestamp: ts(2), message: { role: 'assistant', content: [{ type: 'text', text: 'Hi there' }, { type: 'thinking', thinking: 'pondering' }], timestamp: 2 } },
	{ type: 'message', id: 't1', parentId: 'a1', timestamp: ts(3), message: { role: 'toolResult', toolCallId: 'call1', toolName: 'bash', content: [{ type: 'text', text: 'command output' }], isError: false, timestamp: 3 } },
	{ type: 'message', id: 'u2', parentId: 'u1', timestamp: ts(2), message: { role: 'user', content: 'Abandoned branch', timestamp: 2 } },
];
fs.writeFileSync(
	path.join(sessionDir, `2026-01-01T00-00-00-000Z_${SESSION_ID}.jsonl`),
	sessionEntries.map((entry) => `${JSON.stringify(entry)}\n`).join(''),
);

function startServer(extraArgs = []) {
	const child = spawn(tsx, [serverFile, '--cwd', fixtureCwd, '--sessions-dir', sessionsDir, ...extraArgs], {
		stdio: ['ignore', 'pipe', 'pipe'],
		env: { ...process.env, TRACE_VIEWER_CONFIG: configPath },
	});
	return new Promise((resolve, reject) => {
		const timer = setTimeout(() => {
			child.kill();
			reject(new Error('server did not report a URL within 10 seconds'));
		}, 10_000);
		let buffer = '';
		child.stdout.on('data', (chunk) => {
			buffer += String(chunk);
			const line = buffer.split('\n').find((entry) => entry.startsWith('http'));
			if (line) {
				clearTimeout(timer);
				resolve({ child, url: line.trim(), port: Number(new URL(line.trim()).port) });
			}
		});
		child.stderr.on('data', (chunk) => process.stderr.write(chunk));
		child.on('exit', (code) => reject(new Error(`server exited early with code ${code}`)));
	});
}

const getJson = async (url) => {
	const response = await fetch(url);
	return { status: response.status, body: await response.json() };
};
const postJson = async (url, payload) => {
	const response = await fetch(url, {
		method: 'POST',
		headers: { 'content-type': 'application/json' },
		body: JSON.stringify(payload),
	});
	let body = null;
	try {
		body = await response.json();
	} catch {
		// A 413 with a destroyed socket may carry no JSON; status is the check.
	}
	return { status: response.status, body };
};

let server;
try {
	server = await startServer(['--port', '0', '--trace', 'alpha']);
	await checked('server prints an http URL line with the --trace query', () => {
		assert.match(server.url, /^http:\/\/localhost:\d+\/\?trace=alpha$/);
	});

	const base = `http://localhost:${server.port}`;

	await checked('/api/traces lists the fixture traces with counts', async () => {
		const { status, body } = await getJson(`${base}/api/traces`);
		assert.equal(status, 200);
		const names = body.map((entry) => entry.trace);
		// Newest first: gamma (Jan 4), beta (Jan 2), alpha (Jan 1).
		assert.deepEqual(names, ['gamma', 'beta', 'alpha']);
		assert.equal(body.find((entry) => entry.trace === 'alpha').recordCount, 3);
		assert.equal(body.find((entry) => entry.trace === 'beta').created, ts(2));
	});

	await checked('/api/trace/:id returns nodes, supports edges, and the most common session id', async () => {
		const { status, body } = await getJson(`${base}/api/trace/alpha`);
		assert.equal(status, 200);
		assert.deepEqual(body.nodes.map((node) => node.id), ['f1', 'f2', 'd1']);
		assert.deepEqual(body.edges, [
			{ source: 'f2', target: 'f1' },
			{ source: 'd1', target: 'f1' },
		]);
		assert.equal(body.session, SESSION_ID);
		const f2 = body.nodes.find((node) => node.id === 'f2');
		assert.equal(f2.failureClass, 'bad-flash');
		assert.equal(f2.agent, 'worker-a');
	});

	await checked('/api/trace/:id/session flattens the active branch to role/text/ts messages', async () => {
		const { status, body } = await getJson(`${base}/api/trace/alpha/session`);
		assert.equal(status, 200);
		assert.equal(body.sessionId, SESSION_ID);
		assert.deepEqual(body.messages.map((message) => message.role), ['user', 'assistant', 'toolResult']);
		assert.equal(body.messages[0].text, 'Hello agent');
		assert.match(body.messages[1].text, /Hi there/);
		assert.match(body.messages[1].text, /pondering/);
		assert.match(body.messages[2].text, /command output/);
		// The abandoned u2 branch must not appear.
		assert.ok(!body.messages.some((message) => /Abandoned branch/.test(message.text)));
	});

	await checked('/api/trace/:id/session 404s for a trace without a session id', async () => {
		const { status, body } = await getJson(`${base}/api/trace/gamma/session`);
		assert.equal(status, 404);
		assert.equal(body.error, 'session unknown');
	});

	await checked('/api/trace/:id/patterns aggregates failure classes across all traces', async () => {
		const { status, body } = await getJson(`${base}/api/trace/alpha/patterns`);
		assert.equal(status, 200);
		const badFlash = body.find((group) => group.failureClass === 'bad-flash');
		assert.equal(badFlash.count, 3);
		assert.equal(badFlash.traceCount, 2);
		assert.deepEqual(badFlash.agents, ['worker-a', 'worker-b']);
		assert.deepEqual(badFlash.records.map((record) => `${record.trace}/${record.id}`), ['alpha/f2', 'alpha/d1', 'beta/e1']);
		const staleLock = body.find((group) => group.failureClass === 'stale-lock');
		assert.equal(staleLock.count, 1);
		assert.equal(staleLock.traceCount, 1);
		// Repeat-first ordering.
		assert.equal(body[0].failureClass, 'bad-flash');
	});

	await checked('POST review round-trips and appends to trace.jsonl', async () => {
		const { status, body } = await postJson(`${base}/api/trace/alpha/review`, {
			targetIds: ['f1', 'f2'],
			text: 'Looks correct against the fixture.',
			failureClass: 'bad-flash',
		});
		assert.equal(status, 200);
		assert.equal(body.kind, 'review');
		assert.match(body.id, /^r\d+$/);
		assert.deepEqual(body.supports, ['f1', 'f2']);
		assert.equal(body.agent, 'human');
		assert.equal(body.failureClass, 'bad-flash');
		const line = fs.readFileSync(path.join(fixtureCwd, '.dev-vault', 'traces', 'alpha', 'trace.jsonl'), 'utf8').trim().split('\n').at(-1);
		const record = JSON.parse(line);
		assert.equal(record.id, body.id);
		assert.equal(record.kind, 'review');
	});

	await checked('POST review with unknown targetIds returns 400', async () => {
		const { status, body } = await postJson(`${base}/api/trace/alpha/review`, { targetIds: ['nope'], text: 'Bad target.' });
		assert.equal(status, 400);
		assert.match(body.error, /Unknown review target ids/);
	});

	await checked('POST review with missing text returns 400', async () => {
		const { status } = await postJson(`${base}/api/trace/alpha/review`, { targetIds: ['f1'] });
		assert.equal(status, 400);
	});

	await checked('POST bodies over 64 KB are rejected with 413', async () => {
		const response = await fetch(`${base}/api/trace/alpha/review`, {
			method: 'POST',
			headers: { 'content-type': 'application/json' },
			body: JSON.stringify({ targetIds: ['f1'], text: 'x'.repeat(70 * 1024) }),
		});
		assert.equal(response.status, 413);
	});

	await checked('a second review gets the next r-prefixed id through the write queue', async () => {
		const { body } = await postJson(`${base}/api/trace/alpha/review`, { targetIds: ['d1'], text: 'Second look.' });
		assert.equal(body.id, 'r2');
		assert.deepEqual(body.supports, ['d1']);
	});

	await checked('invalid trace ids return 400, unknown traces 404', async () => {
		assert.equal((await getJson(`${base}/api/trace/BAD%20ID`)).status, 400);
		assert.equal((await getJson(`${base}/api/trace/missing`)).status, 404);
	});

	await checked('GET /api/vaults lists the default vault', async () => {
		const { status, body } = await getJson(`${base}/api/vaults`);
		assert.equal(status, 200);
		assert.equal(body.length, 1);
		assert.equal(body[0].path, path.resolve(fixtureCwd));
		assert.equal(body[0].name, path.basename(fixtureCwd));
		assert.equal(body[0].traceCount, 3);
		assert.equal(body[0].default, true);
	});

	await checked('POST /api/vaults validates the path and re-adding is idempotent', async () => {
		const missing = await postJson(`${base}/api/vaults`, { path: path.join(fixtureCwd, 'does-not-exist') });
		assert.equal(missing.status, 404);
		const plainDir = path.join(fixtureCwd, 'no-vault');
		fs.mkdirSync(plainDir);
		const noTraces = await postJson(`${base}/api/vaults`, { path: plainDir });
		assert.equal(noTraces.status, 400);
		assert.match(noTraces.body.error, /\.dev-vault\/traces/);
		const added = await postJson(`${base}/api/vaults`, { path: secondCwd });
		assert.equal(added.status, 200);
		assert.equal(added.body.path, path.resolve(secondCwd));
		assert.equal(added.body.name, path.basename(secondCwd));
		assert.equal(added.body.traceCount, 1);
		assert.equal(added.body.default, false);
		const again = await postJson(`${base}/api/vaults`, { path: secondCwd });
		assert.equal(again.status, 200);
		assert.deepEqual(again.body, added.body);
		const { body } = await getJson(`${base}/api/vaults`);
		assert.equal(body.length, 2);
	});

	await checked('POST /api/vaults persists the vault list to the config file', async () => {
		const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
		assert.deepEqual(config.vaults, [path.resolve(secondCwd)]);
	});

	await checked('GET /api/vaults/known discovers both projects from encoded session dirs', async () => {
		const { status, body } = await getJson(`${base}/api/vaults/known`);
		assert.equal(status, 200);
		const byPath = new Map(body.map((entry) => [entry.path, entry]));
		const first = byPath.get(path.resolve(fixtureCwd));
		assert.ok(first);
		assert.equal(first.loaded, true);
		const second = byPath.get(path.resolve(secondCwd));
		assert.ok(second);
		assert.equal(second.name, path.basename(secondCwd));
		assert.equal(second.loaded, true);
	});

	await checked('trace endpoints resolve ?vault= and reject unknown vaults with 400', async () => {
		const second = encodeURIComponent(path.resolve(secondCwd));
		const { status, body } = await getJson(`${base}/api/traces?vault=${second}`);
		assert.equal(status, 200);
		assert.deepEqual(body.map((entry) => entry.trace), ['delta']);
		// delta lives only in the second vault, so the default vault 404s it.
		assert.equal((await getJson(`${base}/api/trace/delta`)).status, 404);
		assert.equal((await getJson(`${base}/api/trace/delta?vault=${second}`)).status, 200);
		const unknown = encodeURIComponent(path.join(fixtureCwd, 'not-loaded'));
		const { status: badStatus, body: badBody } = await getJson(`${base}/api/traces?vault=${unknown}`);
		assert.equal(badStatus, 400);
		assert.match(badBody.error, /Unknown vault/);
		assert.equal((await getJson(`${base}/api/trace/alpha/patterns?vault=${unknown}`)).status, 400);
	});

	await checked('/api/trace/:id/session resolves against the selected vault', async () => {
		const vault = encodeURIComponent(path.resolve(secondCwd));
		const { status, body } = await getJson(`${base}/api/trace/delta/session?vault=${vault}`);
		assert.equal(status, 200);
		assert.equal(body.sessionId, SECOND_SESSION_ID);
		assert.equal(body.messages[0].text, 'Second project hello');
	});

	await checked('POST review with ?vault= appends to the second vault trace.jsonl', async () => {
		const vault = encodeURIComponent(path.resolve(secondCwd));
		const { status, body } = await postJson(`${base}/api/trace/delta/review?vault=${vault}`, {
			targetIds: ['s1'],
			text: 'Second vault review.',
		});
		assert.equal(status, 200);
		assert.equal(body.kind, 'review');
		const records = readRecords(path.join(secondCwd, '.dev-vault', 'traces', 'delta', 'trace.jsonl'));
		const review = records.at(-1);
		assert.equal(review.id, body.id);
		assert.equal(review.body, 'Second vault review.');
		assert.deepEqual(review.supports, ['s1']);
	});

	server.child.kill();
	server = null;

	await checked('EADDRINUSE increments the port until one is free', async () => {
		const blocker = net.createServer();
		await new Promise((resolve) => blocker.listen(0, resolve));
		const blocked = blocker.address().port;
		const retry = await startServer(['--port', String(blocked)]);
		assert.equal(retry.port, blocked + 1);
		retry.child.kill();
		blocker.close();
	});

	await checked('a restarted server reloads the persisted vault list', async () => {
		const restarted = await startServer(['--port', '0']);
		const { status, body } = await getJson(`http://localhost:${restarted.port}/api/vaults`);
		assert.equal(status, 200);
		assert.equal(body.length, 2);
		const second = body.find((entry) => entry.path === path.resolve(secondCwd));
		assert.ok(second);
		assert.equal(second.default, false);
		const delta = await getJson(`http://localhost:${restarted.port}/api/traces?vault=${encodeURIComponent(path.resolve(secondCwd))}`);
		assert.deepEqual(delta.body.map((entry) => entry.trace), ['delta']);
		restarted.child.kill();
	});

	console.log(`PASS trace-viewer server (${count} checks)`);
} finally {
	if (server) server.child.kill();
	fs.rmSync(fixtureCwd, { recursive: true, force: true });
	fs.rmSync(secondCwd, { recursive: true, force: true });
}
