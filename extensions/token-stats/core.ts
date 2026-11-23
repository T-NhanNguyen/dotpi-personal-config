/**
 * Pure parsing and formatting for the token-stats extension. No pi imports so the
 * logic is testable outside the harness and cannot drift from the command wiring.
 *
 * Session transcripts live in <agentDir>/sessions/<encoded-cwd>/<ts>_<id>.jsonl.
 * Every entry is one JSON line; assistant messages carry per-message `usage`.
 */

import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

export interface UsageSum {
	input: number;
	output: number;
	cacheRead: number;
	cacheWrite: number;
	reasoning: number;
	cost: number;
}

export interface ToolResultStat {
	count: number;
	bytes: number;
	errors: number;
	durationMs: number;
}

export interface SessionStats {
	id: string;
	file: string;
	cwd: string;
	started: string;
	lastTs: string;
	durationMs: number;
	models: string[];
	usage: UsageSum;
	perModel: Map<string, UsageSum>;
	messages: { user: number; assistant: number; toolResult: number };
	toolCalls: Map<string, number>;
	toolResults: Map<string, ToolResultStat>;
	subagentCalls: number;
}

export function encodeCwd(cwd: string): string {
	return `--${cwd.replace(/^[/\\]/, "").replace(/[/\\:]/g, "-")}--`;
}

export function sessionsRoot(): string {
	const agentDir = process.env.PI_AGENT_DIR ?? path.join(os.homedir(), ".pi", "agent");
	return path.join(agentDir, "sessions");
}

function emptyUsage(): UsageSum {
	return { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, reasoning: 0, cost: 0 };
}

function addUsage(target: UsageSum, usage: Record<string, unknown>): void {
	target.input += Number(usage.input ?? 0);
	target.output += Number(usage.output ?? 0);
	target.cacheRead += Number(usage.cacheRead ?? 0);
	target.cacheWrite += Number(usage.cacheWrite ?? 0);
	target.reasoning += Number(usage.reasoning ?? 0);
	const cost = usage.cost as { total?: number } | undefined;
	target.cost += Number(cost?.total ?? 0);
}

export function parseSessionFile(file: string): SessionStats | undefined {
	let text: string;
	try {
		text = fs.readFileSync(file, "utf8");
	} catch {
		return undefined;
	}
	let header: { id?: string; cwd?: string; timestamp?: string } | undefined;
	const stats: SessionStats = {
		id: path.basename(file, ".jsonl"),
		file,
		cwd: "",
		started: "",
		lastTs: "",
		durationMs: 0,
		models: [],
		usage: emptyUsage(),
		perModel: new Map(),
		messages: { user: 0, assistant: 0, toolResult: 0 },
		toolCalls: new Map(),
		toolResults: new Map(),
		subagentCalls: 0,
	};
	const modelsSeen = new Set<string>();
	let currentModel = "(unknown)";
	for (const line of text.split("\n")) {
		const trimmed = line.trim();
		if (!trimmed) continue;
		let entry: Record<string, unknown>;
		try {
			entry = JSON.parse(trimmed) as Record<string, unknown>;
		} catch {
			continue; // tolerate a partially written trailing line
		}
		const ts = typeof entry.timestamp === "string" ? entry.timestamp : "";
		if (ts && (!stats.lastTs || ts > stats.lastTs)) stats.lastTs = ts;
		if (entry.type === "session") {
			header = entry as typeof header;
			stats.id = header?.id ?? stats.id;
			stats.cwd = header?.cwd ?? "";
			stats.started = header?.timestamp ?? "";
			continue;
		}
		if (entry.type === "model_change") {
			const provider = String(entry.provider ?? "");
			const modelId = String(entry.modelId ?? "");
			currentModel = modelId ? `${provider}/${modelId}` : provider || currentModel;
			if (!modelsSeen.has(currentModel)) {
				modelsSeen.add(currentModel);
				stats.models.push(currentModel);
			}
			continue;
		}
		if (entry.type !== "message") continue;
		const message = entry.message as {
			role?: string;
			usage?: Record<string, unknown>;
			content?: unknown;
			toolName?: string;
			isError?: boolean;
			durationMs?: number;
		};
		if (!message || typeof message !== "object") continue;
		if (message.role === "user") stats.messages.user += 1;
		if (message.role === "toolResult") {
			stats.messages.toolResult += 1;
			const name = message.toolName ?? "(unknown)";
			const prev = stats.toolResults.get(name) ?? { count: 0, bytes: 0, errors: 0, durationMs: 0 };
			prev.count += 1;
			prev.errors += message.isError ? 1 : 0;
			prev.durationMs += Number(message.durationMs ?? 0);
			const content = message.content;
			if (Array.isArray(content)) {
				for (const part of content) {
					if (part && typeof part === "object" && typeof (part as { text?: unknown }).text === "string") {
						prev.bytes += ((part as { text: string }).text).length;
					}
				}
			}
			stats.toolResults.set(name, prev);
			continue;
		}
		if (message.role !== "assistant") continue;
		stats.messages.assistant += 1;
		if (message.usage) {
			addUsage(stats.usage, message.usage);
			const bucket = stats.perModel.get(currentModel) ?? emptyUsage();
			addUsage(bucket, message.usage);
			stats.perModel.set(currentModel, bucket);
		}
		const content = message.content;
		if (Array.isArray(content)) {
			for (const part of content) {
				if (part && typeof part === "object" && (part as { type?: unknown }).type === "toolCall") {
					const name = String((part as { name?: unknown }).name ?? "(unknown)");
					stats.toolCalls.set(name, (stats.toolCalls.get(name) ?? 0) + 1);
					if (name === "subagent") stats.subagentCalls += 1;
				}
			}
		}
	}
	if (!header) return undefined;
	if (stats.started && stats.lastTs) {
		stats.durationMs = Math.max(0, Date.parse(stats.lastTs) - Date.parse(stats.started));
	}
	return stats;
}

