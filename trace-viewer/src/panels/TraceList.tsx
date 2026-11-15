import { useState } from "react";
import type { TraceSummary } from "../api";

type TraceSort = "date" | "count";

/** Newest first; traces without a date sink to the bottom, ties by name. */
const byDate = (a: TraceSummary, b: TraceSummary) => {
	if (a.created === b.created) return a.trace.localeCompare(b.trace);
	if (a.created === null) return 1;
	if (b.created === null) return -1;
	return b.created.localeCompare(a.created);
};

/** Most records first, ties by name. */
const byCount = (a: TraceSummary, b: TraceSummary) =>
	b.recordCount - a.recordCount || a.trace.localeCompare(b.trace);

export function TraceList({ traces, active, onSelect }: { traces: TraceSummary[]; active: string | null; onSelect: (trace: string) => void }) {
	const [sort, setSort] = useState<TraceSort>("date");
	const sorted = [...traces].sort(sort === "date" ? byDate : byCount);
	return (
		<section className="trace-list">
			<div className="trace-list-header">
				<h2>Traces</h2>
				<div className="sort-toggle" role="group" aria-label="Sort traces">
					<button className={sort === "date" ? "active" : ""} onClick={() => setSort("date")}>
						date
					</button>
					<button className={sort === "count" ? "active" : ""} onClick={() => setSort("count")}>
						count
					</button>
				</div>
			</div>
			{sorted.length === 0 ? <div className="placeholder">No traces found.</div> : null}
			<ul>
				{sorted.map((entry) => (
					<li key={entry.trace}>
						<button className={entry.trace === active ? "trace active" : "trace"} onClick={() => onSelect(entry.trace)}>
							<span className="trace-name">{entry.trace}</span>
							<span className="trace-meta">
								{entry.recordCount} records
								{entry.created ? ` · ${entry.created.slice(0, 10)}` : ""}
							</span>
						</button>
					</li>
				))}
			</ul>
		</section>
	);
}
