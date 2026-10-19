/**
 * Trace Tool - durable reasoning records for subagents.
 *
 * Subagents append compact records (finding, decision, concept, path,
 * evidence, deadend) with source refs. The orchestrator reads them back in
 * layers so it can teach the user without loading the full report.
 *
 * Storage: .dev-vault/traces/<trace-id>/trace.jsonl (append-only JSONL).
 */

import * as fs from "node:fs";
import * as path from "node:path";
import { StringEnum } from "@earendil-works/pi-ai";
import { type ExtensionAPI, withFileMutationQueue } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";

const TRACE_ROOT = path.join(".dev-vault", "traces");
const MAX_BODY = 1200;
const MAX_TITLE = 200;
const KINDS = ["finding", "decision", "concept", "path", "evidence", "deadend"] as const;
const ACTIONS = ["list", "outline", "get", "evidence", "search"] as const;
const CONFIDENCE = ["verified", "inferred", "unverified"] as const;

type Kind = (typeof KINDS)[number];
type Action = (typeof ACTIONS)[number];

interface TraceRef {
	type: string;
	path?: string;
	lines?: string;
	page?: string;
	note?: string;
}

interface TraceStep {
	action: string;
	ref: string;
}

interface TraceRecord {
	id: string;
	trace: string;
	kind: Kind;
	title: string;
	body: string;
	refs: TraceRef[];
	supports?: string[];
	confidence?: string;
	steps?: TraceStep[];
	agent?: string;
	ts: string;
}

const ID_PREFIX: Record<Kind, string> = {
	finding: "f",
	decision: "d",
	concept: "c",
	path: "p",
	evidence: "e",
	deadend: "x",
};

function traceRoot(ctxCwd: string): string {
	return path.join(ctxCwd, TRACE_ROOT);
}

function normalizeTraceId(raw: string): string {
	const id = raw.trim().toLowerCase();
	if (!/^[a-z0-9][a-z0-9._-]*$/.test(id)) {
		throw new Error("Trace id must be a lowercase slug: letters, digits, dot, underscore, hyphen; no slashes.");
	}
	return id;
}

