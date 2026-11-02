import * as fs from "node:fs";
import * as path from "node:path";
import { randomUUID } from "node:crypto";
import { getSupportedThinkingLevels, type Model, type Api } from "@earendil-works/pi-ai";
import { getAgentDir, withFileMutationQueue, type ExtensionAPI, type ExtensionContext } from "@earendil-works/pi-coding-agent";
import { discoverAgents, type AgentConfig } from "./agents.ts";
import { BUILTIN_PROFILES, PROFILE_ENTRY, createProfileMarker, readSessionProfile, type ProfileDefinition, type ProfileMarker } from "./session-profiles.ts";

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
			const config = readProfileDefinitions(file);
			await fs.promises.writeFile(temporary, `${JSON.stringify({ ...config.raw, version: 2, agents: preferences }, null, 2)}\n`, { mode: 0o600 });
			await fs.promises.rename(temporary, file);
		} finally {
			await fs.promises.rm(temporary, { force: true });
		}
	});
}

function readProfileDefinitions(file = preferencesPath()) {
	let raw: Record<string, any> = {};
	try { raw = JSON.parse(fs.readFileSync(file, "utf8")); }
	catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; }
	const profiles = { ...BUILTIN_PROFILES };
	if (raw.profiles !== undefined) {
		if (!raw.profiles || typeof raw.profiles !== "object" || Array.isArray(raw.profiles)) throw new Error("Invalid profile definitions");
		for (const [name, value] of Object.entries(raw.profiles)) {
			const valid = (typeof value === "string" && value.trim().length > 0) ||
				(typeof value === "object" && value !== null && !Array.isArray(value) && Object.keys(value).length > 0 &&
					Object.values(value as Record<string, unknown>).every((v) => typeof v === "string" && v.trim().length > 0));
			if (!valid) throw new Error(`Profile ${name} must name a provider/model-id, or map agent names to provider/model-id[:thinking]`);
			Object.defineProperty(profiles, name, { value, enumerable: true, configurable: true });
		}
	}
	if (raw.defaultProfile !== undefined && (typeof raw.defaultProfile !== "string" || !Object.hasOwn(profiles, raw.defaultProfile))) {
		throw new Error("defaultProfile must name an existing profile");
	}
	return { raw, profiles, defaultProfile: raw.defaultProfile as string | undefined };
}

/** Renders a string profile as-is and a per-agent map as a compact summary. */
export function describeProfileDefinition(definition: ProfileDefinition): string {
	if (typeof definition === "string") return definition;
	const models = [...new Set(Object.values(definition))].sort();
	return `${Object.keys(definition).length} agents → ${models.join(", ")}`;
}

/** Shared by the inspector and every spawn mode. Session assignments override, never rewrite, disk preferences. */
export function effectivePreferences(ctx: ExtensionContext, agents: AgentConfig[]): { preferences: Preferences; profile?: string; session: boolean; profileAgents?: ReadonlySet<string> } {
	const preferences = readPreferences();
	const marker = readSessionProfile(ctx);
	if (marker) return { preferences: Object.assign(preferences, marker.assignments), profile: marker.profile!, session: true, profileAgents: new Set(Object.keys(marker.assignments)) };
	const config = readProfileDefinitions();
	if (config.defaultProfile) {
		const base = applyModelPreferences(agents, preferences, [], new Set());
		const snapshot = createProfileMarker(config.defaultProfile, config.profiles[config.defaultProfile], base, ctx.modelRegistry.getAll());
		return { preferences: Object.assign(preferences, snapshot.assignments), profile: config.defaultProfile, session: false, profileAgents: new Set(Object.keys(snapshot.assignments)) };
	}
	return { preferences, session: false };
}

function describeAgent(agent: AgentConfig, preferences: Preferences): string {
	const preference = own(preferences, agent.name) ? preferences[agent.name] : undefined;
	return `${agent.name} — ${preference ? preference.model ?? "Pi default" : agent.model ?? "Pi default"} | thinking: ${preference?.thinking ?? "child defaults"}`;
}

