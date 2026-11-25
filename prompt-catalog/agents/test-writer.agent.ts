import { testWriterRole, testWriterScope, testWriterWorkflow, testWriterOutput } from "../sections/test-writer.ts";

export default {
	name: "test-writer",
	description: "Design intent-bound test plans for test-merit-gate or the orchestrator, sized to the brief and budget",
	model: "openai/gpt-6.2-sol:medium",
	tools: ["read", "grep", "find", "ls", "bash", "trace_append"],
	references: ["references/test-integrity.md"],
	sections: [testWriterRole, testWriterScope, testWriterWorkflow, testWriterOutput],
} as const;
