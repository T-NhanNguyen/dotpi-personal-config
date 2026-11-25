import codeAuditor from "./code-auditor.agent.ts";
import documentationReviewer from "./documentation-reviewer.agent.ts";
import explore from "./explore.agent.ts";
import testMeritGate from "./test-merit-gate.agent.ts";
import testWriter from "./test-writer.agent.ts";
import transcriptReview from "./transcript-review.agent.ts";
import videoMaker from "./video-maker.agent.ts";
import worker from "./worker.agent.ts";
import workerAlt from "./worker-alt.agent.ts";

export const agentCatalog = [
	codeAuditor,
	documentationReviewer,
	explore,
	testMeritGate,
	testWriter,
	transcriptReview,
	videoMaker,
	worker,
	workerAlt,
] as const;
