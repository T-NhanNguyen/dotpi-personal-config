import { sessionKickoffChecklist } from "../sections/session-kickoff.ts";

export default {
	id: "session-kickoff.md",
	name: "Session kickoff",
	description: "Get oriented, report back before starting work",
	placement: "append",
	order: 7,
	sections: [sessionKickoffChecklist],
} as const;
