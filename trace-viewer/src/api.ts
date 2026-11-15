/**
 * JSON API client for the trace viewer server (same origin). Throws Error
 * with the server's {error} message on non-2xx responses. Every trace-scoped
 * call takes an optional vault (absolute project path, null/undefined = the
 * server default) sent as ?vault=.
 */

export interface VaultInfo {
	path: string;
	name: string;
	traceCount: number;
	default: boolean;
}

export interface KnownVault {
	path: string;
	name: string;
	loaded: boolean;
}

export interface TraceSummary {
	trace: string;
	recordCount: number;
	created: string | null;
}

export interface GraphNodeData {
	id: string;
	kind: string;
	title: string;
	failureClass?: string;
	agent?: string;
	confidence?: string;
	ts: string;
}

export interface TraceGraph {
	trace: string;
	nodes: GraphNodeData[];
	edges: { source: string; target: string }[];
	session: string | null;
}

export interface PatternRecordRef {
	trace: string;
	id: string;
	kind: string;
	title: string;
}

export interface PatternGroup {
	failureClass: string;
	count: number;
	traceCount: number;
	agents: string[];
	records: PatternRecordRef[];
}

export interface SessionMessage {
	role: string;
	text: string;
	ts: string;
}

export interface SessionResponse {
	sessionId: string;
	messages: SessionMessage[];
}

export interface TraceRef {
	type: string;
	path?: string;
	lines?: string;
	page?: string;
	note?: string;
}

export interface TraceRecordDetail {
	id: string;
	trace: string;
	kind: string;
	title: string;
	body: string;
	refs: TraceRef[];
	supports?: string[];
	confidence?: string;
	check?: { method: string; output: string; revision?: string };
	steps?: { action: string; ref: string }[];
	agent?: string;
	failureClass?: string;
	session?: string;
	ts: string;
}

function vaultQuery(vault: string | null | undefined): string {
	return vault ? `?vault=${encodeURIComponent(vault)}` : "";
}

async function request<T>(url: string, init?: RequestInit): Promise<T> {
	const response = await fetch(url, init);
	const body: unknown = await response.json().catch(() => null);
	if (!response.ok) {
		const message =
			body && typeof body === "object" && "error" in body && typeof (body as { error: unknown }).error === "string"
				? (body as { error: string }).error
				: `${response.status} ${response.statusText}`;
		throw new Error(message);
	}
	return body as T;
}

export const api = {
	vaults: () => request<VaultInfo[]>("/api/vaults"),
	knownVaults: () => request<KnownVault[]>("/api/vaults/known"),
	addVault: (path: string) =>
		request<VaultInfo>("/api/vaults", {
			method: "POST",
			headers: { "content-type": "application/json" },
			body: JSON.stringify({ path }),
		}),
	traces: (vault?: string | null) => request<TraceSummary[]>(`/api/traces${vaultQuery(vault)}`),
	trace: (trace: string, vault?: string | null) =>
		request<TraceGraph>(`/api/trace/${encodeURIComponent(trace)}${vaultQuery(vault)}`),
	record: (trace: string, id: string, vault?: string | null) =>
		request<TraceRecordDetail>(`/api/trace/${encodeURIComponent(trace)}/record/${encodeURIComponent(id)}${vaultQuery(vault)}`),
	patterns: (trace: string, vault?: string | null) =>
		request<PatternGroup[]>(`/api/trace/${encodeURIComponent(trace)}/patterns${vaultQuery(vault)}`),
	session: (trace: string, vault?: string | null) =>
		request<SessionResponse>(`/api/trace/${encodeURIComponent(trace)}/session${vaultQuery(vault)}`),
	review: (trace: string, input: { targetIds: string[]; text: string; failureClass?: string }, vault?: string | null) =>
		request<TraceRecordDetail>(`/api/trace/${encodeURIComponent(trace)}/review${vaultQuery(vault)}`, {
			method: "POST",
			headers: { "content-type": "application/json" },
			body: JSON.stringify(input),
		}),
};
