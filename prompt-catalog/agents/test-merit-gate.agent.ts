import { testGateRole, testGateContext, testGatePlanReview, testGateExecution, testGateOutput } from "../sections/test-merit-gate.ts";

export default {
	name: "test-merit-gate",
	description: "Test lead that owns the test context, adjudicates plans, runs tests, and commands test-writer when new tests are needed",
	model: "openai/gpt-6.2-sol:medium",
	tools: ["read", "write", "edit", "bash", "grep", "find", "ls", "subagent", "trace_append"],
	references: ["references/test-integrity.md"],
	sections: [testGateRole, testGateContext, testGatePlanReview, testGateExecution, testGateOutput],
} as const;
