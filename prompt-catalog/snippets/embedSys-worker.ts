import { requireTargetDetails, justifyEmbeddedDesign, embeddedImplementationChecklist } from "../sections/embedSys-worker.ts";

export default {
	id: "embedSys-worker.md",
	name: "Strict User's Rules For Embedded",
	description: "Rules for embedded target. User-supplied pin/peripheral/register details take priority; datasheet only with permission. Price concurrency in right budget (stack RAM, scheduler flash) before threads. Design to physical limits — serial timing, alignment, aliasing, no C99 static asserts — not dev host",
	placement: "append",
	order: 10,
	sections: [requireTargetDetails, justifyEmbeddedDesign, embeddedImplementationChecklist],
} as const;
