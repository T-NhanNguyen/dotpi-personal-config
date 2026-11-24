/**
 * Trace Tool - durable reasoning records for subagents.
 *
 * Subagents append compact records (finding, decision, concept, path,
 * evidence, deadend) with source refs. Humans append review records through
 * the trace viewer. The orchestrator reads them back in
 * layers so it can teach the user without loading the full report.
 *
 * Storage: .dev-vault/traces/<trace-id>/trace.jsonl (locked appends; viewer may delete reviews).
 */

import * as fs from "node:fs";
import * as path from "node:path";
import { spawn } from "node:child_process";
import { StringEnum } from "@earendil-works/pi-ai";
import { Box, Text } from "@earendil-works/pi-tui";
import { type ExtensionAPI, withFileMutationQueue } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import {
	CONFIDENCE,
	type Kind,
	MAX_BODY,
	MAX_TITLE,
	KINDS,
	ensureTrace,
	groupPatterns,
	normalizeFailureClass,
	normalizeTraceId,
	readRecords,
	traceNames,
	traceRoot,
	visible,
	type TraceRecord,
	type TraceRef,
	type TraceStep,
} from "./core.js";

import { withTraceLock, readStrict, reserveId, appendRecord } from "./mutation.ts";
import { analyzeCorpus, renderAnalysisMd, renderAnalysisSummary } from "./analyze.ts";

const ACTIONS = ["list", "outline", "get", "evidence", "search", "patterns", "export"] as const;

type Action = (typeof ACTIONS)[number];

function formatRefs(refs: TraceRef[]): string {
	return refs
		.map((ref) => {
			const location = [ref.path, ref.lines, ref.page ? `p.${ref.page}` : "", ref.note]
				.filter(Boolean)
				.join(" ");
			return location ? `- ${ref.type}: ${location}` : `- ${ref.type}`;
		})
		.join("\n");
}

function filterRecords(
	records: TraceRecord[],
	params: { ids?: string[]; kind?: Kind; includeDeadends?: boolean },
): TraceRecord[] {
	const ids = params.ids ? new Set(params.ids) : undefined;
	return records.filter(
		(record) =>
			visible(record, params.includeDeadends ?? false) &&
			(!ids || ids.has(record.id)) &&
			(!params.kind || record.kind === params.kind),
	);
}

function selectRecords(
	records: TraceRecord[],
	params: { ids?: string[]; kind?: Kind; includeDeadends?: boolean; limit?: number; offset?: number },
): TraceRecord[] {
	const offset = Math.max(0, Math.floor(params.offset ?? 0));
	const filtered = filterRecords(records, params);
	return filtered.slice(offset, offset + (params.limit ?? 50));
}

function searchHaystack(record: TraceRecord): string {
	const refsText = record.refs.map((ref) => `${ref.path ?? ""}\n${ref.note ?? ""}`).join("\n");
	const stepsText = (record.steps ?? []).map((step) => `${step.action}\n${step.ref}`).join("\n");
	return `${record.title}\n${record.body}\n${record.failureClass ?? ""}\n${refsText}\n${stepsText}`.toLowerCase();
}

const RefParams = Type.Object({
	type: Type.String({ description: "Ref kind: file, datasheet, command, url, measurement, other." }),
	path: Type.Optional(Type.String({ description: "File path or source identifier." })),
	lines: Type.Optional(Type.String({ description: "Line or range, e.g. 69-102." })),
	page: Type.Optional(Type.String({ description: "Datasheet or document page." })),
	note: Type.Optional(Type.String({ description: "Short qualifier." })),
});

const StepParams = Type.Object({
	action: Type.String({ description: "What was done or read, e.g. 'read capabilities'." }),
	ref: Type.String({ description: "Source or page for this step." }),
});

const CheckParams = Type.Object({
	method: Type.String({ description: "How the claim was reproduced: test, command, read, review." }),
	output: Type.String({ description: "Observed output or measured value. Required when confidence is verified." }),
	revision: Type.Optional(Type.String({ description: "File revision or commit the check ran against." })),
});

