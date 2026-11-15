import { useCallback, useEffect, useState } from "react";
import { api, type SessionResponse } from "../api";

/**
 * Transcript of the pi session that produced most of this trace's records.
 * Follows the session file's active branch (longest leaf chain). A 404 —
 * e.g. no record carries a session id, or the file was deleted — renders as
 * a plain message instead of an error banner.
 */
export function SessionTab({ traceId, refreshKey, vault }: { traceId: string; refreshKey: number; vault?: string | null }) {
	const [data, setData] = useState<SessionResponse | null>(null);
	const [notice, setNotice] = useState<string | null>(null);
	const [loading, setLoading] = useState(false);

	const load = useCallback(() => {
		setLoading(true);
		setNotice(null);
		api
			.session(traceId, vault)
			.then((response) => {
				setData(response);
				setLoading(false);
			})
			.catch((cause: Error) => {
				setData(null);
				setNotice(cause.message);
				setLoading(false);
			});
	}, [traceId, vault]);

	useEffect(load, [load, refreshKey]);

	if (loading && !data) return <div className="placeholder">Loading session…</div>;
	if (notice) {
		return (
			<div>
				<div className="notice">{notice}</div>
				<button className="retry" onClick={load}>retry</button>
			</div>
		);
	}
	if (!data) return <div className="placeholder">No session loaded.</div>;

	return (
		<div className="session">
			<div className="session-head">
				<span className="session-id" title={data.sessionId}>session {data.sessionId.slice(0, 8)}…</span>
				<button className="retry" onClick={load}>refresh</button>
			</div>
			<div className="messages">
				{data.messages.map((message, index) => (
					<div key={index} className={`message role-${message.role}`}>
						<div className="message-head">
							<span className="message-role">{message.role}</span>
							<span className="message-ts">{message.ts.slice(11, 19)}</span>
						</div>
						<div className="message-text">{message.text}</div>
					</div>
				))}
			</div>
		</div>
	);
}
