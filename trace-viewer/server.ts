/**
 * Trace viewer server. Serves the Vite build in ./dist plus a small JSON API
 * over the shared trace store in <cwd>/.dev-vault/traces. Spawned by the
 * traces extension's /trace-view command via tsx; on a successful listen it
 * prints exactly one first stdout line starting with "http", which the
 * extension reads as the app URL.
 *
 * CLI: --cwd <dir> (required)  --port <n> (default 4777, +1 up to 20 on
 * EADDRINUSE)  --trace <id> (optional, only used to build the printed URL)
 *  --sessions-dir <dir> (optional override for ~/.pi/agent/sessions, mainly
 * for tests; TRACE_VIEWER_SESSIONS_DIR env var works too).
 *
 * Vaults: besides the --cwd vault (always loaded, the default), the server
 * can keep additional project roots open for browsing. Trace endpoints take
 * an optional ?vault=<absolute path> query param; the loaded vault list is
 * persisted to ~/.pi/agent/trace-viewer.json (TRACE_VIEWER_CONFIG override).
 */

import * as fs from "node:fs";
import * as http from "node:http";
import * as os from "node:os";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import {
	TRACE_ROOT,
	appendReview,
	groupPatterns,
	normalizeTraceId,
	readRecords,
	traceNames,
	type TraceRecord,
} from "../extensions/traces/core.ts";

import { deleteReviews } from "./review-deletion.ts";
import type { ReviewSelection } from "../extensions/traces/review-deletion.ts";

const VIEWER_DIR = path.dirname(fileURLToPath(import.meta.url));
const DIST_DIR = path.join(VIEWER_DIR, "dist");
const DEFAULT_PORT = 4777;
const MAX_PORT_ATTEMPTS = 20;
const MAX_BODY_BYTES = 64 * 1024;
const REVIEW_TITLE_MAX = 80;
const SESSIONS_ENV_VAR = "TRACE_VIEWER_SESSIONS_DIR";
const CONFIG_ENV_VAR = "TRACE_VIEWER_CONFIG";

const MIME_TYPES: Record<string, string> = {
	".html": "text/html; charset=utf-8",
	".js": "text/javascript; charset=utf-8",
	".mjs": "text/javascript; charset=utf-8",
	".css": "text/css; charset=utf-8",
	".json": "application/json; charset=utf-8",
	".svg": "image/svg+xml",
	".png": "image/png",
	".jpg": "image/jpeg",
	".ico": "image/x-icon",
	".map": "application/json; charset=utf-8",
	".woff2": "font/woff2",
	".ttf": "font/ttf",
};

class HttpError extends Error {
	constructor(
		public status: number,
		message: string,
	) {
		super(message);
	}
}

interface Options {
	cwd: string;
	port: number;
	trace: string;
	sessionsDir: string;
}

function parseArgs(argv: string[]): Options {
	const options: Options = { cwd: "", port: DEFAULT_PORT, trace: "", sessionsDir: "" };
	for (let i = 0; i < argv.length; i++) {
		const arg = argv[i];
		const takeValue = (): string => {
			const value = argv[++i];
			if (value === undefined) throw new Error(`Missing value for ${arg}`);
			return value;
		};
		if (arg === "--cwd") options.cwd = takeValue();
		else if (arg === "--port") options.port = Number.parseInt(takeValue(), 10);
		else if (arg === "--trace") options.trace = takeValue();
		else if (arg === "--sessions-dir") options.sessionsDir = takeValue();
		else throw new Error(`Unknown argument: ${arg}`);
	}
	if (!options.cwd) throw new Error("--cwd is required.");
	if (!Number.isInteger(options.port) || options.port < 0) throw new Error("--port must be a non-negative integer.");
	return options;
}

/**
 * A vault is an absolute path to a project root that contains a
 * .dev-vault/traces directory. root is the traces directory itself, the
 * same layout the --cwd vault has always used.
 */
interface Vault {
	path: string;
	root: string;
}