const AppendParams = Type.Object({
	trace: Type.Optional(
		Type.String({
			description:
				"Trace id slug, e.g. timer2-startup-clock. Omit to record into the session-scoped fallback trace (session-<id>) when the caller supplied no id.",
		}),
	),
	kind: StringEnum(KINDS, { description: "Record kind." }),
	title: Type.String({ description: "One-line heading the orchestrator can scan." }),
	body: Type.String({ description: `The conclusion or explanation. Max ${MAX_BODY} characters.` }),
	refs: Type.Array(RefParams, {
		minItems: 1,
		description: "Source refs. At least one is required.",
	}),
	supports: Type.Optional(
		Type.Array(Type.String(), { description: "Ids this record supports or depends on." }),
	),
	confidence: Type.Optional(StringEnum(CONFIDENCE, { description: "Confidence in the record. Use verified only with a check." })),
	check: Type.Optional(CheckParams),
	steps: Type.Optional(
		Type.Array(StepParams, { description: "Ordered narrowing procedure for kind=path." }),
	),
	agent: Type.String({
		description: "Your agent name from your frontmatter (e.g. worker, explore, code-auditor). Required for attribution; use 'orchestrator' when appending as the main agent.",
	}),
	failureClass: Type.Optional(
		Type.String({ description: "Stable lowercase slug for a failure pattern, e.g. missing-test-host. Used by trace_query action=patterns." }),
	),
});

const QueryParams = Type.Object({
	action: StringEnum(ACTIONS, { description: "list, outline, get, evidence, search, patterns, or export." }),
	trace: Type.Optional(Type.String({ description: "Trace id. Required for outline, get, evidence, export. Optional for search and patterns." })),
	ids: Type.Optional(Type.Array(Type.String(), { description: "Restrict to these record ids." })),
	kind: Type.Optional(StringEnum(KINDS, { description: "Restrict to one record kind." })),
	query: Type.Optional(Type.String({ description: "Substring for action=search." })),
	includeDeadends: Type.Optional(
		Type.Boolean({ description: "Include deadend records in outline, get, evidence, search, and patterns. Default true. Set false to exclude them, even by ID." }),
	),
	limit: Type.Optional(Type.Number({ description: "Max records returned. Default 50.", default: 50 })),
	offset: Type.Optional(Type.Number({ description: "Skip first N matching records. Default 0.", default: 0 })),
	dest: Type.Optional(Type.String({ description: "Destination folder for action=export. Receives trace.jsonl and meta.json." })),
});

