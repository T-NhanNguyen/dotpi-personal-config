import { auditorRole, auditScope, auditResponsibilities, auditHandoff } from "../sections/code-auditor.ts";

export default {
	name: "code-auditor",
	description: "Review, correct, and verify implementation using programming and applicable C audit guidance",
	model: "openai/gpt-6.2-sol:medium",
	tools: ["read", "write", "edit", "bash", "grep", "find", "ls", "subagent", "trace_append"],
	references: ["../extensions/prompt-snippets/snippets/programming-guideline.md"],
	sections: [auditorRole, auditScope, auditResponsibilities, auditHandoff],
} as const;