export function listSessionFiles(dir: string): string[] {
	try {
		return fs
			.readdirSync(dir)
			.filter((name) => name.endsWith(".jsonl"))
			.map((name) => path.join(dir, name))
			.sort();
	} catch {
		return [];
	}
}

export function projectDirs(root: string): { project: string; dir: string }[] {
	try {
		return fs
			.readdirSync(root, { withFileTypes: true })
			.filter((entry) => entry.isDirectory())
			.map((entry) => ({ project: entry.name, dir: path.join(root, entry.name) }));
	} catch {
		return [];
	}
}

export interface TraceLinkage {
	recordCount: number;
	withSession: number;
	sessionIds: string[];
}

/**
 * Collect the session ids stamped on a trace's records. trace_append has recorded
 * the writing session's id since mid-November 2026; older records have none.
 */
export function traceLinkage(traceFile: string): TraceLinkage | undefined {
	let text: string;
	try {
		text = fs.readFileSync(traceFile, "utf8");
	} catch {
		return undefined;
	}
	const sessionIds = new Set<string>();
	let recordCount = 0;
	for (const line of text.split("\n")) {
		const trimmed = line.trim();
		if (!trimmed) continue;
		let record: { session?: unknown };
		try {
			record = JSON.parse(trimmed) as { session?: unknown };
		} catch {
			continue;
		}
		recordCount += 1;
		if (typeof record.session === "string" && record.session) sessionIds.add(record.session);
	}
	return { recordCount, withSession: sessionIds.size, sessionIds: [...sessionIds] };
}

/** Find transcript files whose filename ends in _<sessionId>.jsonl, across every project dir. */
export function findSessionsById(root: string, ids: string[]): { found: Map<string, string>; missing: string[] } {
	const wanted = new Set(ids);
	const found = new Map<string, string>();
	for (const { dir } of projectDirs(root)) {
		for (const file of listSessionFiles(dir)) {
			// Transcript filenames are <timestamp>_<sessionId>.jsonl and timestamps
			// contain no underscore, so the id is everything after the last one.
			const match = /_([^_]+)\.jsonl$/.exec(path.basename(file));
			const id = match?.[1];
			if (id && wanted.has(id) && !found.has(id)) found.set(id, file);
		}
	}
	return { found, missing: ids.filter((id) => !found.has(id)) };
}

