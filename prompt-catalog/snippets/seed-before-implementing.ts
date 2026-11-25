import { seedPurpose, seedLoop, seedReportShape, seedConstraints } from "../sections/seed-before-implementing.ts";

export default {
	id: "seed-before-implementing.md",
	name: "Seed before implementing",
	description: "Offer 1 to 3 optional prediction questions when starting a substantial task, like a loading-screen quiz. Never collected, never graded. The finished report answers each question so the user can check their own guess privately.",
	placement: "append",
	order: 2,
	sections: [seedPurpose, seedLoop, seedReportShape, seedConstraints],
} as const;
