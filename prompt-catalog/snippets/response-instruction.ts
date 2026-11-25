import { explainMissingLink, responseVoice, terminologyAndCorrection } from "../sections/response-instruction.ts";

export default {
	id: "response-instruction.md",
	name: "Agent's Response Style",
	description: "How the agents should respond should be styled for best comprehension.",
	placement: "append",
	order: 3,
	sections: [explainMissingLink, responseVoice, terminologyAndCorrection],
} as const;
