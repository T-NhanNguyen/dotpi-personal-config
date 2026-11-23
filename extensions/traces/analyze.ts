/**
 * Deterministic corpus analysis for /trace-analyze. Pure computation over
 * trace.jsonl files - no pi imports, no LLM tokens. The report is the input
 * to the optional `deep` pass, where an agent samples the flagged traces.
 */

import * as fs from "node:fs";
import * as path from "node:path";
import {
	KINDS,
	readRecords,
	traceNames,
	type Kind,
	type TraceRecord,
} from "./core.js";

export interface TraceAnalysis {
	name: string;
	records: number;
	kinds: Partial<Record<Kind, number>>;
	withSupports: number;
	withSession: number;
	withAgent: number;
	verifiedWithoutCheck: number;
	deadends: number;
	failureClasses: string[];
	failureClassCounts: Record<string, number>;
	checkMethods: Set<string>;
	bytes: number;
	firstTs: string;
	lastTs: string;
	largest: { id: string; bytes: number; title: string } | undefined;
}

export interface CorpusAnalysis {
	traces: TraceAnalysis[];
	totalRecords: number;
	totalBytes: number;
	kindTotals: Partial<Record<Kind, number>>;
	failureClasses: { failureClass: string; count: number; traces: string[] }[];
	zeroDeadendTraces: string[];
	zeroSupportsTraces: string[];
	largestRecords: { trace: string; id: string; bytes: number; title: string }[];
	supportRate: number;
	sessionRate: number;
	agentRate: number;
	verifiedWithoutCheck: number;
	checkMethodVocabulary: number;
}

function analyzeTrace(root: string, name: string): TraceAnalysis {
	const file = path.join(root, name, "trace.jsonl");
	const records = readRecords(file);
	let bytes = 0;
	try {
		bytes = fs.statSync(file).size;
	} catch {
		// unreadable files analyze as empty
	}
	const kinds: Partial<Record<Kind, number>> = {};
	let withSupports = 0;
	let withSession = 0;
	let withAgent = 0;
	let verifiedWithoutCheck = 0;
	let deadends = 0;
	const failureClasses = new Set<string>();
	const failureClassCounts: Record<string, number> = {};
	const checkMethods = new Set<string>();
	let firstTs = "";
	let lastTs = "";
	let largest: TraceAnalysis["largest"];
	for (const record of records) {
		kinds[record.kind] = (kinds[record.kind] ?? 0) + 1;
		if (record.supports?.length) withSupports += 1;
		if (record.session) withSession += 1;
		if (record.agent) withAgent += 1;
		if (record.confidence === "verified" && !record.check?.output?.trim()) verifiedWithoutCheck += 1;
		if (record.check?.method) checkMethods.add(record.check.method.trim().toLowerCase());
		if (record.kind === "deadend") deadends += 1;
		if (record.failureClass) {
			failureClasses.add(record.failureClass);
			failureClassCounts[record.failureClass] = (failureClassCounts[record.failureClass] ?? 0) + 1;
		}
		if (record.ts) {
			if (!firstTs || record.ts < firstTs) firstTs = record.ts;
			if (!lastTs || record.ts > lastTs) lastTs = record.ts;
		}
		const recordBytes = JSON.stringify(record).length;
		if (!largest || recordBytes > largest.bytes) {
			largest = { id: record.id, bytes: recordBytes, title: record.title };
		}
	}
	return {
		name,
		records: records.length,
		kinds,
		withSupports,
		withSession,
		withAgent,
		verifiedWithoutCheck,
		deadends,
		failureClasses: [...failureClasses].sort(),
		failureClassCounts,
		checkMethods,
		bytes,
		firstTs,
		lastTs,
		largest,
	};
}

export function analyzeCorpus(root: string): CorpusAnalysis {
	const traces = traceNames(root).map((name) => analyzeTrace(root, name));
	const kindTotals: Partial<Record<Kind, number>> = {};
	const failureMap = new Map<string, { count: number; traces: Set<string> }>();
	const largestRecords: CorpusAnalysis["largestRecords"] = [];
	let totalRecords = 0;
	let totalBytes = 0;
	let supportsSum = 0;
	let sessionSum = 0;
	let agentSum = 0;
	let verifiedWithoutCheckSum = 0;
	const checkMethods = new Set<string>();
	for (const trace of traces) {
		totalRecords += trace.records;
		totalBytes += trace.bytes;
		supportsSum += trace.withSupports;
		sessionSum += trace.withSession;
		agentSum += trace.withAgent;
		verifiedWithoutCheckSum += trace.verifiedWithoutCheck;
		for (const method of trace.checkMethods) checkMethods.add(method);
		for (const kind of KINDS) {
			kindTotals[kind] = (kindTotals[kind] ?? 0) + (trace.kinds[kind] ?? 0);
		}
		for (const failureClass of trace.failureClasses) {
			const group = failureMap.get(failureClass) ?? { count: 0, traces: new Set<string>() };
			group.count += trace.failureClassCounts[failureClass] ?? 0;
			group.traces.add(trace.name);
			failureMap.set(failureClass, group);
		}
		if (trace.largest) largestRecords.push({ trace: trace.name, ...trace.largest });
	}
	largestRecords.sort((a, b) => b.bytes - a.bytes);
	const failureClasses = [...failureMap.entries()]
		.map(([failureClass, group]) => ({
			failureClass,
			count: group.count,
			traces: [...group.traces].sort(),
		}))
		.sort((a, b) => b.count - a.count || a.failureClass.localeCompare(b.failureClass));
	return {
		traces,
		totalRecords,
		totalBytes,
		kindTotals,
		failureClasses,
		zeroDeadendTraces: traces.filter((trace) => trace.records > 0 && trace.deadends === 0).map((trace) => trace.name),
		zeroSupportsTraces: traces.filter((trace) => trace.records > 0 && trace.withSupports === 0).map((trace) => trace.name),
		largestRecords: largestRecords.slice(0, 5),
		supportRate: totalRecords > 0 ? supportsSum / totalRecords : 0,
		sessionRate: totalRecords > 0 ? sessionSum / totalRecords : 0,
		agentRate: totalRecords > 0 ? agentSum / totalRecords : 0,
		verifiedWithoutCheck: verifiedWithoutCheckSum,
		checkMethodVocabulary: checkMethods.size,
	};
}

