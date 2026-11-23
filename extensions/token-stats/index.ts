/**
 * Token-stats command - token and tool telemetry over pi session transcripts.
 *
 * Sessions already log every message's usage (input/output/cache/cost) and every
 * tool call. This command parses those JSONL transcripts and renders reports in
 * the chat via a custom entry renderer, so the report itself costs zero tokens.
 *
 * Usage:
 *   /token-stats             current session detail
 *   /token-stats last [N]    table of the N most recent sessions in this project (default 10)
 *   /token-stats project     rollup of all sessions in this project
 *   /token-stats all         per-project rollups across every project + grand total
 *   /token-stats trace <id>  cost of the sessions that wrote into a trace
 */

import * as path from "node:path";
import { Box, Text } from "@earendil-works/pi-tui";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import {
	encodeCwd,
	findSessionsById,
	listSessionFiles,
	parseSessionFile,
	projectDirs,
	renderRollup,
	renderSessionDetail,
	renderSessionTable,
	renderTraceStats,
	sessionsRoot,
	traceLinkage,
	type SessionStats,
} from "./core.js";

const CUSTOM_TYPE = "token-stats";

interface ReportData {
	title: string;
	lines: string[];
}

function parseAllSessions(dir: string): SessionStats[] {
	return listSessionFiles(dir)
		.map(parseSessionFile)
		.filter((stats): stats is SessionStats => stats !== undefined);
}

function usage(): string[] {
	return [
		"Usage:",
		"  /token-stats             current session detail",
		"  /token-stats last [N]    N most recent sessions in this project (default 10)",
		"  /token-stats project     rollup of all sessions in this project",
		"  /token-stats all         per-project rollups + grand total",
		"  /token-stats trace <id>  cost of the sessions that wrote into a trace",
	];
}

export default function (pi: ExtensionAPI) {
	pi.registerEntryRenderer(CUSTOM_TYPE, (entry, _options, theme) => {
		const data = entry.data as ReportData | undefined;
		const box = new Box(1, 1, (text) => theme.bg("customMessageBg", text));
		if (!data) {
			box.addChild(new Text(theme.fg("warning", "token-stats: missing report data")));
			return box;
		}
		box.addChild(new Text(theme.bold(data.title)));
		for (const line of data.lines) box.addChild(new Text(line));
		return box;
	});

	pi.registerCommand("token-stats", {
		description: "Token and tool telemetry: /token-stats [last [N] | project | all]",
		handler: async (args, ctx) => {
			const emit = (title: string, lines: string[]) => {
				if (ctx.hasUI) {
					pi.appendEntry(CUSTOM_TYPE, { title, lines } satisfies ReportData);
				} else {
					console.log([title, ...lines].join("\n"));
				}
			};

			const root = sessionsRoot();
			const projectDir = path.join(root, encodeCwd(ctx.cwd));
			const arg = (args ?? "").trim().toLowerCase();

			if (arg === "help") {
				emit("token-stats", usage());
				return;
			}

			if (arg === "" ) {
				const sessionId = (ctx as { sessionManager?: { getSessionId?: () => string } }).sessionManager?.getSessionId?.();
				const files = listSessionFiles(projectDir);
				const file =
					(sessionId ? files.find((candidate) => candidate.endsWith(`_${sessionId}.jsonl`)) : undefined) ??
					files[files.length - 1];
				if (!file) {
					emit("token-stats: current session", ["No session transcripts found for this project yet."]);
					return;
				}
				const stats = parseSessionFile(file);
				if (!stats) {
					emit("token-stats: current session", [`Could not parse ${path.basename(file)}.`]);
					return;
				}
				emit("token-stats: current session", renderSessionDetail(stats));
				return;
			}

			if (arg === "project") {
				emit(`token-stats: project ${path.basename(ctx.cwd)}`, renderRollup("project", parseAllSessions(projectDir)));
				return;
			}

			if (arg.startsWith("last")) {
				const n = Number.parseInt(arg.slice(4).trim(), 10);
				const limit = Number.isFinite(n) && n > 0 ? Math.min(n, 100) : 10;
				emit(
					`token-stats: last ${limit} sessions in ${path.basename(ctx.cwd)}`,
					renderSessionTable(parseAllSessions(projectDir), limit),
				);
				return;
			}

			if (arg.startsWith("trace")) {
				const id = arg.slice(5).trim();
				if (!id) {
					emit("token-stats: trace", ["Which trace? Usage: /token-stats trace <id>", "", ...usage()]);
					return;
				}
				const traceFile = path.join(ctx.cwd, ".dev-vault", "traces", id, "trace.jsonl");
				const linkage = traceLinkage(traceFile);
				if (!linkage) {
					emit(`token-stats: trace ${id}`, [`No trace found at ${path.relative(ctx.cwd, traceFile)}.`]);
					return;
				}
				const { found, missing } = findSessionsById(root, linkage.sessionIds);
				const sessions = [...found.values()]
					.map(parseSessionFile)
					.filter((stats): stats is SessionStats => stats !== undefined);
				emit(`token-stats: trace ${id}`, renderTraceStats(id, linkage, sessions, missing));
				return;
			}

			if (arg === "all") {
				const lines: string[] = [];
				const grand: SessionStats[] = [];
				const perProject: { project: string; stats: SessionStats[] }[] = [];
				for (const { project, dir } of projectDirs(root)) {
					const stats = parseAllSessions(dir);
					if (stats.length === 0) continue;
					perProject.push({ project, stats });
					grand.push(...stats);
				}
				perProject.sort((a, b) => {
					const cost = (list: SessionStats[]) => list.reduce((sum, s) => sum + s.usage.cost, 0);
					return cost(b.stats) - cost(a.stats);
				});
				const header = `${"project".padEnd(44)} ${"sessions".padStart(8)} ${"in".padStart(9)} ${"out".padStart(9)} ${"cache".padStart(10)} ${"cost".padStart(9)}`;
				lines.push(header, "-".repeat(header.length));
				const short = (name: string) => {
					// Slugs are one-way encoded (path separators and literal dashes both
					// became "-"), so show the full slug tail rather than a guessed segment.
					const decoded = name.replace(/^--/, "").replace(/--$/, "");
					return decoded.length > 42 ? `…${decoded.slice(-41)}` : decoded;
				};
				const sum = (list: SessionStats[], pick: (u: SessionStats["usage"]) => number) =>
					list.reduce((total, s) => total + pick(s.usage), 0);
				for (const { project, stats } of perProject) {
					const fmt = (n: number, money = false) => (money ? `$${n.toFixed(2)}` : n >= 1_000_000 ? `${(n / 1_000_000).toFixed(1)}M` : n >= 1000 ? `${(n / 1000).toFixed(0)}k` : String(Math.round(n)));
					lines.push(
						`${short(project).padEnd(44)} ${String(stats.length).padStart(8)} ${fmt(sum(stats, (u) => u.input)).padStart(9)} ${fmt(sum(stats, (u) => u.output)).padStart(9)} ${fmt(sum(stats, (u) => u.cacheRead + u.cacheWrite)).padStart(10)} ${fmt(sum(stats, (u) => u.cost), true).padStart(9)}`,
					);
				}
				lines.push("", ...renderRollup("grand total", grand));
				emit("token-stats: all projects", lines);
				return;
			}

			emit("token-stats", [`Unknown argument: ${arg}`, "", ...usage()]);
		},
	});
}
