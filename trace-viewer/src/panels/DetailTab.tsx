import { useEffect, useState } from "react";
import { api, type TraceRecordDetail } from "../api";
import { kindColor } from "../kinds";

/** Full record view for the node selected on the canvas. */
export function DetailTab({ traceId, recordId, vault }: { traceId: string; recordId: string | null; vault?: string | null }) {
	const [record, setRecord] = useState<TraceRecordDetail | null>(null);
	const [error, setError] = useState<string | null>(null);

	useEffect(() => {
		if (!recordId) return;
		let cancelled = false;
		setError(null);
		api
			.record(traceId, recordId, vault)
			.then((data) => !cancelled && setRecord(data))
			.catch((cause: Error) => {
				if (cancelled) return;
				setRecord(null);
				setError(cause.message);
			});
		return () => {
			cancelled = true;
		};
	}, [traceId, recordId, vault]);

	if (!recordId) return <div className="placeholder">Select a record on the canvas.</div>;
	if (error) return <div className="error-banner">{error}</div>;
	if (!record) return <div className="placeholder">Loading…</div>;

	return (
		<div className="detail">
			<h3>
				<span style={{ color: kindColor(record.kind) }}>{record.kind}</span> {record.id}
			</h3>
			<div className="detail-title">{record.title}</div>
			<dl>
				<dt>time</dt>
				<dd>{record.ts}</dd>
				{record.agent ? (
					<>
						<dt>agent</dt>
						<dd>{record.agent}</dd>
					</>
				) : null}
				{record.confidence ? (
					<>
						<dt>confidence</dt>
						<dd>{record.confidence}</dd>
					</>
				) : null}
				{record.failureClass ? (
					<>
						<dt>failure class</dt>
						<dd>{record.failureClass}</dd>
					</>
				) : null}
				{record.session ? (
					<>
						<dt>session</dt>
						<dd>{record.session}</dd>
					</>
				) : null}
				{record.supports?.length ? (
					<>
						<dt>supports</dt>
						<dd>{record.supports.join(", ")}</dd>
					</>
				) : null}
			</dl>
			<p className="detail-body">{record.body}</p>
			{record.refs.length > 0 ? (
				<>
					<h4>Refs</h4>
					<ul className="ref-list">
						{record.refs.map((ref, index) => (
							<li key={index}>
								<span className="ref-type">{ref.type}</span>{" "}
								{ref.path ? <code>{ref.path}{ref.lines ? `:${ref.lines}` : ""}</code> : null}{" "}
								{ref.page ? <code>p.{ref.page}</code> : null} {ref.note ? <em>{ref.note}</em> : null}
							</li>
						))}
					</ul>
				</>
			) : null}
			{record.check ? (
				<>
					<h4>Check</h4>
					<dl>
						<dt>method</dt>
						<dd>{record.check.method}</dd>
						{record.check.revision ? (
							<>
								<dt>revision</dt>
								<dd>{record.check.revision}</dd>
							</>
						) : null}
					</dl>
					<pre className="check-output">{record.check.output}</pre>
				</>
			) : null}
		</div>
	);
}