function readRecords(file: string): TraceRecord[] {
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

function nextRecordId(kind: Kind, records: TraceRecord[]): string {
	const prefix = ID_PREFIX[kind];
	const used = new Set(records.map((record) => record.id));
	let n = 1;
	while (used.has(`${prefix}${n}`)) n += 1;
	return `${prefix}${n}`;
}

function ensureTrace(dir: string, trace: string): void {
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

function traceNames(root: string): string[] {
	if (!fs.existsSync(root)) return [];
	return fs
		.readdirSync(root, { withFileTypes: true })
		.filter((entry) => entry.isDirectory())
		.map((entry) => entry.name)
		.sort();
}

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

function visible(record: TraceRecord, includeDeadends: boolean): boolean {
	return includeDeadends || record.kind !== "deadend";
}

function selectRecords(
	records: TraceRecord[],
	params: { ids?: string[]; kind?: Kind; includeDeadends?: boolean; limit?: number },
): TraceRecord[] {
	const ids = params.ids ? new Set(params.ids) : undefined;
	const selected = records.filter(
		(record) =>
			visible(record, params.includeDeadends ?? false) &&
			(!ids || ids.has(record.id)) &&
			(!params.kind || record.kind === params.kind),
	);
	return selected.slice(0, params.limit ?? 50);
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

const AppendParams = Type.Object({
	trace: Type.String({ description: "Trace id slug, e.g. timer2-startup-clock." }),
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
	confidence: Type.Optional(StringEnum(CONFIDENCE, { description: "Confidence in the record." })),
	steps: Type.Optional(
		Type.Array(StepParams, { description: "Ordered narrowing procedure for kind=path." }),
	),
	agent: Type.Optional(Type.String({ description: "Agent name that produced the record." })),
});

const QueryParams = Type.Object({
	action: StringEnum(ACTIONS, { description: "list, outline, get, evidence, or search." }),
	trace: Type.Optional(Type.String({ description: "Trace id. Required for outline, get, evidence." })),
	ids: Type.Optional(Type.Array(Type.String(), { description: "Restrict to these record ids." })),
	kind: Type.Optional(StringEnum(KINDS, { description: "Restrict to one record kind." })),
	query: Type.Optional(Type.String({ description: "Substring for action=search." })),
	includeDeadends: Type.Optional(
		Type.Boolean({ description: "Include deadend records. Default false.", default: false }),
	),
	limit: Type.Optional(Type.Number({ description: "Max records returned. Default 50.", default: 50 })),
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
			"Use trace_append when a conclusion is established and the orchestrator may need the detail or the source behind it. Do not append one record per file read.",
			"Use kind=path for the ordered narrowing procedure, kind=concept for definitions the user may need, and kind=deadend only for a ruled-out path with a concrete refuting ref.",
		],
		parameters: AppendParams,
		async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
			const trace = normalizeTraceId(params.trace);
			const title = params.title.trim();
			const body = params.body.trim();
			if (!title) throw new Error("Title must not be empty.");
			if (title.length > MAX_TITLE) throw new Error(`Title must be ${MAX_TITLE} characters or fewer.`);
			if (!body) throw new Error("Body must not be empty.");
			if (body.length > MAX_BODY) throw new Error(`Body must be ${MAX_BODY} characters or fewer.`);
			if (params.refs.length === 0) throw new Error("At least one ref is required.");

			const dir = path.join(traceRoot(ctx.cwd), trace);
			const file = path.join(dir, "trace.jsonl");
			let record: TraceRecord | undefined;
			await withFileMutationQueue(file, async () => {
				ensureTrace(dir, trace);
				const records = readRecords(file);
				record = {
					id: nextRecordId(params.kind, records),
					trace,
					kind: params.kind,
					title,
					body,
					refs: params.refs,
					...(params.supports ? { supports: params.supports } : {}),
					...(params.confidence ? { confidence: params.confidence } : {}),
					...(params.steps ? { steps: params.steps } : {}),
					...(params.agent ? { agent: params.agent } : {}),
					ts: new Date().toISOString(),
				};
				await fs.promises.appendFile(file, `${JSON.stringify(record)}\n`, "utf8");
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
			"Use trace_query before writing a teaching answer so the detail comes from records rather than a long report.",
			"Default reads exclude deadend records. Set includeDeadends only when a prior negative result matters.",
		],
		parameters: QueryParams,
		async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
			const root = traceRoot(ctx.cwd);
			const limit = Math.max(1, Math.min(params.limit ?? 50, 200));
			const includeDeadends = params.includeDeadends ?? false;

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
						if (`${record.title}\n${record.body}`.toLowerCase().includes(query)) {
							matches.push(`${name}/${record.id} [${record.kind}] ${record.title}`);
						}
					}
				}
				const text = matches.length === 0 ? "No matches." : matches.slice(0, limit).join("\n");
				return { content: [{ type: "text" as const, text }], details: { action: params.action, matches } };
			}

			if (!params.trace) throw new Error(`${params.action} requires a trace id.`);
			const trace = normalizeTraceId(params.trace);
			const records = readRecords(path.join(root, trace, "trace.jsonl"));
			if (records.length === 0) throw new Error(`Trace not found or empty: ${trace}`);

			if (params.action === "outline") {
				const text = selectRecords(records, { includeDeadends, limit })
					.map((record) => `${record.id} [${record.kind}] ${record.title}`)
					.join("\n");
				return { content: [{ type: "text" as const, text }], details: { action: params.action, trace } };
			}

			const selected = selectRecords(records, {
				ids: params.ids,
				kind: params.kind,
				includeDeadends,
				limit,
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
					return `### ${record.id} [${record.kind}] ${record.title}\n${record.body}${steps}${supports}${confidence}\n\nRefs:\n${formatRefs(record.refs)}`;
				})
				.join("\n\n");
			return {
				content: [{ type: "text" as const, text }],
				details: { action: params.action, trace, ids: selected.map((r) => r.id) },
			};
		},
	});
}