interface VaultState {
	/** Normalized --cwd path; always present in vaults and reported default. */
	defaultPath: string;
	vaults: Map<string, Vault>;
}

function isVaultProject(projectPath: string): boolean {
	const tracesDir = path.join(projectPath, TRACE_ROOT);
	return fs.existsSync(tracesDir) && fs.statSync(tracesDir).isDirectory();
}

function configFilePath(): string {
	return process.env[CONFIG_ENV_VAR] ?? path.join(os.homedir(), ".pi", "agent", "trace-viewer.json");
}

/** The persisted vault list; a missing or malformed file means "no extras". */
function readPersistedVaultPaths(): string[] {
	try {
		const parsed = JSON.parse(fs.readFileSync(configFilePath(), "utf8")) as { vaults?: unknown };
		if (parsed && Array.isArray(parsed.vaults)) {
			return parsed.vaults.filter((entry): entry is string => typeof entry === "string");
		}
	} catch {
		// Missing or malformed config: start with just the default vault.
	}
	return [];
}

/** Persist every non-default vault so a later server run reopens them. */
function writePersistedVaults(state: VaultState): void {
	const extraPaths = [...state.vaults.keys()].filter((key) => key !== state.defaultPath);
	fs.mkdirSync(path.dirname(configFilePath()), { recursive: true });
	fs.writeFileSync(configFilePath(), `${JSON.stringify({ vaults: extraPaths }, null, 2)}\n`, "utf8");
}

function createVaultState(options: Options): VaultState {
	const defaultPath = path.resolve(options.cwd);
	const state: VaultState = {
		defaultPath,
		vaults: new Map([[defaultPath, { path: defaultPath, root: path.join(defaultPath, TRACE_ROOT) }]]),
	};
	for (const raw of readPersistedVaultPaths()) {
		const candidate = path.resolve(raw);
		if (candidate === defaultPath || state.vaults.has(candidate)) continue;
		// Stale entries (project moved or vault deleted) are skipped, not errors.
		if (!fs.existsSync(candidate) || !isVaultProject(candidate)) continue;
		state.vaults.set(candidate, { path: candidate, root: path.join(candidate, TRACE_ROOT) });
	}
	return state;
}

/**
 * Resolve the ?vault= query param to a loaded vault. An absent or empty
 * param selects the default; any other path must have been added explicitly.
 */
function resolveVault(state: VaultState, raw: string | null): Vault {
	if (raw === null || raw.trim() === "") {
		return state.vaults.get(state.defaultPath)!;
	}
	const key = path.resolve(raw);
	const vault = state.vaults.get(key);
	if (!vault) {
		throw new HttpError(400, `Unknown vault: ${raw}. Load it via POST /api/vaults first.`);
	}
	return vault;
}

function describeVault(state: VaultState, vault: Vault) {
	return {
		path: vault.path,
		name: path.basename(vault.path),
		traceCount: traceNames(vault.root).length,
		default: vault.path === state.defaultPath,
	};
}

/**
 * Pi encodes the session directory as --<cwd with separators as hyphens>--.
 * The encoding is lossy (real names can contain hyphens), so decode by
 * growing candidates left to right: at each hyphen-separated token either
 * extend the current path segment or start a new one. A candidate whose
 * current segment can never match a directory in its parent — neither
 * exactly nor as the prefix of a hyphen-extended name — is pruned; that is
 * sound because every parse sharing the candidate's prefix needs such a
 * directory. Surviving candidates are fully consumed parses; callers
 * re-check them against the filesystem.
 */
function dirHasSegment(parent: string, segment: string): boolean {
	let entries: fs.Dirent[];
	try {
		entries = fs.readdirSync(parent, { withFileTypes: true });
	} catch {
		return false;
	}
	for (const entry of entries) {
		if (entry.name !== segment && !entry.name.startsWith(`${segment}-`)) continue;
		// Symlinks count (/var is one on macOS); a link to a non-directory dies
		// at the next level's readdir or the caller's final re-check.
		if (entry.isDirectory() || entry.isSymbolicLink()) return true;
	}
	return false;
}