function kindBreakdown(kinds: Partial<Record<Kind, number>>): string {
	return KINDS.filter((kind) => kinds[kind])
		.map((kind) => `${kind}=${kinds[kind]}`)
		.join(" ");
}

export function renderAnalysisMd(analysis: CorpusAnalysis, generated: Date): string {
	const lines: string[] = [];
	lines.push(`# Trace corpus analysis - ${generated.toISOString().slice(0, 10)}`, "");
	lines.push("## Corpus summary", "");
	lines.push(`- ${analysis.traces.length} traces, ${analysis.totalRecords} records, ${(analysis.totalBytes / 1024).toFixed(0)} KiB`);
	lines.push(`- Kinds: ${kindBreakdown(analysis.kindTotals) || "(none)"}`);
	lines.push(
		`- Branching signal: ${(analysis.supportRate * 100).toFixed(1)}% of records carry supports links; ${analysis.zeroSupportsTraces.length}/${analysis.traces.length} traces have none`,
	);
	lines.push(
		`- Deadends: ${analysis.kindTotals.deadend ?? 0} total; ${analysis.zeroDeadendTraces.length}/${analysis.traces.length} traces record zero rejected paths`,
	);
	lines.push(`- Session stamping: ${(analysis.sessionRate * 100).toFixed(1)}% of records (cost attribution coverage)`);
	lines.push(`- Agent attribution: ${(analysis.agentRate * 100).toFixed(1)}% of records carry an agent name`);
	lines.push(`- Verified without check: ${analysis.verifiedWithoutCheck} records claim verified with no reproduction check`);
	lines.push(`- Check method vocabulary: ${analysis.checkMethodVocabulary} distinct method strings (guideline: read/command/test/review composed with +)`);
	lines.push("");
	if (analysis.failureClasses.length > 0) {
		lines.push("## Failure classes", "");
		for (const group of analysis.failureClasses) {
			lines.push(`- \`${group.failureClass}\`: ${group.count} records across ${group.traces.length} trace(s) [${group.traces.join(", ")}]`);
		}
		lines.push("");
	} else {
		lines.push("## Failure classes", "", "- None recorded. Cross-trace pattern detection has no data to group.", "");
	}
	if (analysis.largestRecords.length > 0) {
		lines.push("## Largest records (sampling candidates)", "");
		for (const record of analysis.largestRecords) {
			lines.push(`- ${record.trace}/${record.id} (${(record.bytes / 1024).toFixed(1)} KiB): ${record.title}`);
		}
		lines.push("");
	}
	lines.push("## Per-trace table", "");
	lines.push("| trace | records | kinds | supports | deadends | span |");
	lines.push("|---|---|---|---|---|---|");
	for (const trace of [...analysis.traces].sort((a, b) => b.records - a.records)) {
		const span = trace.firstTs ? `${trace.firstTs.slice(0, 10)} → ${trace.lastTs.slice(0, 10)}` : "-";
		lines.push(
			`| ${trace.name} | ${trace.records} | ${kindBreakdown(trace.kinds)} | ${trace.withSupports} | ${trace.deadends} | ${span} |`,
		);
	}
	lines.push("");
	return lines.join("\n");
}

export function renderAnalysisSummary(analysis: CorpusAnalysis): string[] {
	const lines: string[] = [];
	lines.push(`${analysis.traces.length} traces, ${analysis.totalRecords} records, ${(analysis.totalBytes / 1024).toFixed(0)} KiB`);
	lines.push(`kinds: ${kindBreakdown(analysis.kindTotals) || "(none)"}`);
	lines.push(
		`branching: ${(analysis.supportRate * 100).toFixed(1)}% supports-linked | deadends: ${analysis.kindTotals.deadend ?? 0} | session-stamped: ${(analysis.sessionRate * 100).toFixed(1)}%`,
	);
	lines.push(
		`attribution: ${(analysis.agentRate * 100).toFixed(1)}% agent-stamped | verified w/o check: ${analysis.verifiedWithoutCheck} | check methods: ${analysis.checkMethodVocabulary} distinct`,
	);
	if (analysis.failureClasses.length > 0) {
		lines.push(`failure classes: ${analysis.failureClasses.map((group) => `${group.failureClass}×${group.count}`).join(", ")}`);
	}
	return lines;
}