export interface Rollup {
	sessions: number;
	usage: UsageSum;
	toolCalls: Map<string, number>;
	toolResults: Map<string, ToolResultStat>;
	subagentCalls: number;
	models: Set<string>;
	totalDurationMs: number;
}

export function aggregate(sessions: SessionStats[]): Rollup {
	const rollup: Rollup = {
		sessions: sessions.length,
		usage: emptyUsage(),
		toolCalls: new Map(),
		toolResults: new Map(),
		subagentCalls: 0,
		models: new Set(),
		totalDurationMs: 0,
	};
	for (const session of sessions) {
		const u = rollup.usage;
		u.input += session.usage.input;
		u.output += session.usage.output;
		u.cacheRead += session.usage.cacheRead;
		u.cacheWrite += session.usage.cacheWrite;
		u.reasoning += session.usage.reasoning;
		u.cost += session.usage.cost;
		rollup.subagentCalls += session.subagentCalls;
		rollup.totalDurationMs += session.durationMs;
		for (const model of session.models) rollup.models.add(model);
		for (const [name, count] of session.toolCalls) {
			rollup.toolCalls.set(name, (rollup.toolCalls.get(name) ?? 0) + count);
		}
		for (const [name, result] of session.toolResults) {
			const prev = rollup.toolResults.get(name) ?? { count: 0, bytes: 0, errors: 0, durationMs: 0 };
			prev.count += result.count;
			prev.bytes += result.bytes;
			prev.errors += result.errors;
			prev.durationMs += result.durationMs;
			rollup.toolResults.set(name, prev);
		}
	}
	return rollup;
}

