import { documentationReviewerRole, documentationReviewResponsibilities, documentationReviewHandoff } from "../sections/documentation-reviewer.ts";

export default {
	name: "documentation-reviewer",
	description: "Review, correct, and validate changed documentation against the writing snippet and actual implementation",
	model: "openai/gpt-6.2-sol:medium",
	tools: ["read", "write", "edit", "bash", "grep", "find", "ls"],
	references: ["../extensions/prompt-snippets/snippets/human-writing.md"],
	sections: [documentationReviewerRole, documentationReviewResponsibilities, documentationReviewHandoff],
} as const;
