import { strictIncludeAudit, c99HeadersAndNames, c99ScopeAndTypes, c99MacrosAndFormatting, c99Comments } from "../sections/c-audit.ts";

export default {
	id: "c-audit.md",
	name: "Audit C code to IWYU Standards",
	description: "Use when writing, reviewing, or cleaning up C code in this embedded codebase. Covers strict IWYU include audits, uart.c commentary matching led.c, and the C99-compatible subset of the Google style guide.",
	placement: "append",
	order: 13,
	sections: [strictIncludeAudit, c99HeadersAndNames, c99ScopeAndTypes, c99MacrosAndFormatting, c99Comments],
} as const;