function decodeSessionDirName(name: string): string[] {
	if (!name.startsWith("--") || !name.endsWith("--") || name.length <= 4) return [];
	const tokens = name.slice(2, -2).split("-");
	let candidates: { parent: string; segment: string }[] = [{ parent: "/", segment: tokens[0] }];
	for (const token of tokens.slice(1)) {
		const next: { parent: string; segment: string }[] = [];
		for (const candidate of candidates) {
			next.push({ parent: candidate.parent, segment: `${candidate.segment}-${token}` });
			if (dirHasSegment(candidate.parent, candidate.segment)) {
				next.push({ parent: path.join(candidate.parent, candidate.segment), segment: token });
			}
		}
		if (next.length === 0) return [];
		candidates = next;
	}
	return [...new Set(candidates.map((candidate) => path.join(candidate.parent, candidate.segment)))];
}

function sessionsParentDir(options: Options): string {
	return options.sessionsDir || process.env[SESSIONS_ENV_VAR] || path.join(os.homedir(), ".pi", "agent", "sessions");
}

/** Projects named by session dirs that decode to a real vault on disk. */
function knownVaults(state: VaultState, options: Options) {
	const parent = sessionsParentDir(options);
	let names: string[] = [];
	try {
		names = fs.readdirSync(parent);
	} catch {
		return [];
	}
	const found = new Map<string, string>();
	for (const name of names) {
		for (const decoded of decodeSessionDirName(name)) {
			if (!fs.existsSync(decoded) || !isVaultProject(decoded)) continue;
			found.set(decoded, decoded);
		}
	}
	return [...found.values()]
		.sort()
		.map((decoded) => ({ path: decoded, name: path.basename(decoded), loaded: state.vaults.has(path.resolve(decoded)) }));
}

/** Serialize all POST writes so concurrent reviews cannot interleave appends. */
function createWriteQueue(): (task: () => unknown) => Promise<unknown> {
	let tail: Promise<unknown> = Promise.resolve();
	return (task) => {
		const next = tail.then(task);
		tail = next.catch(() => {});
		return next;
	};
}

function sendJson(res: http.ServerResponse, status: number, data: unknown): void {
	const payload = JSON.stringify(data);
	res.writeHead(status, { "content-type": "application/json; charset=utf-8" });
	res.end(payload);
}

function readBody(req: http.IncomingMessage): Promise<string> {
	return new Promise((resolve, reject) => {
		const chunks: Buffer[] = [];
		let size = 0;
		req.on("data", (chunk: Buffer) => {
			size += chunk.length;
			if (size > MAX_BODY_BYTES) {
				reject(new HttpError(413, `Request body exceeds the ${MAX_BODY_BYTES} byte limit.`));
				// Drain the remainder so the client still receives the 413 instead of
				// a socket reset mid-upload.
				req.resume();
				return;
			}
			chunks.push(chunk);
		});
		req.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
		req.on("error", reject);
	});
}

/** Pi encodes the session directory as --<cwd with separators as hyphens>--. */
function encodeSessionDir(cwd: string): string {
	return `--${cwd.replace(/^[/\\]+/, "").replace(/[/\\:]/g, "-")}--`;
}

function findSessionFile(sessionsParent: string, cwd: string, sessionId: string): string | null {
	const dir = path.join(sessionsParent, encodeSessionDir(cwd));
	if (!fs.existsSync(dir)) return null;
	const suffix = `_${sessionId}.jsonl`;
	const matches = fs
		.readdirSync(dir)
		.filter((name) => name.endsWith(suffix))
		.sort();
	return matches.length > 0 ? path.join(dir, matches[matches.length - 1]) : null;
}

interface SessionEntry {
	type?: string;
	id?: string;
	parentId?: string | null;
	timestamp?: string;
	message?: { role?: string; content?: unknown };
}