export default function (pi: ExtensionAPI) {
	pi.registerTool({
		name: "trace_append",
		label: "Trace append",
		description: [
			"Append one durable trace record with source refs so the orchestrator can later fetch the reasoning.",
			"Record only conclusions and teaching material: finding, decision, concept, path, evidence, or deadend.",
			"Keep body under 1200 characters. At least one ref is required.",
		].join(" "),
		promptGuidelines: [
			"Append only records that would let a reader present the work or answer technical questions about it. If a record would not survive that bar, do not append it. Skip mundane steps such as pwd, directory listings, or merely opening a file.",
			"One record per established conclusion, not per action. Use finding for a conclusion, decision for a choice and its rejected alternative, concept only when the reader will need the definition, path for the ordered narrowing steps, evidence for a source excerpt, and deadend only with a concrete refuting ref.",
			"The review kind is reserved for human reviewers using the trace viewer; agents never append review records.",
			"Use the trace id the orchestrator supplies; when none is supplied, omit trace and the record lands in the session-scoped fallback trace. Never invent a project-style slug of your own. Every record needs a real ref, and the body stays under 1200 characters.",
			"After appending, include trace: <id> in your final handoff with a 3 to 6 bullet summary. Do not dump trace contents into the report.",
		],
		parameters: AppendParams,
		async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
			const sessionId = (ctx as { sessionManager?: { getSessionId?: () => string } }).sessionManager?.getSessionId?.();
			const trace = params.trace
				? normalizeTraceId(params.trace)
				: sessionId
					? `session-${sessionId}`
					: (() => {
							throw new Error("trace is required: no id was supplied and no session id is available for the fallback trace.");
						})();
			const title = params.title.trim();
			const body = params.body.trim();
			const failureClass = params.failureClass === undefined ? undefined : normalizeFailureClass(params.failureClass);
			if (!title) throw new Error("Title must not be empty.");
			if (title.length > MAX_TITLE) throw new Error(`Title must be ${MAX_TITLE} characters or fewer.`);
			if (!body) throw new Error("Body must not be empty.");
			if (body.length > MAX_BODY) throw new Error(`Body must be ${MAX_BODY} characters or fewer.`);
			if (params.refs.length === 0) throw new Error("At least one ref is required.");
			if (params.confidence === "verified" && (!params.check || !params.check.output.trim())) {
				throw new Error("Verified requires a check with observed output. Use inferred until you reproduce the result.");
			}
			if (params.check && !params.check.output.trim()) throw new Error("Check output must not be empty.");

			const dir = path.join(traceRoot(ctx.cwd), trace);
			const file = path.join(dir, "trace.jsonl");
			let record: TraceRecord | undefined;
			withTraceLock(file, () => {
				ensureTrace(dir, trace);
				const { raw, entries } = readStrict(file);
				const records = entries.flatMap(e => e.record ? [e.record] : []);
				const missing = (params.supports ?? []).filter((id) => !records.some((candidate) => candidate.id === id));
				if (missing.length > 0) throw new Error(`Unknown supports ids: ${missing.join(", ")}. Append the source records first.`);
				record = {
					id: reserveId(file, params.kind, records),
					trace,
					kind: params.kind,
					title,
					body,
					refs: params.refs,
					...(params.supports ? { supports: params.supports } : {}),
					...(params.confidence ? { confidence: params.confidence } : {}),
					...(params.check ? { check: params.check } : {}),
					...(params.steps ? { steps: params.steps } : {}),
					agent: params.agent,
					...(failureClass ? { failureClass } : {}),
					...(sessionId ? { session: sessionId } : {}),
					ts: new Date().toISOString(),
				};
				appendRecord(file, record, raw);
			});
			const appended = record as TraceRecord;
			return {
				content: [{ type: "text" as const, text: `Appended ${appended.id} [${appended.kind}] to trace ${trace}.` }],
				details: { trace, record: appended },
			};
		},
	});

	pi.registerTool({
		name: "trace_query",
		label: "Trace query",
		description: [
			"Read trace records in layers: list traces, outline one trace, get selected bodies, fetch evidence refs, or search.",
			"Start with outline, then get only the ids or kinds you need, then evidence for citations.",
		].join(" "),
		promptGuidelines: [
			"Choose the trace id before delegating and pass it in the task. The trace exists once the first record is appended.",
			"Use trace_query before writing a teaching answer so the detail comes from records rather than a long report. Read in layers: outline, then get the ids or kinds you need, then evidence for citations.",
			"Queries include deadend records by default. Treat them as rejected paths, not established findings. Set includeDeadends to false to exclude them, even by ID.",
			"Use action=patterns to group records by failureClass across traces. Repeated classes point to process defects; one-off classes may need no process change.",
		],
		parameters: QueryParams,
		async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
			const root = traceRoot(ctx.cwd);
			const limit = Math.max(1, Math.min(params.limit ?? 50, 200));
			const offset = Math.max(0, Math.floor(params.offset ?? 0));
			const includeDeadends = params.includeDeadends ?? true;

			if (params.action === "list") {
				const names = traceNames(root);
				if (names.length === 0) return { content: [{ type: "text" as const, text: "No traces yet." }], details: { action: params.action } };
				const lines = names.map((name) => {
					const records = readRecords(path.join(root, name, "trace.jsonl"));
					const created = (() => {
						try {
							const meta = JSON.parse(fs.readFileSync(path.join(root, name, "meta.json"), "utf8")) as { created?: string };
							return meta.created ? ` created=${meta.created.slice(0, 10)}` : "";
						} catch {
							return "";
						}
					})();
					return `${name} | records=${records.length}${created}`;
				});
				return { content: [{ type: "text" as const, text: lines.join("\n") }], details: { action: params.action, traces: names } };
			}

			if (params.action === "search") {
				const query = params.query?.trim().toLowerCase();
				if (!query) throw new Error("search requires a query.");
				const names = params.trace ? [normalizeTraceId(params.trace)] : traceNames(root);
				const matches: string[] = [];
				for (const name of names) {
					for (const record of readRecords(path.join(root, name, "trace.jsonl"))) {
						if (!visible(record, includeDeadends)) continue;
						if (searchHaystack(record).includes(query)) {
							matches.push(`${name}/${record.id} [${record.kind}] ${record.title}`);
						}
					}
				}
				const total = matches.length;
				const page = matches.slice(offset, offset + limit);
				const text = total === 0 ? "No matches." : page.join("\n");
				return { content: [{ type: "text" as const, text }], details: { action: params.action, matches } };
			}

			if (params.action === "patterns") {
				const names = params.trace ? [normalizeTraceId(params.trace)] : traceNames(root);
				const patterns = groupPatterns(root, names, { kind: params.kind, includeDeadends });
				const page = patterns.slice(offset, offset + limit);
				const lines = page.flatMap((pattern) => [
					`${pattern.failureClass} | records=${pattern.records.length} traces=${pattern.traces.size} agents=${pattern.agents.size}`,
					...pattern.records.map(({ trace, record }) => `  ${trace}/${record.id} [${record.kind}] ${record.title}`),
				]);
				const text = patterns.length === 0
					? "No failure classes found."
					: [`patterns | classes=${patterns.length} shown=${page.length} offset=${offset} limit=${limit}`, ...lines].join("\n");
				return {
					content: [{ type: "text" as const, text }],
					details: {
						action: params.action,
						total: patterns.length,
						offset,
						limit,
						patterns: page.map((pattern) => ({
							failureClass: pattern.failureClass,
							count: pattern.records.length,
							traceCount: pattern.traces.size,
							agents: [...pattern.agents].sort(),
							records: pattern.records.map(({ trace, record }) => ({ trace, id: record.id, kind: record.kind, title: record.title })),
						})),
					},
				};
			}

			if (params.action === "export") {
				if (!params.trace) throw new Error("export requires a trace id.");
				if (!params.dest) throw new Error("export requires a dest folder.");
				const name = normalizeTraceId(params.trace);
				const srcDir = path.join(root, name);
				const srcFile = path.join(srcDir, "trace.jsonl");
				const srcMeta = path.join(srcDir, "meta.json");
				if (!fs.existsSync(srcFile)) throw new Error(`Trace not found or empty: ${name}`);
				const count = readRecords(srcFile).length;
				await fs.promises.mkdir(params.dest, { recursive: true });
				await fs.promises.copyFile(srcFile, path.join(params.dest, `${name}.trace.jsonl`));
				if (fs.existsSync(srcMeta)) await fs.promises.copyFile(srcMeta, path.join(params.dest, `${name}.meta.json`));
				const saved = path.join(params.dest, `${name}.trace.jsonl`);
				return { content: [{ type: "text" as const, text: `Exported ${name} | records=${count} to ${saved}` }], details: { action: params.action, trace: name, dest: saved, total: count } };
			}

			if (!params.trace) throw new Error(`${params.action} requires a trace id.`);
			const trace = normalizeTraceId(params.trace);
			const records = readRecords(path.join(root, trace, "trace.jsonl"));
			if (records.length === 0) throw new Error(`Trace not found or empty: ${trace}`);

			if (params.action === "outline") {
				const matched = filterRecords(records, { ids: params.ids, kind: params.kind, includeDeadends });
				const page = matched.slice(offset, offset + limit);
				const lines = page.map((record) => `${record.id} [${record.kind}] ${record.title}`);
				const text = [`trace ${trace} | total=${matched.length} shown=${page.length} offset=${offset} limit=${limit}`, ...lines].join("\n");
				return { content: [{ type: "text" as const, text }], details: { action: params.action, trace, total: matched.length, offset, limit } };
			}

			const selected = selectRecords(records, {
				ids: params.ids,
				kind: params.kind,
				includeDeadends,
				limit,
				offset,
			});

			if (params.action === "evidence") {
				const text = selected
					.map((record) => `${record.id} [${record.kind}] ${record.title}\n${formatRefs(record.refs)}`)
					.join("\n\n");
				return { content: [{ type: "text" as const, text }], details: { action: params.action, trace, ids: selected.map((r) => r.id) } };
			}

			// action === "get"
			const text = selected
				.map((record) => {
					const steps = record.steps?.length
						? `\nSteps:\n${record.steps.map((step, index) => `${index + 1}. ${step.action} (${step.ref})`).join("\n")}`
						: "";
					const supports = record.supports?.length ? `\nSupports: ${record.supports.join(", ")}` : "";
					const confidence = record.confidence ? `\nConfidence: ${record.confidence}` : "";
					const failureClass = record.failureClass ? `\nFailure class: ${record.failureClass}` : "";
					const check = record.check ? `\nCheck: ${record.check.method} | ${record.check.output}${record.check.revision ? ` @ ${record.check.revision}` : ""}` : "";
					return `### ${record.id} [${record.kind}] ${record.title}\n${record.body}${steps}${supports}${confidence}${failureClass}${check}\n\nRefs:\n${formatRefs(record.refs)}`;
				})
				.join("\n\n");
			return {
				content: [{ type: "text" as const, text }],
				details: { action: params.action, trace, ids: selected.map((r) => r.id) },
			};
		},
	});

	pi.registerEntryRenderer("trace-analysis", (entry, _options, theme) => {
		const data = entry.data as { title: string; lines: string[] } | undefined;
		const box = new Box(1, 1, (text) => theme.bg("customMessageBg", text));
		if (!data) {
			box.addChild(new Text(theme.fg("warning", "trace-analysis: missing report data")));
			return box;
		}
		box.addChild(new Text(theme.bold(data.title)));
		for (const line of data.lines) box.addChild(new Text(line));
		return box;
	});

	pi.registerCommand("trace-analyze", {
		description: "Analyze the trace corpus: /trace-analyze [deep] - report is free; deep sends it to the agent",
		handler: async (args, ctx) => {
			const root = traceRoot(ctx.cwd);
			const analysis = analyzeCorpus(root);
			if (analysis.totalRecords === 0) {
				const message = "No trace records in this vault yet.";
				if (ctx.hasUI) ctx.ui.notify(message, "info");
				else console.log(message);
				return;
			}
			const report = renderAnalysisMd(analysis, new Date());
			const reportFile = path.join(root, `analysis-${new Date().toISOString().slice(0, 10)}.md`);
			await withFileMutationQueue(reportFile, async () => {
				await fs.promises.mkdir(path.dirname(reportFile), { recursive: true });
				await fs.promises.writeFile(reportFile, report, "utf8");
			});
			const summary = [...renderAnalysisSummary(analysis), `report: ${path.relative(ctx.cwd, reportFile)}`];
			if (ctx.hasUI) {
				pi.appendEntry("trace-analysis", { title: "trace corpus analysis", lines: summary });
			} else {
				console.log(summary.join("\n"));
			}

			if (args?.trim().toLowerCase() !== "deep") return;
			pi.sendUserMessage(
				[
					`Analyze the trace corpus. The deterministic report is at ${path.relative(ctx.cwd, reportFile)} - read it first.`,
					"Then sample, don't scan: use trace_query action=patterns, then outline/get on the traces the report flags (largest records, zero-deadend traces, repeated failure classes).",
					"Produce a ranked list of concrete proposals: (1) repeated failure patterns that deserve a process fix, with the record ids as evidence; (2) low-value record-writing behavior to tighten or drop in agents/*.md guidelines; (3) any schema or tooling changes to the traces extension itself.",
					"Each proposal must name its target file. Do not apply any edits until I confirm.",
				].join("\n"),
			);
		},
	});

	pi.registerCommand("trace-view", {
		description: "Open the interactive trace viewer: /trace-view [trace-id | stop]",
		handler: async (args, ctx) => {
			const pidFile = path.join(traceRoot(ctx.cwd), ".viewer.pid");
			const notify = (text: string, error = false) => {
				if (ctx.hasUI) ctx.ui.notify(text, error ? "error" : "info");
				else if (error) console.error(text);
				else console.log(text);
			};
			if (args?.trim() === "stop") {
				if (!fs.existsSync(pidFile)) {
					notify("No trace viewer is running for this vault.");
					return;
				}
				const pid = Number(fs.readFileSync(pidFile, "utf8"));
				try {
					// The server was spawned detached, so it leads its own process group.
					process.kill(-pid);
				} catch {
					try { process.kill(pid); } catch { /* already gone */ }
				}
				fs.rmSync(pidFile, { force: true });
				// SIGTERM delivery is asynchronous: the process is still alive for a
				// few ms after the signal, so a single liveness check reports a false
				// failure. Poll instead, then escalate to SIGKILL.
				const exited = async (): Promise<boolean> => {
					for (let waited = 0; waited < 1000; waited += 50) {
						try {
							process.kill(pid, 0);
						} catch {
							return true;
						}
						await new Promise((resolve) => setTimeout(resolve, 50));
					}
					return false;
				};
				if (await exited()) {
					notify(`Stopped trace viewer (pid ${pid}).`);
					return;
				}
				try { process.kill(-pid, "SIGKILL"); } catch { /* already gone */ }
				if (await exited()) {
					notify(`Stopped trace viewer (pid ${pid}) with SIGKILL.`);
				} else {
					notify(`Trace viewer (pid ${pid}) did not stop.`, true);
				}
				return;
			}
			const viewerDir = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..", "..", "trace-viewer");
			const server = path.join(viewerDir, "server.ts");
			const bundle = path.join(viewerDir, "dist", "index.html");
			const tsx = path.join(viewerDir, "node_modules", ".bin", "tsx");
			if (!fs.existsSync(server) || !fs.existsSync(bundle) || !fs.existsSync(tsx)) {
				notify("Trace viewer is not built. Run: cd trace-viewer && npm install && npm run build", true);
				return;
			}
			const trace = args?.trim() ? normalizeTraceId(args) : "";
			const spawnArgs = [server, "--cwd", ctx.cwd, "--port", "4777", ...(trace ? ["--trace", trace] : [])];
			const child = spawn(tsx, spawnArgs, { detached: true, stdio: ["ignore", "pipe", "pipe"] });
			const url = await new Promise<string>((resolve, reject) => {
				let buffer = "";
				const timer = setTimeout(() => reject(new Error("Viewer server did not report a URL within 10 seconds.")), 10_000);
				child.stdout!.on("data", (chunk) => {
					buffer += String(chunk);
					const line = buffer.split("\n").find((entry) => entry.startsWith("http"));
					if (line) {
						clearTimeout(timer);
						resolve(line.trim());
					}
				});
				child.on("error", reject);
				child.on("exit", (code) => reject(new Error(`Viewer server exited early with code ${code}.`)));
			}).catch((error: unknown) => {
				child.kill();
				throw error;
			});
			child.unref();
			child.stdout!.destroy();
			child.stderr!.destroy();
			fs.mkdirSync(path.dirname(pidFile), { recursive: true });
			fs.writeFileSync(pidFile, String(child.pid), "utf8");
			notify(`Trace viewer running at ${url} (pid ${child.pid}; stop with /trace-view stop).`);
		},
	});
}
