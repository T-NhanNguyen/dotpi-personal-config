import { useCallback, useEffect, useState } from "react";
import { api, type KnownVault, type PatternGroup, type TraceGraph, type TraceSummary, type VaultInfo } from "./api";
import { GraphCanvas } from "./panels/GraphCanvas";
import { DetailTab } from "./panels/DetailTab";
import { ReviewTab } from "./panels/ReviewTab";
import { SessionTab } from "./panels/SessionTab";
import { TraceList } from "./panels/TraceList";
import { PatternsPanel } from "./panels/PatternsPanel";
import { VaultPanel } from "./panels/VaultPanel";

type Tab = "detail" | "session" | "review";

const SIDEBAR_STORAGE_KEY = "trace-viewer.sidebarOpen";
const INSPECTOR_STORAGE_KEY = "trace-viewer.inspectorOpen";

/**
 * Initial open state for a collapsible panel: the persisted localStorage value
 * wins ("true"/"false"); anything else (absent or malformed) falls back to
 * the responsive default so first load matches the current viewport.
 */
function loadPanelState(key: string): boolean {
	const stored = window.localStorage.getItem(key);
	if (stored === "true") return true;
	if (stored === "false") return false;
	return window.matchMedia("(min-width: 901px)").matches;
}

/**
 * Three-panel trace viewer: trace list + failure patterns on the left, the
 * supports graph in the center, and detail/session/review tabs on the right.
 * The initial trace comes from ?trace= so the /trace-view command can deep
 * link into a trace.
 */
