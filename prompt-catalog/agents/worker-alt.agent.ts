import { alternateWorkerRole, alternateWorkerResponsibilities, alternateWorkerHandoff } from "../sections/worker-alt.ts";

export default {
	name: "worker-alt",
	description: "Alternate-provider implementation agent for substantial delegated coding tasks when the primary worker model is rate-limited; same scope and constraints as worker",
	disabled: true,
	model: "deepseek/deepseek-v4-pro:medium",
	tools: ["read", "write", "edit", "bash", "grep", "find", "ls"],
	sections: [alternateWorkerRole, alternateWorkerResponsibilities, alternateWorkerHandoff],
} as const;
