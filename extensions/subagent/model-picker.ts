import * as fs from "node:fs";
import * as path from "node:path";
import { randomUUID } from "node:crypto";
import { getSupportedThinkingLevels, type Model, type Api } from "@earendil-works/pi-ai";
import { getAgentDir, withFileMutationQueue, type ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { discoverAgents, type AgentConfig } from "./agents.ts";

export interface Preference { model: string | null; thinking?: string }
type Preferences = Record<string, Preference>;
const own = (object: object, key: string) => Object.prototype.hasOwnProperty.call(object, key);
const modelKey = (model: Model<Api>) => `${model.provider}/${model.id}`;
export const preferencesPath = () => path.join(getAgentDir(), "subagent-models.json");

function normalizePreference(value: unknown): Preference {
	// Legacy values remain accepted; null explicitly uses child pi defaults.
	if (value === null || typeof value === "string") {
		if (typeof value === "string" && !value.trim()) throw new Error("Empty model preference");
		return { model: value };
	}
	if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Invalid model preference");
	const preference = value as Preference;
	if (preference.model !== null && (typeof preference.model !== "string" || !preference.model.trim())) {
		throw new Error("Invalid model preference");
	}
	if (preference.thinking !== undefined && (typeof preference.thinking !== "string" || !preference.thinking.trim() || preference.model === null)) {
		throw new Error("Explicit subagent thinking requires a fixed model and a nonempty level");
	}
	return { model: preference.model, ...(preference.thinking === undefined ? {} : { thinking: preference.thinking }) };
}

export function readPreferences(file = preferencesPath()): Preferences {
	let text: string;
	try { text = fs.readFileSync(file, "utf8"); }
	catch (error) {
		if ((error as NodeJS.ErrnoException).code === "ENOENT") return Object.create(null);
		throw error;
	}
	try {
		const data = JSON.parse(text);
		if (!data || ![1, 2].includes(data.version) || !data.agents || typeof data.agents !== "object" || Array.isArray(data.agents)) {
			throw new Error("Invalid configuration structure");
		}
		const preferences: Preferences = Object.create(null);
		for (const [name, value] of Object.entries(data.agents)) preferences[name] = normalizePreference(value);
		return preferences;
	} catch (error) {
		throw new Error(`Invalid subagent configuration ${file}: ${error instanceof Error ? error.message : String(error)}`);
	}
}

export function applyModelPreferences(
	agents: AgentConfig[],
	preferences = readPreferences(),
	models: Model<Api>[] = [],
	requestedNames?: ReadonlySet<string>,
): AgentConfig[] {
	return agents.map((agent) => {
		if (agent.source !== "user" || !own(preferences, agent.name)) return agent;
		const preference = preferences[agent.name];
		if (preference.thinking !== undefined && (!requestedNames || requestedNames.has(agent.name))) {
			const model = models.find((candidate) => modelKey(candidate) === preference.model);
			if (!model || !getSupportedThinkingLevels(model).some((level) => level === preference.thinking)) {
				throw new Error(`Subagent ${agent.name}: saved thinking '${preference.thinking}' is not supported by ${preference.model}. Run /subagent-model ${agent.name} to choose again. No automatic thinking escalation was applied.`);
			}
		}
		return { ...agent, model: preference.model ?? undefined, thinking: preference.thinking };
	});
}

// Shared by every spawn mode. Explicit CLI thinking overrides child defaults and model suffixes.
export function agentModelArgs(agent: AgentConfig): string[] {
	const args: string[] = [];
	if (agent.model) args.push("--model", agent.model);
	if (agent.thinking !== undefined) args.push("--thinking", agent.thinking);
	return args;
}

export async function savePreference(name: string, value: Preference | string | null | undefined, file = preferencesPath()): Promise<void> {
	await withFileMutationQueue(file, async () => {
		const preferences = readPreferences(file);
		if (value === undefined) delete preferences[name];
		else preferences[name] = normalizePreference(value);
		await fs.promises.mkdir(path.dirname(file), { recursive: true });
		const temporary = `${file}.${randomUUID()}.tmp`;
		try {
			await fs.promises.writeFile(temporary, `${JSON.stringify({ version: 2, agents: preferences }, null, 2)}\n`, { mode: 0o600 });
			await fs.promises.rename(temporary, file);
		} finally {
			await fs.promises.rm(temporary, { force: true });
		}
	});
}

function describeAgent(agent: AgentConfig, preferences: Preferences): string {
	const preference = own(preferences, agent.name) ? preferences[agent.name] : undefined;
	return `${agent.name} — ${preference ? preference.model ?? "Pi default" : agent.model ?? "Pi default"} | thinking: ${preference?.thinking ?? "child defaults"}`;
}

export function registerModelPicker(pi: ExtensionAPI): void {
	pi.registerCommand("subagent-model", {
		description: "Search models and set independent thinking for a user subagent (optional: agent name)",
		handler: async (args, ctx) => {
			if (!ctx.hasUI) {
				ctx.ui.notify("/subagent-model requires a dialog-capable TUI or RPC client.", "warning");
				return;
			}
			try {
				const agents = discoverAgents(ctx.cwd, "user").agents.sort((a, b) => a.name.localeCompare(b.name));
				if (!agents.length) {
					ctx.ui.notify("No user subagents found in the agents directory.", "warning");
					return;
				}
				const preferences = readPreferences();
				let name = args.trim();
				if (!name) {
					const labels = agents.map((agent) => describeAgent(agent, preferences));
					const selection = await ctx.ui.select("Subagent model / thinking: choose agent", labels);
					if (selection === undefined) return;
					const index = labels.indexOf(selection);
					if (index < 0) return;
					name = agents[index].name;
				}
				const agent = agents.find((candidate) => candidate.name === name);
				if (!agent) {
					ctx.ui.notify(`Unknown user subagent: ${name}`, "error");
					return;
				}
				// Like /model, notice edited models.json before constructing choices.
				await ctx.modelRegistry.refresh();
				const models = ctx.modelRegistry.getAvailable();
				const defaults = "Use pi default (child settings; thinking may be high)";
				const reset = "Use agent definition (remove model and thinking override)";
				const search = "Search models…";
				let query = "";
				let preference: Preference | undefined;
				while (true) {
					const words = query.toLowerCase().split(/\s+/).filter(Boolean);
					const filtered = models.filter((model) => words.every((word) => `${modelKey(model)} ${model.name}`.toLowerCase().includes(word)));
					const keys = [...new Set(filtered.map(modelKey))].sort();
					const selected = await ctx.ui.select(`${describeAgent(agent, preferences)}${query ? ` — filter: ${query}` : ""}`, [search, defaults, reset, ...keys]);
					if (selected === undefined) return;
					if (selected === search) {
						const input = await ctx.ui.input("Filter by provider, model ID or name (blank shows all)", query);
						if (input === undefined) return;
						query = input.trim();
						if (!models.some((model) => query.toLowerCase().split(/\s+/).filter(Boolean).every((word) => `${modelKey(model)} ${model.name}`.toLowerCase().includes(word)))) {
							ctx.ui.notify("No matching models. Choose Search models to revise the filter.", "info");
						}
						continue;
					}
					if (selected === defaults) { preference = { model: null }; break; }
					if (selected === reset) break;
					const model = filtered.find((candidate) => modelKey(candidate) === selected);
					if (!model) return;
					const levels = getSupportedThinkingLevels(model);
					const childDefault = "Use child thinking defaults (may be high)";
					const thinking = await ctx.ui.select(`${name}: thinking for ${selected} (independent of main session)`, [...levels, childDefault]);
					if (thinking === undefined) return;
					if (thinking !== childDefault && !levels.some((level) => level === thinking)) return;
					preference = { model: selected, ...(thinking === childDefault ? {} : { thinking }) };
					break;
				}
				// Model and thinking are committed together only after all dialogs finish.
				await savePreference(name, preference);
				const summary = preference ? `${preference.model ?? "Pi default"} | thinking: ${preference.thinking ?? "child defaults"}` : "agent definition | thinking: child defaults";
				ctx.ui.notify(`${name}: ${summary}. Applies to future subagent runs; main session unchanged.`, "info");
			} catch (error) {
				ctx.ui.notify(`Subagent model picker: ${error instanceof Error ? error.message : String(error)}`, "error");
			}
		},
	});
}