function parseSessionEntries(file: string): SessionEntry[] {
	const lines = fs.readFileSync(file, "utf8").split("\n");
	const entries: SessionEntry[] = [];
	for (let i = 0; i < lines.length; i++) {
		const trimmed = lines[i].trim();
		if (!trimmed) continue;
		try {
			entries.push(JSON.parse(trimmed) as SessionEntry);
		} catch {
			// Tolerate a partially written trailing line, mirroring readRecords.
			if (i === lines.length - 1) break;
			throw new Error(`Malformed session entry at line ${i + 1} of ${file}`);
		}
	}
	return entries;
}

/**
 * Follow the active branch: among leaf entries (no child), prefer the longest
 * parentId chain, breaking ties by newest timestamp, then walk back to the
 * root. Compaction and context edits are not reconstructed here; this view is
 * a raw transcript of the branch the session file considers current.
 */
function activeBranch(entries: SessionEntry[]): SessionEntry[] {
	const byId = new Map<string, SessionEntry>();
	for (const entry of entries) {
		if (entry.id) byId.set(entry.id, entry);
	}
	const hasChild = new Set<string>();
	for (const entry of entries) {
		if (entry.parentId) hasChild.add(entry.parentId);
	}
	const chainLength = (entry: SessionEntry): number => {
		const seen = new Set<string>();
		let length = 0;
		let current: SessionEntry | undefined = entry;
		while (current && current.id && !seen.has(current.id)) {
			seen.add(current.id);
			length += 1;
			current = current.parentId ? byId.get(current.parentId) : undefined;
		}
		return length;
	};
	let leaf: SessionEntry | null = null;
	let bestLength = -1;
	for (const entry of entries) {
		if (!entry.id || hasChild.has(entry.id)) continue;
		const length = chainLength(entry);
		const newer =
			leaf === null ||
			length > bestLength ||
			(length === bestLength && (entry.timestamp ?? "") > (leaf.timestamp ?? ""));
		if (newer) {
			leaf = entry;
			bestLength = length;
		}
	}
	const branch: SessionEntry[] = [];
	const seen = new Set<string>();
	let current: SessionEntry | undefined = leaf ?? undefined;
	while (current && current.id && !seen.has(current.id)) {
		seen.add(current.id);
		branch.unshift(current);
		current = current.parentId ? byId.get(current.parentId) : undefined;
	}
	return branch;
}

/** Flatten message content blocks (text/thinking/toolCall/toolResult) to plain text. */
function flattenContent(content: unknown): string {
	if (typeof content === "string") return content;
	if (!Array.isArray(content)) return content === undefined || content === null ? "" : String(content);
	return content
		.map((block) => {
			if (typeof block === "string") return block;
			if (!block || typeof block !== "object") return "";
			const typed = block as Record<string, unknown>;
			if (typed.type === "text") return String(typed.text ?? "");
			if (typed.type === "thinking") return String(typed.thinking ?? "");
			if (typed.type === "toolCall") {
				return `toolCall ${String(typed.name ?? "?")} ${JSON.stringify(typed.arguments ?? {})}`;
			}
			if (typed.type === "toolResult") return flattenContent(typed.content);
			return "";
		})
		.filter((part) => part.length > 0)
		.join("\n");
}

function mostCommon(values: string[]): string | null {
	const counts = new Map<string, number>();
	for (const value of values) counts.set(value, (counts.get(value) ?? 0) + 1);
	let best: string | null = null;
	let bestCount = 0;
	for (const [value, count] of counts) {
		if (count > bestCount) {
			best = value;
			bestCount = count;
		}
	}
	return best;
}

