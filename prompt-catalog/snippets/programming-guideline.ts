import { engineeringPhilosophy, projectScope, contractsAndEffects, structureAndIdioms, commentsAndDocumentation, testingAndVerification } from "../sections/programming-guideline.ts";

export default {
	id: "programming-guideline.md",
	name: "General Programming Guidelines",
	description: "Language-neutral programming standards grounded in correctness, explicit contracts, project conventions, practical trade-offs, safe testing, and strict task scope. Use when implementing features, reviewing code, or writing scripts.",
	placement: "append",
	order: 4,
	sections: [engineeringPhilosophy, projectScope, contractsAndEffects, structureAndIdioms, commentsAndDocumentation, testingAndVerification],
} as const;
