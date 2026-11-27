import askQuestions from "./ask-questions.ts";
import cAudit from "./c-audit.ts";
import devJournaling from "./dev-journaling.ts";
import diagnoseReport from "./diagnose-report.ts";
import embedSysWorker from "./embedSys-worker.ts";
import embeddedDebugSwoItm from "./embedded-debug-swo-itm.ts";
import filesWritingStyle from "./files-writing-style.ts";
import orchestratorMode from "./orchestrator-mode.ts";
import programmingGuideline from "./programming-guideline.ts";
import responseInstruction from "./response-instruction.ts";
import seedBeforeImplementing from "./seed-before-implementing.ts";
import sessionKickoff from "./session-kickoff.ts";

export const snippetCatalog = [
	askQuestions,
	cAudit,
	devJournaling,
	diagnoseReport,
	embedSysWorker,
	embeddedDebugSwoItm,
	filesWritingStyle,
	orchestratorMode,
	programmingGuideline,
	responseInstruction,
	seedBeforeImplementing,
	sessionKickoff,
] as const;