function graphFor(root: string, trace: string) {
	const records = readRecords(path.join(root, trace, "trace.jsonl"));
	const nodes = records.map((record) => ({
		id: record.id,
		kind: record.kind,
		title: record.title,
		...(record.failureClass !== undefined ? { failureClass: record.failureClass } : {}),
		...(record.agent !== undefined ? { agent: record.agent } : {}),
		...(record.confidence !== undefined ? { confidence: record.confidence } : {}),
		ts: record.ts,
	}));
	const edges = records.flatMap((record) =>
		(record.supports ?? []).map((target) => ({ source: record.id, target })),
	);
	const sessions = records.map((record) => record.session).filter((value): value is string => Boolean(value));
	return { trace, nodes, edges, session: mostCommon(sessions) };
}

function listTraces(root: string) {
	return traceNames(root).map((name) => {
		const dir = path.join(root, name);
		let created: string | null = null;
		try {
			const meta = JSON.parse(fs.readFileSync(path.join(dir, "meta.json"), "utf8")) as { created?: string };
			created = meta.created ?? null;
		} catch {
			// A trace without readable meta still lists; created stays null.
		}
		return { trace: name, recordCount: readRecords(path.join(dir, "trace.jsonl")).length, created };
	}).sort((a, b) => {
		// Newest first. Traces without a readable created timestamp sink to the
		// bottom; ties fall back to name so the order stays deterministic.
		if (a.created === b.created) return a.trace.localeCompare(b.trace);
		if (a.created === null) return 1;
		if (b.created === null) return -1;
		return b.created.localeCompare(a.created);
	});
}

function patterns(root: string) {
	// Failure classes matter most on deadend records, so include them here even
	// though the default outline view hides them.
	return groupPatterns(root, traceNames(root), { includeDeadends: true }).map((group) => ({
		failureClass: group.failureClass,
		count: group.records.length,
		traceCount: group.traces.size,
		agents: [...group.agents].sort(),
		records: group.records.map(({ trace, record }) => ({
			trace,
			id: record.id,
			kind: record.kind,
			title: record.title,
		})),
	}));
}

function serveStatic(req: http.IncomingMessage, res: http.ServerResponse, pathname: string): void {
	const decoded = decodeURIComponent(pathname);
	const candidate = path.normalize(path.join(DIST_DIR, decoded));
	if (!candidate.startsWith(DIST_DIR)) {
		sendJson(res, 403, { error: "forbidden" });
		return;
	}
	const file = fs.existsSync(candidate) && fs.statSync(candidate).isFile() ? candidate : path.join(DIST_DIR, "index.html");
	if (!fs.existsSync(file)) {
		sendJson(res, 404, { error: "viewer build missing; run npm run build in trace-viewer/" });
		return;
	}
	res.writeHead(200, { "content-type": MIME_TYPES[path.extname(file)] ?? "application/octet-stream" });
	fs.createReadStream(file).pipe(res);
}

