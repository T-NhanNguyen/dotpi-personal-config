import { workerRole, workerResponsibilities, workerHandoff } from "../sections/worker.ts";

export default {
	name: "worker",
	description: "General-purpose implementation agent for substantial delegated coding tasks; can inspect, edit, and write tests autonomously",
	model: "openai/gpt-6.2-sol:medium",
	tools: ["read", "write", "edit", "bash", "grep", "find", "ls", "trace_append"],
	references: ["../extensions/prompt-snippets/snippets/programming-guideline.md", "../extensions/prompt-snippets/snippets/embedded-debug-swo-itm.md"],
	sections: [workerRole, workerResponsibilities, workerHandoff],
} as const;
