import type { PatternGroup } from "../api";

/**
 * Cross-trace failure classes. Clicking one highlights every record carrying
 * that class in the graph; clicking again clears the highlight.
 */
export function PatternsPanel({
	patterns,
	active,
	onToggle,
}: {
	patterns: PatternGroup[];
	active: string | null;
	onToggle: (failureClass: string) => void;
}) {
	return (
		<section className="patterns">
			<details open>
				<summary>Failure patterns</summary>
				{patterns.length === 0 ? <div className="placeholder">No failure classes recorded.</div> : null}
				<ul>
					{patterns.map((group) => (
						<li key={group.failureClass}>
							<button
								className={group.failureClass === active ? "pattern active" : "pattern"}
								onClick={() => onToggle(group.failureClass)}
							>
								<span className="pattern-name">{group.failureClass}</span>
								<span className="pattern-meta">
									{group.count} × across {group.traceCount} trace{group.traceCount === 1 ? "" : "s"}
								</span>
							</button>
						</li>
					))}
				</ul>
			</details>
		</section>
	);
}