async function handleRequest(options: Options, state: VaultState, enqueue: (task: () => unknown) => Promise<unknown>, req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
	// Local binding alone does not prevent hostile-site requests or DNS rebinding.
	const port = (req.socket.address() as {port?:number}).port;
	const trusted = new Set([`localhost:${port}`, `127.0.0.1:${port}`]);
	if (!trusted.has(req.headers.host ?? "")) throw new HttpError(403, "Untrusted Host.");
	if (req.method !== "GET" && req.method !== "HEAD") {
		if (req.headers.origin !== undefined && ![...trusted].some(host => req.headers.origin === `http://${host}`)) throw new HttpError(403, "Untrusted Origin.");
		if (req.headers["content-type"]?.split(";")[0].trim().toLowerCase() !== "application/json") throw new HttpError(415, "Mutations require application/json.");
	}
	const url = new URL(req.url ?? "/", "http://localhost");
	const segments = url.pathname.split("/").filter(Boolean);

	if (req.method === "GET" && url.pathname === "/api/vaults") {
		sendJson(res, 200, [...state.vaults.values()].map((vault) => describeVault(state, vault)));
		return;
	}

	if (req.method === "GET" && url.pathname === "/api/vaults/known") {
		sendJson(res, 200, knownVaults(state, options));
		return;
	}

	if (req.method === "POST" && url.pathname === "/api/vaults") {
		const raw = await readBody(req);
		let body: unknown;
		try {
			body = JSON.parse(raw);
		} catch {
			throw new HttpError(400, "Request body must be valid JSON.");
		}
		const input = body as { path?: unknown };
		if (typeof input.path !== "string" || input.path.trim().length === 0) {
			throw new HttpError(400, "path must be a non-empty string.");
		}
		const candidate = path.resolve(input.path.trim());
		if (!fs.existsSync(candidate)) {
			throw new HttpError(404, `Path does not exist: ${candidate}`);
		}
		if (!isVaultProject(candidate)) {
			throw new HttpError(400, `${candidate} contains no ${TRACE_ROOT} directory.`);
		}
		// Re-adding a loaded vault is idempotent, not an error.
		if (!state.vaults.has(candidate)) {
			await enqueue(() => {
				state.vaults.set(candidate, { path: candidate, root: path.join(candidate, TRACE_ROOT) });
				writePersistedVaults(state);
			});
		}
		sendJson(res, 200, describeVault(state, state.vaults.get(candidate)!));
		return;
	}

	if (req.method === "GET" && url.pathname === "/api/traces") {
		sendJson(res, 200, listTraces(resolveVault(state, url.searchParams.get("vault")).root));
		return;
	}

	if (segments[0] === "api" && segments[1] === "trace" && segments[2]) {
		let trace: string;
		try {
			trace = normalizeTraceId(decodeURIComponent(segments[2]));
		} catch {
			throw new HttpError(400, `Invalid trace id: ${segments[2]}`);
		}
		const vault = resolveVault(state, url.searchParams.get("vault"));
		const root = vault.root;
		const dir = path.join(root, trace);
		const isWrite = req.method === "POST" && segments[3] === "review";

		if (req.method === "GET" && segments.length === 3) {
			if (!fs.existsSync(dir)) throw new HttpError(404, `Unknown trace: ${trace}`);
			sendJson(res, 200, graphFor(root, trace));
			return;
		}

		if (req.method === "GET" && segments[3] === "record" && segments[4]) {
			const record = readRecords(path.join(dir, "trace.jsonl")).find((candidate) => candidate.id === segments[4]);
			if (!record) throw new HttpError(404, `Unknown record: ${segments[4]}`);
			sendJson(res, 200, record);
			return;
		}

		if (req.method === "GET" && segments[3] === "session") {
			const { session } = graphFor(root, trace);
			if (!session) throw new HttpError(404, "session unknown");
			const file = findSessionFile(sessionsParentDir(options), vault.path, session);
			if (!file) throw new HttpError(404, "session unknown");
			const branch = activeBranch(parseSessionEntries(file));
			const messages = branch
				.filter((entry) => entry.type === "message" && entry.message && entry.message.role !== "system")
				.map((entry) => ({
					role: entry.message!.role ?? "unknown",
					text: flattenContent(entry.message!.content),
					ts: entry.timestamp ?? "",
				}));
			sendJson(res, 200, { sessionId: session, messages });
			return;
		}

		if (req.method === "GET" && segments[3] === "patterns") {
			sendJson(res, 200, patterns(root));
			return;
		}

		if (req.method === "POST" && segments[3] === "review-deletions" && ["preview", "commit"].includes(segments[4]) && segments.length === 5) {
			if (!fs.existsSync(path.join(dir, "trace.jsonl"))) throw new HttpError(404, "Unknown trace.");
			let input: {selection?:unknown; authorization?:unknown};
			try { input = JSON.parse(await readBody(req)); } catch (error) { if (error instanceof HttpError) throw error; throw new HttpError(400, "Invalid JSON."); }
			if (!input || !Array.isArray(input.selection) || !input.selection.length || input.selection.some(s => !s || typeof s.id !== "string" || !s.snapshot || s.snapshot.id !== s.id || s.snapshot.kind !== "review" || typeof s.snapshot.title !== "string" || typeof s.snapshot.body !== "string") || new Set(input.selection.map(s => s.id)).size !== input.selection.length) throw new HttpError(400, "selection must contain unique review ids and prior snapshots.");
			if (segments[4] === "commit" && typeof input.authorization !== "string") throw new HttpError(400, "Commit requires preview authorization.");
			const result = await enqueue(() => deleteReviews(root, trace, input.selection as ReviewSelection[], segments[4] === "commit" ? input.authorization as string : undefined)) as ReturnType<typeof deleteReviews>;
			sendJson(res, result.status, result.body); return;
		}

		if (isWrite && segments.length === 4) {
			const raw = await readBody(req);
			let body: unknown;
			try {
				body = JSON.parse(raw);
			} catch {
				throw new HttpError(400, "Request body must be valid JSON.");
			}
			const input = body as { targetIds?: unknown; text?: unknown; failureClass?: unknown };
			if (!Array.isArray(input.targetIds) || input.targetIds.some((id) => typeof id !== "string")) {
				throw new HttpError(400, "targetIds must be an array of record ids.");
			}
			if (typeof input.text !== "string" || input.text.trim().length === 0) {
				throw new HttpError(400, "text must be a non-empty string.");
			}
			if (input.failureClass !== undefined && typeof input.failureClass !== "string") {
				throw new HttpError(400, "failureClass must be a string.");
			}
			const title = input.text.trim().slice(0, REVIEW_TITLE_MAX);
			let record: TraceRecord;
			try {
				record = (await enqueue(() =>
					appendReview(root, trace, {
						title,
						body: input.text as string,
						targetIds: input.targetIds as string[],
						...(typeof input.failureClass === "string" && input.failureClass.trim() ? { failureClass: input.failureClass } : {}),
						agent: "human",
					}),
				)) as TraceRecord;
			} catch (error) {
				// appendReview validates title/body/failureClass/target ids; all of those
				// are client input problems, not server faults.
				throw new HttpError(400, error instanceof Error ? error.message : String(error));
			}
			sendJson(res, 200, record);
			return;
		}
	}

	if (req.method === "GET") {
		serveStatic(req, res, url.pathname);
		return;
	}

	throw new HttpError(404, "not found");
}