export function registerModelPicker(pi: ExtensionAPI): void {
	const output = (ctx: ExtensionContext, text: string, error = false) => {
		if (ctx.hasUI) ctx.ui.notify(text, error ? "error" : "info");
		else process.stderr.write(text + "\n");
	};
	const profileCommand = async (args: string, ctx: ExtensionContext) => {
		try {
			const name = args.trim();
			if (name === "clear") {
				const marker: ProfileMarker = { version: 1, profile: null, assignments: {} };
				pi.appendEntry(PROFILE_ENTRY, marker);
				output(ctx, "Session profile cleared. Future runs use configured defaults. Global choices unchanged.");
				return;
			}
			const config = readProfileDefinitions();
			if (!name || name === "list" || name === "ls") {
				const active = readSessionProfile(ctx)?.profile ?? config.defaultProfile ?? "none (agent defaults)";
				output(ctx, `Current profile: ${active}\n${Object.entries(config.profiles).map(([n, definition]) => `${n}: ${describeProfileDefinition(definition)}`).join("\n")}\nUsage: /subagent-profile <name> | clear`);
				return;
			}
			if (!Object.hasOwn(config.profiles, name)) throw new Error(`Unknown profile '${name}'. Use /subagent-profile to list profiles.`);
			await ctx.modelRegistry.refresh();
			const agents = discoverAgents(ctx.cwd, "user").agents;
			if (!agents.length) throw new Error("No user agents found. Nothing changed.");
			const current = effectivePreferences(ctx, agents).preferences;
			const base = applyModelPreferences(agents, current, [], new Set());
			const marker = createProfileMarker(name, config.profiles[name], base, ctx.modelRegistry.getAvailable());
			pi.appendEntry(PROFILE_ENTRY, marker);
			output(ctx, `Session profile: ${name}. Global choices unchanged. Applies to future user-agent runs only.\n${Object.entries(marker.assignments).map(([agent, p]) => `${agent}: ${p.model} | thinking: ${p.thinking ?? "child defaults"}`).join("\n")}\nProject agents and already-running children are unchanged.`);
		} catch (error) { output(ctx, `Subagent profile: ${error instanceof Error ? error.message : String(error)}`, true); }
	};
	pi.registerCommand("subagent-profile", { description: "Choose a session-only subagent profile, or clear it", handler: profileCommand });
	pi.registerCommand("subagent-model", {
		description: "Set user subagent models/thinking: [agent], list, or set <agent> <model>[:thinking]",
		handler: async (args, ctx) => {
			const output = (text: string) => {
				if (ctx.hasUI) ctx.ui.notify(text, "info");
				else process.stderr.write(text + "\n");
			};
			const usage = "Usage: /subagent-model [agent] | list (ls) | set <agent> <model>[:thinking]. Overrides apply only to future user subagent runs; main session unchanged.";
			const words = args.trim().split(/\s+/).filter(Boolean);
			try {
				const agents = discoverAgents(ctx.cwd, "user").agents.sort((a, b) => a.name.localeCompare(b.name));
				const effective = effectivePreferences(ctx, agents);
				const preferences = effective.preferences;
				const activeNotice = effective.profile ? ` Session profile '${effective.profile}' still takes precedence; /subagent-profile clear restores saved choices.` : "";
				const list = () => output(agents.length ? agents.map((agent) => {
					const saved = own(preferences, agent.name);
					const preference = saved ? preferences[agent.name] : undefined;
					const model = preference ? preference.model ?? "Pi default" : agent.model ?? "Pi default";
					const thinking = preference ? preference.thinking ?? "child defaults" : agent.thinking ?? "child defaults";
					return `${agent.name} — ${model} | thinking: ${thinking} | source: ${effective.profile && effective.profileAgents?.has(agent.name) ? `${effective.session ? "session" : "default"} profile (${effective.profile})` : saved ? "saved override" : "definition/default (default)"}`;
				}).join("\n") : "No user subagents found in the agents directory.");
				if ((words[0] === "list" || words[0] === "ls") && words.length === 1) {
					list();
					return;
				}
				if (words[0] === "set") {
					if (words.length !== 3) { output(usage); return; }
					const [, name, requested] = words;
					if (!agents.some((agent) => agent.name === name)) {
						output(`Unknown user subagent: ${name}\n${usage}`);
						return;
					}
					let models: Model<Api>[] | undefined;
					try {
						if (ctx.modelRegistry) {
							await ctx.modelRegistry.refresh();
							models = ctx.modelRegistry.getAvailable();
						}
					} catch (error) {
						if (ctx.hasUI) throw error;
						// Headless clients may have no usable registry. Preserve the literal model ID.
					}
					let preference: Preference = { model: requested };
					if (!/^[^\s\x00-\x1f\x7f]+$/.test(requested) || requested.startsWith(":") || requested.endsWith(":")) {
						throw new Error(`Invalid model: ${requested}`);
					}
					if (models !== undefined) {
						const find = (id: string) => models.find((model) => modelKey(model) === id) ?? models.find((model) => model.id === id);
						// A literal ID (including any colon) always wins over a thinking suffix.
						const exact = find(requested);
						if (exact) preference = { model: modelKey(exact) };
						else {
							const colon = requested.lastIndexOf(":");
							const model = colon > 0 ? find(requested.slice(0, colon)) : undefined;
							const thinking = requested.slice(colon + 1);
							if (!model || !getSupportedThinkingLevels(model).some((level) => level === thinking)) {
								throw new Error(`Unknown available model or unsupported thinking level: ${requested}`);
							}
							preference = { model: modelKey(model), thinking };
						}
					}
					await savePreference(name, preference);
					output(`${name}: ${preference.model} | thinking: ${preference.thinking ?? "child defaults"}.${models === undefined ? " Model was not registry-validated; any colon suffix was preserved as part of the model ID." : ""} Applies to future subagent runs; main session unchanged.${activeNotice}`);
					return;
				}
				let name = args.trim();
				if (name && !agents.some((agent) => agent.name === name)) {
					output(usage);
					return;
				}
				if (!ctx.hasUI) {
					output(usage);
					list();
					return;
				}
				if (!agents.length) {
					ctx.ui.notify("No user subagents found in the agents directory.", "warning");
					return;
				}
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
				ctx.ui.notify(`${name}: ${summary}. Applies to future subagent runs; main session unchanged.${activeNotice}`, "info");
			} catch (error) {
				const message = `Subagent model picker: ${error instanceof Error ? error.message : String(error)}`;
				if (ctx.hasUI) ctx.ui.notify(message, "error");
				else output(message);
			}
		},
	});
}
