import { humanWritingPrinciple, humanWritingRules, humanWritingModes } from "../sections/files-writing-style.ts";

export default {
	id: "files-writing-style.md",
	name: "Files Writing Style",
	description: "Rewrite prose (docs, PRs, reports, error messages, never code) so it reads clearly on the first pass. Use when asked to make writing sound less like AI.",
	placement: "append",
	order: 5,
	sections: [humanWritingPrinciple, humanWritingRules, humanWritingModes],
} as const;
