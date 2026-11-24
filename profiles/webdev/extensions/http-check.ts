import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";

const MAX_BODY_BYTES = 1024 * 1024;
const TIMEOUT_MS = 5_000;

export default function (pi: ExtensionAPI) {
	pi.registerTool({
		name: "http_check",
		label: "HTTP check",
		description: "Fetch an HTTP(S) URL without following redirects. Report its status, content type, and response body size (up to 1 MiB).",
		parameters: Type.Object({ url: Type.String({ description: "Full URL, for example http://localhost:5173/" }) }),
		async execute(_id, params, signal) {
			const url = new URL(params.url);
			if (url.protocol !== "http:" && url.protocol !== "https:") throw new Error("Use an HTTP or HTTPS URL.");
			const timeout = AbortSignal.timeout(TIMEOUT_MS);
			const response = await fetch(url, { redirect: "manual", signal: signal ? AbortSignal.any([signal, timeout]) : timeout });
			const reader = response.body?.getReader();
			let bytes = 0;
			if (reader) {
				try {
					while (bytes <= MAX_BODY_BYTES) {
						const { done, value } = await reader.read();
						if (done) break;
						bytes += value.byteLength;
					}
					if (bytes > MAX_BODY_BYTES) await reader.cancel();
				} finally {
					reader.releaseLock();
				}
			}
			const size = bytes > MAX_BODY_BYTES ? `more than ${MAX_BODY_BYTES} bytes` : `${bytes} bytes`;
			const status = [response.status, response.statusText].filter(Boolean).join(" ");
			const text = `${status}, ${response.headers.get("content-type") ?? "no content type"}, ${size}`;
			return { content: [{ type: "text", text }], details: {} };
		},
	});
}
