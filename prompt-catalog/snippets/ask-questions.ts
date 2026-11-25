import { verifyBeforeActing } from "../sections/ask-questions.ts";

export default {
	id: "ask-questions.md",
	name: "Ask questions",
	description: "Ask questions to reach a shared understanding.",
	placement: "append",
	order: 8,
	sections: [verifyBeforeActing],
} as const;
