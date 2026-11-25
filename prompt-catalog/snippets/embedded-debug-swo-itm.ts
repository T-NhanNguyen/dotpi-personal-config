import { embeddedDebuggingProcedure } from "../sections/embedded-debug-swo-itm.ts";

export default {
	id: "embedded-debug-swo-itm.md",
	name: "Embedded Debugging Tools",
	description: "Use when debugging embedded hardware behavior, pin readback, or SWO/ITM printf output on ARM Cortex-M. Covers suspecting your own harness first, lock registers, direct SWD testing, and interpreting ITM captures.",
	placement: "append",
	order: 11,
	sections: [embeddedDebuggingProcedure],
} as const;
