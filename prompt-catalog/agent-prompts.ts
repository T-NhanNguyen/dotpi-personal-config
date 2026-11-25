import { agentCatalog } from "./agents/catalog.ts";
import { composeSections } from "./compose.ts";

export const PRELOADED_REFERENCES_HEADING = "\n\n## Preloaded references\n";

const traceVariants = agentCatalog.flatMap(({ name, sections }) => {
	const full = composeSections(sections);
	const masked = composeSections(sections, false);
	return full === masked ? [] : [{ name, full, masked }];
});

export function maskCatalogAgentPrompt(name: string, body: string): string {
	// A local agent with the same name but a different body is not catalog text.
	return traceVariants.find((variant) => variant.name === name && variant.full === body)?.masked ?? body;
}

export function restoreCatalogAgentPrompt(append: string): string {
	const variant = traceVariants.find(({ masked }) => append === masked || append.startsWith(masked + PRELOADED_REFERENCES_HEADING));
	return variant ? variant.full + append.slice(variant.masked.length) : append;
}
