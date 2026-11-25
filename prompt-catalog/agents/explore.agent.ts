import {
	exploreHandoff,
	exploreRole,
	exploreTracePolicy,
	investigationDepth,
	investigationStrategy,
	repositoryReadOnly,
} from "../sections/explore.ts";

export default {
	name: "explore",
	description: "Fast read-only codebase reconnaissance with structured findings for the primary agent",
	model: "openai/gpt-6.2-sol:low",
	tools: ["read", "grep", "find", "ls", "bash", "trace_append"],
	sections: [
		exploreRole,
		investigationDepth,
		investigationStrategy,
		repositoryReadOnly,
		exploreTracePolicy,
		exploreHandoff,
	],
};
