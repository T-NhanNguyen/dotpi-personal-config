import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

const FILTER_TOOLS = "dotpi:profiles:filter-tools";
type ToolSelection = { names: readonly string[] };

export function registerProfileToolFilter(pi: ExtensionAPI, getDisabledTools: () => ReadonlySet<string> | undefined) {
	pi.events.on(FILTER_TOOLS, (data) => {
		if (!data || typeof data !== "object" || !("names" in data) || !Array.isArray(data.names)) return;
		const selection = data as ToolSelection;
		const disabled = getDisabledTools();
		// A loaded extension with no snapshot yet (or a failed load) cannot verify availability.
		selection.names = disabled ? selection.names.filter((name) => !disabled.has(name)) : [];
	});
}

export function profileFilteredTools(pi: ExtensionAPI, names: readonly string[]): readonly string[] {
	// Pi dispatches event bus listeners synchronously. Ask the profile extension for
	// its loaded snapshot before a later prompt/input handler can change active tools.
	// With no profile extension present, there is no additional mask to apply.
	const selection: ToolSelection = { names };
	pi.events.emit(FILTER_TOOLS, selection);
	return selection.names;
}
