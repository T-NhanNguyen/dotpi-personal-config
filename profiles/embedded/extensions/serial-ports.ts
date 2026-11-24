import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { readdirSync } from "node:fs";
import { Type } from "typebox";

export default function (pi: ExtensionAPI) {
	pi.registerTool({
		name: "serial_ports",
		label: "Serial ports",
		description: "List serial devices matching /dev/ttyUSB*, /dev/ttyACM*, or /dev/cu.*. Does not open the devices.",
		parameters: Type.Object({}),
		async execute() {
			const ports = readdirSync("/dev")
				.filter((name) => /^(ttyUSB|ttyACM|cu\.)/.test(name))
				.sort()
				.map((name) => `/dev/${name}`);
			return { content: [{ type: "text", text: ports.join("\n") || "No serial devices found." }], details: {} };
		},
	});
}
