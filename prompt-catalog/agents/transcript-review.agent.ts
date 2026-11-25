import { transcriptReviewInstructions } from "../sections/transcript-review.ts";

export default {
	name: "transcript-review",
	description: "Simple YouTube transcript reviewer for narrowly scoped, source-grounded Markdown edits",
	model: "deepseek/deepseek-flash:low",
	tools: ["youtube_transcript", "read", "edit", "bash"],
	sections: [transcriptReviewInstructions],
} as const;
