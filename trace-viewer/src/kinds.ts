/** Shared kind colors for graph nodes, list markers, and badges. */
export const KIND_COLORS: Record<string, string> = {
	finding: "#4da3ff",
	decision: "#7bd88f",
	concept: "#c792ea",
	path: "#ffcb6b",
	evidence: "#89ddff",
	deadend: "#8b8b8b",
	review: "#f78c6c",
};

export const kindColor = (kind: string): string => KIND_COLORS[kind] ?? "#aaaaaa";
