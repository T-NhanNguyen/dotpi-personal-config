/**
 * Shared trace logic and review append API. No pi imports: the traces extension and the
 * trace-viewer server both consume this module so read semantics, slug
 * validation, and pattern aggregation cannot drift between writer and viewer.
 */

import * as fs from "node:fs";
import * as path from "node:path";
import { withTraceLock, readStrict, reserveId, appendRecord } from "./mutation.ts";

export const TRACE_ROOT = path.join(".dev-vault", "traces");
export const MAX_BODY = 1200;
export const MAX_TITLE = 200;
export const KINDS = ["finding", "decision", "concept", "path", "evidence", "deadend", "review"] as const;
export const CONFIDENCE = ["verified", "inferred", "unverified"] as const;

export type Kind = (typeof KINDS)[number];

export interface TraceRef {
	type: string;
	path?: string;
	lines?: string;
	page?: string;
	note?: string;
}

export interface TraceStep {
	action: string;
	ref: string;
}

export interface TraceCheck {
	method: string;
	output: string;
	revision?: string;
}

export interface TraceRecord {
	id: string;
	trace: string;
	kind: Kind;
	title: string;
	body: string;
	refs: TraceRef[];
	supports?: string[];
	confidence?: string;
	check?: TraceCheck;
	steps?: TraceStep[];
	agent?: string;
	failureClass?: string;
	session?: string;
	ts: string;
}

export const ID_PREFIX: Record<Kind, string> = {
	finding: "f",
	decision: "d",
	concept: "c",
	path: "p",
	evidence: "e",
	deadend: "x",
	review: "r",
};

export function traceRoot(ctxCwd: string): string {
	return path.join(ctxCwd, TRACE_ROOT);
}

export function normalizeTraceId(raw: string): string {
	const id = raw.trim().toLowerCase();
	if (!/^[a-z0-9][a-z0-9._-]*$/.test(id)) {
		throw new Error("Trace id must be a lowercase slug: letters, digits, dot, underscore, hyphen; no slashes.");
	}
	return id;
}

export function normalizeFailureClass(raw: string): string {
	const failureClass = raw.trim().toLowerCase();
	if (!/^[a-z0-9][a-z0-9._-]*$/.test(failureClass)) {
		throw new Error("Failure class must be a lowercase slug: letters, digits, dot, underscore, hyphen; no spaces or slashes.");
	}
	if (PLACEHOLDER_FAILURE_CLASSES.has(failureClass)) {
		throw new Error(`Failure class "${failureClass}" is a placeholder, not a pattern. Name the concrete failure, e.g. missing-test-host.`);
	}
	return failureClass;
}

const PLACEHOLDER_FAILURE_CLASSES = new Set(["na", "n-a", "none", "null", "test", "todo", "tbd", "unknown"]);

export function readRecords(file: string): TraceRecord[] {
	if (!fs.existsSync(file)) return [];
	const text = fs.readFileSync(file, "utf8");
	const lines = text
		.split("\n")
		.map((line, index) => ({ line: line.trim(), index }))
		.filter((entry) => entry.line.length > 0);
	const records: TraceRecord[] = [];
	for (let i = 0; i < lines.length; i++) {
		try {
			records.push(JSON.parse(lines[i].line) as TraceRecord);
		} catch {
			// Tolerate a partially written trailing record, but never hide corruption mid-file.
			if (i === lines.length - 1) break;
			throw new Error(`Malformed trace record at line ${lines[i].index + 1} of ${file}`);
		}
	}
	return records;
}

export function nextRecordId(kind: Kind, records: TraceRecord[]): string {
	const prefix = ID_PREFIX[kind];
	const used = new Set(records.map((record) => record.id));
	let n = 1;
	while (used.has(`${prefix}${n}`)) n += 1;
	return `${prefix}${n}`;
}

export function ensureTrace(dir: string, trace: string): void {
	fs.mkdirSync(dir, { recursive: true });
	const metaFile = path.join(dir, "meta.json");
	if (!fs.existsSync(metaFile)) {
		fs.writeFileSync(
			metaFile,
			`${JSON.stringify({ trace, created: new Date().toISOString() }, null, 2)}\n`,
			{ encoding: "utf8" },
		);
	}
}

