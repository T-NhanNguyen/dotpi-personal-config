/**
 * localpi — project-local .pi overrides for quick model-provider swaps.
 *
 * Barebone first implementation:
 *   /localpi <agent|all|submodel|<extension>> [model ...]
 *
 * - Agent names resolve to `agents/<name>.md` in this package. The file is
 *   copied to `<cwd>/.pi/agents/<name>.md` with only the `model:` frontmatter
 *   value replaced. Any `:thinking` suffix is preserved (no thinking change).
 * - `all` (alias: `submodel`) localizes every repo agent. This is the
 *   token-limit escape hatch: one command swaps all subagents to a fallback
 *   provider model so work can continue.
 * - Extension names resolve to `extensions/<name>/` in this package and are
 *   recursively copied to `<cwd>/.pi/extensions/<name>/` (no model rewrite).
 *
 * CLI + RPC (PiChamber) compatible: output via notify/stderr only, optional
 * `select` disambiguation when interactive, no custom TUI rendering.
 */

import { existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { cp, mkdir } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";

const packageDir = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const repoAgentsDir = join(packageDir, "agents");
const repoExtensionsDir = join(packageDir, "extensions");

/** Barebone provider shortcuts: short word → exact registry id. */
const MODEL_SHORTCUTS: Record<string, string> = {
	gpt: "openai/gpt-6.1-sol",
	deepseek: "deepseek/deepseek-flash",
	kimi: "kimi-coding/kimi-for-coding",
	muse: "meta/muse-spark-1.3-contributor",
};

function output(ctx: ExtensionContext, text: string, level: "info" | "error" | "warning" = "info") {
	if (ctx.hasUI) ctx.ui.notify(text, level);
	else process.stderr.write(text + "\n");
}

function listRepoAgents(): string[] {
	if (!existsSync(repoAgentsDir)) return [];
	return readdirSync(repoAgentsDir)
		.filter((f) => f.endsWith(".md"))
		.map((f) => f.replace(/\.md$/i, ""))
		.sort();
}

function listRepoExtensions(): string[] {
	if (!existsSync(repoExtensionsDir)) return [];
	return readdirSync(repoExtensionsDir)
		.filter((f) => {
			try {
				return statSync(join(repoExtensionsDir, f)).isDirectory();
			} catch {
				return false;
			}
		})
		.sort();
}

/** Split `provider/model:thinking` into model id + thinking suffix (suffix includes the colon). */
function splitModelThinking(raw: string): { id: string; thinking: string } {
	const idx = raw.lastIndexOf(":");
	// A colon is a thinking suffix only if something that looks like a model id precedes it.
	if (idx > 0 && !raw.endsWith(":") && !raw.startsWith(":")) {
		const maybeThinking = raw.slice(idx + 1);
		if (/^[A-Za-z][\w-]*$/.test(maybeThinking) && raw.slice(0, idx).includes("/")) {
			return { id: raw.slice(0, idx), thinking: raw.slice(idx) };
		}
	}
	return { id: raw, thinking: "" };
}

async function resolveModelId(ctx: ExtensionContext, query: string): Promise<string> {
	const q = query.trim();
	if (!q) throw new Error("Empty model query");
	const shortcut = MODEL_SHORTCUTS[q.toLowerCase()];
	if (shortcut) return shortcut;
	try {
		await ctx.modelRegistry.refresh();
	} catch {
		return q; // headless without registry: preserve literal
	}
	const models = ctx.modelRegistry.getAvailable();
	if (!models.length) return q;
	const lower = q.toLowerCase();
	const key = (m: { provider: string; id: string; name?: string }) =>
		`${m.provider}/${m.id} ${m.id} ${m.name ?? ""}`.toLowerCase();
	// 1. exact provider/id, 2. exact id, 3. exact display name, 4. substring
	const exact =
		models.find((m) => `${m.provider}/${m.id}`.toLowerCase() === lower) ??
		models.find((m) => m.id.toLowerCase() === lower) ??
		models.find((m) => (m.name ?? "").toLowerCase() === lower);
	if (exact) return `${exact.provider}/${exact.id}`;
	const matches = models.filter((m) => key(m).includes(lower));
	if (matches.length === 1) return `${matches[0].provider}/${matches[0].id}`;
	if (matches.length > 1) {
		if (ctx.hasUI && ctx.mode === "tui") {
			const labels = [...new Set(matches.map((m) => `${m.provider}/${m.id}`))].sort();
			const picked = await ctx.ui.select(`Multiple models match "${q}" — choose one`, labels);
			if (picked === undefined) throw new Error("Model selection canceled; nothing was written.");
			return picked;
		}
		throw new Error(
			`Ambiguous model "${q}" matches: ${[...new Set(matches.map((m) => `${m.provider}/${m.id}`))].sort().join(", ")}`,
		);
	}
	return q; // unknown to registry: preserve literal (child pi validates later)
}

function swapFrontmatterModel(markdown: string, newModelId: string): { text: string; before: string; after: string } {
	const match = markdown.match(/^---\r?\n([\s\S]*?)\r?\n---/);
	if (!match) throw new Error("Agent file has no frontmatter block");
	const before = /^[ \t]*model[ \t]*:[ \t]*(.+?)[ \t]*$/m.exec(match[1]);
	const prev = (before?.[1] ?? "").trim().replace(/^["']|["']$/g, "");
	const thinking = prev ? splitModelThinking(prev).thinking : "";
	const after = `${newModelId}${thinking}`;
	const head = match[1].replace(/^[ \t]*model[ \t]*:.*$/m, `model: ${after}`);
	let text = markdown.replace(match[1], head);
	if (markdown.includes("\r\n")) text = text.replace(/(?<!\r)\n/g, "\r\n");
	return { text, before: prev || "(none)", after };
}

async function localizeAgent(ctx: ExtensionContext, agent: string, modelQuery: string | null): Promise<string> {
	const src = join(repoAgentsDir, `${agent}.md`);
	if (!existsSync(src)) throw new Error(`Unknown agent "${agent}". Repo agents: ${listRepoAgents().join(", ") || "none"}`);
	const raw = readFileSync(src, "utf8");
	let text = raw;
	let summary = "model unchanged";
	if (modelQuery) {
		const id = await resolveModelId(ctx, modelQuery);
		const swapped = swapFrontmatterModel(raw, id);
		text = swapped.text;
		summary = `${swapped.before} → ${swapped.after}`;
	}
	const destDir = join(ctx.cwd, ".pi", "agents");
	await mkdir(destDir, { recursive: true });
	const dest = join(destDir, `${agent}.md`);
	writeFileSync(dest, text, "utf8");
	return `${agent}: ${summary}\n  ${src} → ${dest}`;
}

async function localizeExtension(ctx: ExtensionContext, name: string): Promise<string> {
	const src = join(repoExtensionsDir, name);
	if (!existsSync(src) || !statSync(src).isDirectory())
		throw new Error(`Unknown extension "${name}". Repo extensions: ${listRepoExtensions().join(", ") || "none"}`);
	const dest = join(ctx.cwd, ".pi", "extensions", name);
	await mkdir(dirname(dest), { recursive: true });
	await cp(src, dest, { recursive: true });
	return `${name}: copied\n  ${src}/ → ${dest}/`;
}

const USAGE =
	"Usage: /localpi <agent|all|submodel|<extension>> [model]. " +
	'Examples: /localpi worker "Muse Spark"; /localpi all "provider/model-id". ' +
	"Thinking level is never changed; only the model id is swapped. " +
	"Project .pi requires trust: run /trust then restart pi.";

async function handleCommand(args: string, ctx: ExtensionContext) {
	const parts = args.trim().split(/\s+/).filter(Boolean);
	if (!parts.length) {
		output(
			ctx,
			`${USAGE}\nRepo agents: ${listRepoAgents().join(", ") || "none"}\nRepo extensions: ${listRepoExtensions().join(", ") || "none"}`,
		);
		return;
	}
	const [target, ...rest] = parts;
	const modelQuery = rest.length ? rest.join(" ").replace(/^["']|["']$/g, "") : null;
	try {
		if (target === "all" || target === "submodel") {
			if (!modelQuery) {
				output(ctx, `Usage: /localpi ${target} <model>. ${USAGE}`, "error");
				return;
			}
			const agents = listRepoAgents();
			if (!agents.length) {
				output(ctx, "No repo agents found to localize.", "warning");
				return;
			}
			if (!existsSync(join(ctx.cwd, ".pi"))) mkdirSync(join(ctx.cwd, ".pi"), { recursive: true });
			const lines: string[] = [];
			for (const agent of agents) lines.push(await localizeAgent(ctx, agent, modelQuery));
			output(
				ctx,
				`Localized ${agents.length} agent(s) to project .pi (thinking preserved):\n${lines.join("\n")}\nRun /trust then restart pi to activate.`,
			);
			return;
		}
		if (listRepoAgents().includes(target)) {
			const line = await localizeAgent(ctx, target, modelQuery);
			output(ctx, `Localized project override (thinking preserved):\n${line}\nRun /trust then restart pi to activate.`);
			return;
		}
		if (listRepoExtensions().includes(target)) {
			if (modelQuery) {
				output(ctx, `Note: model swap applies to agents only; copying extension "${target}" unchanged.`, "warning");
			}
			const line = await localizeExtension(ctx, target);
			output(ctx, `Localized project override:\n${line}\nRun /trust then restart pi to activate.`);
			return;
		}
		output(ctx, `Unknown target "${target}". ${USAGE}`, "error");
	} catch (error) {
		output(ctx, `/localpi failed: ${error instanceof Error ? error.message : String(error)}`, "error");
	}
}

export default function (pi: ExtensionAPI) {
	pi.registerCommand("localpi", {
		description: "Copy repo agent/extension to cwd .pi project override, swapping model (thinking preserved)",
		handler: handleCommand,
	});
}
