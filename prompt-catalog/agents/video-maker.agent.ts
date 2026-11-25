import { videoMakerRole, localNarrationIntegration, narrationApprovalGate } from "../sections/video-maker.ts";

export default {
	name: "video-maker",
	description: "Script-writing and local video specialist with exact-file narration and an audio-review gate before video production",
	model: "openai/gpt-6.2-sol:medium",
	tools: ["read", "write", "edit", "bash", "grep", "find", "ls"],
	sections: [videoMakerRole, localNarrationIntegration, narrationApprovalGate],
} as const;
