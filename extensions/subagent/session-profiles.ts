import { getSupportedThinkingLevels, type Api, type Model } from "@earendil-works/pi-ai";
import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import type { AgentConfig } from "./agents.ts";

export const PROFILE_ENTRY = "subagent-profile";
/**
 * A profile is either one model applied to every user agent, or a map of agent name to
 * a model spec (`provider/model` with an optional `:thinking` suffix). A string profile
 * preserves each agent's existing thinking; a map states thinking explicitly, so an entry
 * without a suffix means child thinking defaults.
 */
export type ProfileDefinition = string | Record<string, string>;
export const BUILTIN_PROFILES: Record<string, ProfileDefinition> = {
	muse: "meta/muse-spark-1.3-contributor",
	gpt: "openai/gpt-6.1-sol",
	deepseek: {
		"code-auditor": "deepseek/deepseek-v4-pro:high",
		"test-merit-gate": "deepseek/deepseek-v4-pro:high",
		explore: "deepseek/deepseek-flash:inherit",
		worker: "deepseek/deepseek-flash:inherit",
		"documentation-reviewer": "deepseek/deepseek-flash:inherit",
		"test-writer": "deepseek/deepseek-flash:inherit",
		"transcript-review": "deepseek/deepseek-flash:inherit",
		"video-maker": "deepseek/deepseek-flash:inherit",
	},
	kimi: {
		"code-auditor": "kimi-coding/k3-256k:high",
		"test-merit-gate": "kimi-coding/k3-256k:high",
		"documentation-reviewer": "kimi-coding/kimi-for-coding",
		"transcript-review": "kimi-coding/kimi-for-coding",
		explore: "kimi-coding/kimi-for-coding",
		"test-writer": "kimi-coding/kimi-for-coding:high",
		"video-maker": "kimi-coding/kimi-for-coding:high",
		worker: "kimi-coding/kimi-for-coding:high",
	},
};
export interface ProfileAssignment { model: string; thinking?: string }
export interface ProfileMarker {
	version: 1;
	profile: string | null;
	assignments: Record<string, ProfileAssignment>;
}

/** Use the active branch, including entries before compaction, not abandoned histories. */
export function readSessionProfile(ctx: Pick<ExtensionContext, "sessionManager">): ProfileMarker | undefined {
	const entries = ctx.sessionManager?.getBranch() ?? [];
	for (let i = entries.length - 1; i >= 0; i--) {
		const entry = entries[i];
		if (entry.type !== "custom" || entry.customType !== PROFILE_ENTRY) continue;
		const data = entry.data as ProfileMarker;
		if (!data || data.version !== 1 || !(data.profile === null || typeof data.profile === "string") ||
			!data.assignments || typeof data.assignments !== "object" || Array.isArray(data.assignments)) {
			throw new Error("Invalid session profile marker. Run /subagent-profile clear to reset it.");
		}
		for (const value of Object.values(data.assignments)) {
			if (!value || typeof value.model !== "string" || !value.model.trim() ||
				(value.thinking !== undefined && typeof value.thinking !== "string")) {
				throw new Error("Invalid session profile assignment. Run /subagent-profile clear to reset it.");
			}
		}
		return data.profile === null ? undefined : data;
	}
	return undefined;
}

/** Resolve the real provider-qualified ID; never save an unvalidated display name. */
export function resolveProfileModel(requested: string, models: Model<Api>[]): Model<Api> {
	const exact = models.find(m => `${m.provider}/${m.id}` === requested);
	if (exact) return exact;
	const candidates = models.filter(m => m.id === requested || m.id === requested.slice(requested.indexOf("/") + 1));
	if (candidates.length !== 1) throw new Error(`Profile model ${requested} is ${candidates.length ? "ambiguous" : "unavailable"}. No choices changed.`);
	return candidates[0];
}

const THINKING_LEVELS = ["off", "minimal", "low", "medium", "high", "xhigh", "max"];
const isResolvedModel = (value: unknown): value is Model<Api> =>
	typeof value === "object" && value !== null &&
	typeof (value as Model<Api>).id === "string" && typeof (value as Model<Api>).provider === "string";

/** A literal model ID (including any colon) always wins over a thinking suffix. `:inherit` keeps the agent's own level. */
function splitModelSpec(spec: string, models: Model<Api>[]): { target: string; thinking?: string; inherit?: boolean } {
	if (models.some(candidate => candidate.id === spec || `${candidate.provider}/${candidate.id}` === spec)) return { target: spec };
	const colon = spec.lastIndexOf(":");
	if (colon <= 0) return { target: spec };
	const suffix = spec.slice(colon + 1);
	const target = spec.slice(0, colon);
	if (suffix === "inherit") return { target, inherit: true };
	return THINKING_LEVELS.includes(suffix) ? { target, thinking: suffix } : { target: spec };
}

/** An agent's saved level, else a real level in its model suffix. undefined means child defaults. */
function inheritedThinking(agent: AgentConfig, models: Model<Api>[]): string | undefined {
	if (agent.thinking !== undefined) return agent.thinking;
	if (!agent.model) return undefined;
	const literalModel = models.some(candidate => candidate.id === agent.model || `${candidate.provider}/${candidate.id}` === agent.model);
	if (literalModel) return undefined;
	const suffix = agent.model.slice(agent.model.lastIndexOf(":") + 1);
	return THINKING_LEVELS.includes(suffix) ? suffix : undefined;
}

/** Make a complete snapshot. String profiles preserve existing thinking; maps state it explicitly. */
export function createProfileMarker(
	profile: string,
	definition: Model<Api> | ProfileDefinition,
	agents: AgentConfig[],
	models: Model<Api>[] = [],
): ProfileMarker {
	const perAgent = typeof definition === "object" && !isResolvedModel(definition) ? definition : undefined;
	const fixed = isResolvedModel(definition)
		? definition
		: typeof definition === "string"
			? resolveProfileModel(definition, models)
			: undefined;
	const assignments: Record<string, ProfileAssignment> = Object.create(null);
	for (const agent of agents) {
		if (agent.source !== "user") continue;
		let model: Model<Api>;
		let thinking: string | undefined;
		if (perAgent) {
			const spec = perAgent[agent.name];
			// Agents a map does not list keep their own saved or definition model.
			if (spec === undefined) continue;
			const parsed = splitModelSpec(spec, models);
			model = resolveProfileModel(parsed.target, models);
			thinking = parsed.inherit ? inheritedThinking(agent, models) : parsed.thinking;
		} else {
			model = fixed!;
			thinking = inheritedThinking(agent, models);
		}
		if (thinking !== undefined && !getSupportedThinkingLevels(model).some(level => level === thinking)) {
			throw new Error(`${agent.name}: ${model.provider}/${model.id} does not support thinking '${thinking}'. No choices changed; thinking was not adjusted.`);
		}
		assignments[agent.name] = { model: `${model.provider}/${model.id}`, ...(thinking === undefined ? {} : { thinking }) };
	}
	return { version: 1, profile, assignments };
}