export function startServer(options: Options): Promise<{ port: number; close: () => Promise<void> }> {
	const enqueue = createWriteQueue();
	const state = createVaultState(options);
	const server = http.createServer((req, res) => {
		handleRequest(options, state, enqueue, req, res).catch((error: unknown) => {
			if (res.headersSent) return;
			if (error instanceof HttpError) sendJson(res, error.status, { error: error.message });
			else {
				sendJson(res, 500, { error: error instanceof Error ? error.message : String(error) });
			}
		});
	});
	const close = () => new Promise<void>((resolve) => server.close(() => resolve()));
	return new Promise((resolve, reject) => {
		const attempt = (port: number, remaining: number): void => {
			server.once("error", (error: NodeJS.ErrnoException) => {
				if (error.code === "EADDRINUSE" && remaining > 0) attempt(port + 1, remaining - 1);
				else reject(error);
			});
			server.listen(port, "127.0.0.1", () => {
				const address = server.address();
				resolve({ port: typeof address === "object" && address ? address.port : port, close });
			});
		};
		attempt(options.port, MAX_PORT_ATTEMPTS);
	});
}

const isMain = process.argv[1] !== undefined && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
	try {
		const options = parseArgs(process.argv.slice(2));
		const { port } = await startServer(options);
		// Match the IPv4 bind address: localhost may resolve to an older IPv6 listener.
		console.log(`http://127.0.0.1:${port}/${options.trace ? `?trace=${encodeURIComponent(options.trace)}` : ""}`);
	} catch (error) {
		console.error(error instanceof Error ? error.message : error);
		process.exit(1);
	}
}
