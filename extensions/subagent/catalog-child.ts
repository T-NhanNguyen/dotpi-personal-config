import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { restoreCatalogAgentPrompt } from "../../prompt-catalog/agent-prompts.ts";
import { tracePromptEnabled } from "../../prompt-catalog/compose.ts";
import { profileFilteredTools } from "../profiles/tool-availability.ts";

// Explicitly loaded only for catalog children with gated sections. The append
// file is already masked, so failure to load this adapter never enables tracing.
export default function (pi: ExtensionAPI) {
	pi.on("before_agent_start", (event) => {
		const options = event.systemPromptOptions;
		if (options?.appendSystemPrompt && tracePromptEnabled(profileFilteredTools(pi, options.selectedTools))) {
			options.appendSystemPrompt = restoreCatalogAgentPrompt(options.appendSystemPrompt);
		}
	});
}