export default function App() {
	const [vaults, setVaults] = useState<VaultInfo[]>([]);
	const [knownVaults, setKnownVaults] = useState<KnownVault[]>([]);
	/** Selected vault path, or null for the server default (--cwd). */
	const [vault, setVault] = useState<string | null>(null);
	const [traces, setTraces] = useState<TraceSummary[]>([]);
	const [traceId, setTraceId] = useState<string | null>(null);
	const [graph, setGraph] = useState<TraceGraph | null>(null);
	const [patterns, setPatterns] = useState<PatternGroup[]>([]);
	const [selectedId, setSelectedId] = useState<string | null>(null);
	const [activePattern, setActivePattern] = useState<string | null>(null);
	const [hideDeadends, setHideDeadends] = useState(false);
	const [tab, setTab] = useState<Tab>("detail");
	const [sidebarOpen, setSidebarOpen] = useState(() => loadPanelState(SIDEBAR_STORAGE_KEY));
	const [inspectorOpen, setInspectorOpen] = useState(() => loadPanelState(INSPECTOR_STORAGE_KEY));
	const [error, setError] = useState<string | null>(null);
	const [refreshKey, setRefreshKey] = useState(0);

	const selectVault = useCallback((next: string | null) => {
		setVault(next);
		setTraceId(null);
		setSelectedId(null);
		setActivePattern(null);
		setGraph(null);
		setPatterns([]);
		// Trace ids are vault-scoped; a deep link refers to the previous vault.
		const url = new URL(window.location.href);
		url.searchParams.delete("trace");
		window.history.replaceState(null, "", url);
	}, []);

	useEffect(() => {
		window.localStorage.setItem(SIDEBAR_STORAGE_KEY, String(sidebarOpen));
	}, [sidebarOpen]);

	useEffect(() => {
		window.localStorage.setItem(INSPECTOR_STORAGE_KEY, String(inspectorOpen));
	}, [inspectorOpen]);

	const selectTrace = useCallback((id: string) => {
		setTraceId(id);
		setSelectedId(null);
		setActivePattern(null);
		setTab("detail");
		// On narrow screens the sidebar is a drawer; close it after picking.
		// On desktop the sidebar stays as-is (never collapse from picking).
		if (window.matchMedia("(max-width: 900px)").matches) {
			setSidebarOpen(false);
		}
		const url = new URL(window.location.href);
		url.searchParams.set("trace", id);
		window.history.replaceState(null, "", url);
	}, []);

	const refresh = useCallback(async () => {
		setRefreshKey((key) => key + 1);
	}, []);

	useEffect(() => {
		let cancelled = false;
		Promise.all([api.traces(vault), api.vaults(), api.knownVaults()])
			.then(([list, vaultList, knownList]) => {
				if (cancelled) return;
				setTraces(list);
				setVaults(vaultList);
				setKnownVaults(knownList);
				const requested = new URLSearchParams(window.location.search).get("trace");
				if (requested && list.some((entry) => entry.trace === requested)) {
					// Deep link wins; ids are vault-scoped, so keep the current vault.
					setTraceId(requested);
				} else {
					if (requested) {
						// Stale deep link from another vault: drop it.
						const url = new URL(window.location.href);
						url.searchParams.delete("trace");
						window.history.replaceState(null, "", url);
					}
					setTraceId((current) =>
						current !== null && list.some((entry) => entry.trace === current) ? current : (list[0]?.trace ?? null),
					);
				}
			})
			.catch((cause: Error) => !cancelled && setError(cause.message));
		return () => {
			cancelled = true;
		};
	}, [vault, refreshKey]);

	useEffect(() => {
		if (!traceId) return;
		let cancelled = false;
		setError(null);
		Promise.all([api.trace(traceId, vault), api.patterns(traceId, vault)])
			.then(([graphData, patternData]) => {
				if (cancelled) return;
				setGraph(graphData);
				setPatterns(patternData);
			})
			.catch((cause: Error) => !cancelled && setError(cause.message));
		return () => {
			cancelled = true;
		};
	}, [traceId, vault, refreshKey]);

	return (
		<div className={`app${sidebarOpen ? " sidebar-open" : ""}${inspectorOpen ? " inspector-open" : ""}`}>
			<aside className={`sidebar${sidebarOpen ? "" : " collapsed"}`}>
				<div className="sidebar-body">
					<VaultPanel
						vaults={vaults}
						active={vault}
						known={knownVaults}
						onSelect={selectVault}
						onChanged={refresh}
					/>
					<TraceList traces={traces} active={traceId} onSelect={selectTrace} />
					<PatternsPanel
						patterns={patterns}
						active={activePattern}
						onToggle={(failureClass) =>
							setActivePattern((current) => (current === failureClass ? null : failureClass))
						}
					/>
				</div>
				{/* Ribbon is only visible when collapsed (CSS); the body stays mounted
				    so scroll positions and Review tab input survive collapse/expand. */}
				<button
					className="panel-ribbon"
					title="Show the trace list"
					onClick={() => setSidebarOpen((open) => !open)}
				>
					Traces
				</button>
			</aside>
			<main className="canvas-panel">
				<div className="toolbar">
					<button
						className="panel-toggle"
						title="Toggle the trace list"
						onClick={() => setSidebarOpen((open) => !open)}
					>
						☰ Traces
					</button>
					<strong>{graph ? graph.trace : "…"}</strong>
					{graph?.session ? <span className="session-chip" title="Most common pi session id on this trace">session {graph.session.slice(0, 8)}…</span> : null}
					<label className="toggle">
						<input
							type="checkbox"
							checked={hideDeadends}
							onChange={(event) => setHideDeadends(event.target.checked)}
						/>
						hide deadends
					</label>
					<button
						className="panel-toggle"
						title="Toggle the detail panel"
						onClick={() => setInspectorOpen((open) => !open)}
					>
						Details
					</button>
				</div>
				{error ? <div className="error-banner">{error}</div> : null}
				<GraphCanvas
					graph={graph}
					selectedId={selectedId}
					onSelect={setSelectedId}
					hideDeadends={hideDeadends}
					activePattern={activePattern}
				/>
			</main>
			<aside className={`inspector${inspectorOpen ? "" : " collapsed"}`}>
				<div className="inspector-body">
					<div className="tabs">
						{(["detail", "session", "review"] as Tab[]).map((name) => (
							<button
								key={name}
								className={tab === name ? "tab active" : "tab"}
								onClick={() => setTab(name)}
							>
								{name}
							</button>
						))}
					</div>
					{!traceId ? (
						<div className="placeholder">Select a trace on the left.</div>
					) : tab === "detail" ? (
						<DetailTab traceId={traceId} recordId={selectedId} vault={vault} />
					) : tab === "session" ? (
						<SessionTab traceId={traceId} refreshKey={refreshKey} vault={vault} />
					) : (
						<ReviewTab traceId={traceId} graph={graph} onSubmitted={refresh} vault={vault} />
					)}
				</div>
				<button
					className="panel-ribbon"
					title="Show the detail panel"
					onClick={() => setInspectorOpen((open) => !open)}
				>
					Details
				</button>
			</aside>
		</div>
	);
}
