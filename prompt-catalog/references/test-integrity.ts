import { testMeritCriteria, testPlanning, testBudgetsAndOutput, testInvocationAndExecution, testEvidenceIntegrity } from "../sections/test-integrity.ts";

export default {
	id: "test-integrity.md",
	sections: [testMeritCriteria, testPlanning, testBudgetsAndOutput, testInvocationAndExecution, testEvidenceIntegrity],
} as const;