export function formatTokens(n: number): string {
	if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(2)}M`;
	if (n >= 10_000) return `${(n / 1_000).toFixed(1)}k`;
	if (n >= 1_000) return `${(n / 1_000).toFixed(2)}k`;
	return String(Math.round(n));
}

export function formatCost(n: number): string {
	return n >= 1 ? `$${n.toFixed(2)}` : `$${n.toFixed(4)}`;
}

export function formatDuration(ms: number): string {
	if (ms <= 0) return "-";
	const minutes = Math.floor(ms / 60_000);
	if (minutes < 60) return `${minutes}m`;
	return `${Math.floor(minutes / 60)}h${String(minutes % 60).padStart(2, "0")}m`;
}

function usageTotals(u: UsageSum): string {
	return `in=${formatTokens(u.input)} out=${formatTokens(u.output)} cache=${formatTokens(u.cacheRead + u.cacheWrite)} cost=${formatCost(u.cost)}`;
}

function topEntries<V>(map: Map<string, V>, score: (v: V) => number, n: number): [string, V][] {
	return [...map.entries()].sort((a, b) => score(b[1]) - score(a[1])).slice(0, n);
}

export function renderSessionDetail(stats: SessionStats): string[] {
	const lines: string[] = [];
	const date = stats.started.slice(0, 16).replace("T", " ");
	lines.push(`session ${stats.id.slice(0, 8)} | ${date} | ${formatDuration(stats.durationMs)}`);
	lines.push(`models: ${stats.models.join(", ") || "(none recorded)"}`);
	lines.push(
		`messages: user=${stats.messages.user} assistant=${stats.messages.assistant} toolResults=${stats.messages.toolResult} | subagent calls: ${stats.subagentCalls}`,
	);
	lines.push(`tokens: ${usageTotals(stats.usage)}`);
	if (stats.usage.reasoning > 0) lines.push(`reasoning tokens: ${formatTokens(stats.usage.reasoning)}`);
	if (stats.perModel.size > 1) {
		lines.push("per-model:");
		for (const [model, u] of topEntries(stats.perModel, (v) => v.cost, 6)) {
			lines.push(`  ${model}: ${usageTotals(u)}`);
		}
	}
	if (stats.toolCalls.size > 0) {
		lines.push("tool calls:");
		for (const [name, count] of topEntries(stats.toolCalls, (v) => v, 8)) {
			const result = stats.toolResults.get(name);
			const extra = result
				? ` | results ~${formatTokens(Math.round(result.bytes / 4))} tok, ${formatDuration(result.durationMs)}${result.errors ? `, ${result.errors} errors` : ""}`
				: "";
			lines.push(`  ${name}: ${count}${extra}`);
		}
	}
	return lines;
}

export function renderSessionTable(sessions: SessionStats[], limit: number): string[] {
	const rows = [...sessions].sort((a, b) => (a.started < b.started ? 1 : -1)).slice(0, limit);
	if (rows.length === 0) return ["No sessions found."];
	const header = `${"date".padEnd(16)} ${"dur".padEnd(6)} ${"in".padStart(8)} ${"out".padStart(8)} ${"cache".padStart(9)} ${"cost".padStart(8)} ${"msgs".padStart(5)} ${"sub".padStart(4)}  top-tools`;
	const lines = [header, "-".repeat(header.length + 20)];
	for (const s of rows) {
		const date = s.started.slice(0, 16).replace("T", " ");
		const msgs = s.messages.user + s.messages.assistant + s.messages.toolResult;
		const tools = topEntries(s.toolCalls, (v) => v, 3)
			.map(([name, count]) => `${name}×${count}`)
			.join(" ");
		lines.push(
			`${date.padEnd(16)} ${formatDuration(s.durationMs).padEnd(6)} ${formatTokens(s.usage.input).padStart(8)} ${formatTokens(s.usage.output).padStart(8)} ${formatTokens(s.usage.cacheRead + s.usage.cacheWrite).padStart(9)} ${formatCost(s.usage.cost).padStart(8)} ${String(msgs).padStart(5)} ${String(s.subagentCalls).padStart(4)}  ${tools}`,
		);
	}
	return lines;
}

export function renderTraceStats(
	trace: string,
	linkage: TraceLinkage,
	sessions: SessionStats[],
	missing: string[],
): string[] {
	const lines: string[] = [];
	lines.push(
		`trace ${trace}: ${linkage.recordCount} records, ${linkage.sessionIds.length} linked sessions` +
			(missing.length > 0 ? ` (${missing.length} transcripts not found on this machine)` : ""),
	);
	if (linkage.recordCount > 0 && linkage.sessionIds.length === 0) {
		lines.push("No records carry a session id (they predate session stamping); cost is not attributable.");
		return lines;
	}
	lines.push(...renderRollup("linked sessions", sessions));
	return lines;
}

export function renderRollup(title: string, sessions: SessionStats[]): string[] {
	if (sessions.length === 0) return [`${title}: no sessions found.`];
	const rollup = aggregate(sessions);
	const lines: string[] = [];
	lines.push(`${title}: ${rollup.sessions} sessions | ${formatDuration(rollup.totalDurationMs)} wall span`);
	lines.push(`tokens: ${usageTotals(rollup.usage)} | reasoning=${formatTokens(rollup.usage.reasoning)}`);
	lines.push(`models: ${[...rollup.models].join(", ") || "(none recorded)"}`);
	lines.push(`subagent calls: ${rollup.subagentCalls}`);
	if (rollup.toolCalls.size > 0) {
		lines.push("top tools by calls:");
		for (const [name, count] of topEntries(rollup.toolCalls, (v) => v, 8)) {
			const result = rollup.toolResults.get(name);
			const extra = result ? ` (~${formatTokens(Math.round(result.bytes / 4))} tok back, ${result.errors} errors)` : "";
			lines.push(`  ${name}: ${count}${extra}`);
		}
		const byBytes = topEntries(rollup.toolResults, (v) => v.bytes, 5);
		if (byBytes.length > 0) {
			lines.push("top tools by context fed back (est. tokens):");
			for (const [name, result] of byBytes) {
				lines.push(`  ${name}: ~${formatTokens(Math.round(result.bytes / 4))} tok in ${result.count} results`);
			}
		}
	}
	return lines;
}
