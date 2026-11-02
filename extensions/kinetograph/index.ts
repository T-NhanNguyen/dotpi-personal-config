import { resolveKinetograph } from "./runtime.js";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

export default function (pi: ExtensionAPI) {
  if (typeof pi.registerMcpServer !== "function") {
    console.warn("[kinetograph] Disabled: this Pi version does not support registerMcpServer. Update Pi to enable the video tools.");
    return;
  }

  let runtime: ReturnType<typeof resolveKinetograph>;
  try {
    runtime = resolveKinetograph();
  } catch (error) {
    console.warn(`[kinetograph] Disabled: cannot resolve the local CLI. Run npm install in the dotpi-personal-config package directory. ${error instanceof Error ? error.message : String(error)}`);
    return;
  }

  console.warn(`[kinetograph] Selected ${runtime.source}: ${runtime.cli}; skill: ${runtime.skill}. An mcp.json server with this name overrides the runtime; check /mcp before using the skill.`);
  pi.on("resources_discover", () => ({ skillPaths: [runtime.skill] }));

  try {
    pi.registerMcpServer("kinetograph", {
      command: process.execPath,
      args: [runtime.cli, "mcp"],
      exposure: "deferred",
      description: `Create, preview, and render videos and motion graphics with Kinetograph (${runtime.source}).${runtime.source === "local fork" ? " Includes audio_narrate for local audio.cpp narration." : ""}`,
      // Rendering can exceed Pi's default 60-second per-request timeout.
      timeout: 600,
    });
  } catch (error) {
    console.warn(`[kinetograph] MCP registration failed. Check /mcp for conflicts and ensure built-in MCP support is enabled. ${error instanceof Error ? error.message : String(error)}`);
  }
}
