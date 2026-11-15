import { useState } from "react";
import { api, type TraceGraph } from "../api";

/**
 * Human review composer: free text (the first 80 chars become the title), an
 * optional failure class, and a multi-select of target records. Submission
 * POSTs to the server, which appends a review record to the trace; onSubmitted
 * then reloads the graph so the new node and supports edges appear.
 */
export function ReviewTab({ traceId, graph, onSubmitted, vault }: { traceId: string; graph: TraceGraph | null; onSubmitted: () => void; vault?: string | null }) {
	const [text, setText] = useState("");
	const [failureClass, setFailureClass] = useState("");
	const [targets, setTargets] = useState<Set<string>>(new Set());
	const [error, setError] = useState<string | null>(null);
	const [busy, setBusy] = useState(false);
	const [done, setDone] = useState<string | null>(null);

	const toggleTarget = (id: string) => {
		setTargets((current) => {
			const next = new Set(current);
			if (next.has(id)) next.delete(id);
			else next.add(id);
			return next;
		});
	};

	const submit = async () => {
		setBusy(true);
		setError(null);
		setDone(null);
		try {
			const record = await api.review(
				traceId,
				{
					targetIds: [...targets],
					text,
					...(failureClass.trim() ? { failureClass: failureClass.trim() } : {}),
				},
				vault,
			);
			setDone(`Appended ${record.id} to ${traceId}.`);
			setText("");
			setFailureClass("");
			setTargets(new Set());
			onSubmitted();
		} catch (cause) {
			setError(cause instanceof Error ? cause.message : String(cause));
		} finally {
			setBusy(false);
		}
	};

	return (
		<div className="review">
			<label>
				Review text
				<textarea
					rows={8}
					value={text}
					placeholder="What did you verify or reject? First 80 characters become the title."
					onChange={(event) => setText(event.target.value)}
				/>
			</label>
			<label>
				Failure class (optional)
				<input
					type="text"
					value={failureClass}
					placeholder="e.g. missing-test-host"
					onChange={(event) => setFailureClass(event.target.value)}
				/>
			</label>
			<fieldset>
				<legend>Target records</legend>
				{graph && graph.nodes.length > 0 ? (
					<ul className="target-list">
						{graph.nodes.map((node) => (
							<li key={node.id}>
								<label>
									<input
										type="checkbox"
										checked={targets.has(node.id)}
										onChange={() => toggleTarget(node.id)}
									/>
									<span className="target-id">{node.id}</span> {node.title}
								</label>
							</li>
						))}
					</ul>
				) : (
					<div className="placeholder">No records to target.</div>
				)}
			</fieldset>
			<button className="submit" disabled={busy || text.trim().length === 0} onClick={() => void submit()}>
				{busy ? "Submitting…" : "Submit review"}
			</button>
			{error ? <div className="error-banner">{error}</div> : null}
			{done ? <div className="notice">{done}</div> : null}
		</div>
	);
}