export function traceNames(root: string): string[] {
	if (!fs.existsSync(root)) return [];
	return fs
		.readdirSync(root, { withFileTypes: true })
		.filter((entry) => entry.isDirectory())
		.map((entry) => entry.name)
		.sort();
}

export function visible(record: TraceRecord, includeDeadends: boolean): boolean {
	return includeDeadends || record.kind !== "deadend";
}

export interface PatternRecordRef {
	trace: string;
	id: string;
	kind: Kind;
	title: string;
}

export interface PatternGroup {
	failureClass: string;
	count: number;
	traceCount: number;
	agents: string[];
	records: PatternRecord[];
}

export interface PatternRecord {
	trace: string;
	record: TraceRecord;
}

/**
 * Group records carrying failureClass across the given traces, sorted
 * repeat-first: record count, then trace count, then slug.
 */
export function groupPatterns(
	root: string,
	names: string[],
	options: { kind?: Kind; includeDeadends?: boolean } = {},
): { failureClass: string; records: PatternRecord[]; traces: Set<string>; agents: Set<string> }[] {
	const groups = new Map<string, { records: PatternRecord[]; traces: Set<string>; agents: Set<string> }>();
	for (const name of names) {
		for (const record of readRecords(path.join(root, name, "trace.jsonl"))) {
			if (!record.failureClass || !visible(record, options.includeDeadends ?? false)) continue;
			if (options.kind && record.kind !== options.kind) continue;
			const group = groups.get(record.failureClass) ?? { records: [], traces: new Set<string>(), agents: new Set<string>() };
			group.records.push({ trace: name, record });
			group.traces.add(name);
			if (record.agent) group.agents.add(record.agent);
			groups.set(record.failureClass, group);
		}
	}
	return [...groups.entries()]
		.map(([failureClass, group]) => ({ failureClass, ...group }))
		.sort((a, b) => b.records.length - a.records.length || b.traces.size - a.traces.size || a.failureClass.localeCompare(b.failureClass));
}

/**
 * Append a review record authored by a human reviewer. Uses the same
 * validation and durable id allocation as the extension, under a filesystem lock.
 */
export function appendReview(
	root: string,
	trace: string,
	input: { title: string; body: string; targetIds: string[]; failureClass?: string; agent?: string },
): TraceRecord {
	const name = normalizeTraceId(trace);
	const title = input.title.trim();
	const body = input.body.trim();
	if (!title) throw new Error("Title must not be empty.");
	if (title.length > MAX_TITLE) throw new Error(`Title must be ${MAX_TITLE} characters or fewer.`);
	if (!body) throw new Error("Body must not be empty.");
	if (body.length > MAX_BODY) throw new Error(`Body must be ${MAX_BODY} characters or fewer.`);
	const failureClass = input.failureClass === undefined ? undefined : normalizeFailureClass(input.failureClass);
	const dir = path.join(root, name);
	const file = path.join(dir, "trace.jsonl");
	return withTraceLock(file, () => {
	ensureTrace(dir, name);
	const { raw, entries } = readStrict(file);
	const records = entries.flatMap(e => e.record ? [e.record] : []);
	const missing = input.targetIds.filter((id) => !records.some((candidate) => candidate.id === id));
	if (missing.length > 0) throw new Error(`Unknown review target ids: ${missing.join(", ")}.`);
	const record: TraceRecord = {
		id: reserveId(file, "review", records),
		trace: name,
		kind: "review",
		title,
		body,
		refs: [{ type: "review", note: `human review of ${input.targetIds.join(", ") || "the trace"}` }],
		...(input.targetIds.length ? { supports: input.targetIds } : {}),
		...(failureClass ? { failureClass } : {}),
		agent: input.agent ?? "human",
		ts: new Date().toISOString(),
	};
	appendRecord(file, record, raw);
	return record;
	});
}
