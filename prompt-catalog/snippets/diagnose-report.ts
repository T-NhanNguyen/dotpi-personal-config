import { diagnoseWithoutEditing } from "../sections/diagnose-report.ts";

export default {
	id: "diagnose-report.md",
	name: "Diagnose, don't fix",
	description: "Read-only, report findings and a proposed fix",
	placement: "append",
	order: 9,
	sections: [diagnoseWithoutEditing],
} as const;
