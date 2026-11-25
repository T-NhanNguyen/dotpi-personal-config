type TraceSection = { readonly traceText: string };
type PromptPart = string | TraceSection;
export type PromptSection = PromptPart | readonly PromptPart[];

// Reading and writing guidance use the same gate: tracing requires a writer.
export function tracePromptEnabled(activeTools: readonly string[]): boolean {
	return activeTools.includes("trace_append");
}

export function traceOnly(text: string): TraceSection {
	return { traceText: text };
}

// The build emits the complete Markdown; delivery supplies trace availability.
export function composeSections(sections: readonly PromptSection[], includeTrace = true): string {
	function renderPart(part: PromptPart): string {
		return typeof part === "string" ? part : includeTrace ? part.traceText : "";
	}
	return sections.map((section) => typeof section === "string" || "traceText" in section
		? renderPart(section)
		: section.map(renderPart).join("")
	).filter(Boolean).join("\n\n");
}
