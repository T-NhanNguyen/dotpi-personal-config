import {
	delegateSelectively,
	stopOnSubagentError,
	traceHandoff,
	verifyCriticalFacts,
} from "../sections/orchestration.ts";

export default {
	id: "orchestrator-mode.md",
	name: "Orchestrator mode",
	description: "High-level orchestrator session; delegate exploration and implementation to subagents",
	placement: "append",
	order: 1,
	sections: [verifyCriticalFacts, delegateSelectively, stopOnSubagentError, traceHandoff],
} as const;
