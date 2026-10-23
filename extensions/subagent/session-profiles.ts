import { getSupportedThinkingLevels, type Api, type Model } from "@earendil-works/pi-ai";
import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import type { AgentConfig } from "./agents.ts";

export const PROFILE_ENTRY = "subagent-profile";
export const BUILTIN_PROFILES: Record<string, string> = {
	muse: "meta/muse-spark-1.3-contributor",
	gpt: "openai/gpt-6.1-sol",
	deepseek: "deepseek/deepseek-v4.1-flash",
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

/** Make a complete snapshot. Resolve suffix thinking only when the suffix is a real level. */
export function createProfileMarker(profile: string, model: Model<Api>, agents: AgentConfig[], models: Model<Api>[] = []): ProfileMarker {
	const levels = getSupportedThinkingLevels(model);
	const assignments: Record<string, ProfileAssignment> = Object.create(null);
	for (const agent of agents) {
		if (agent.source !== "user") continue;
		let thinking = agent.thinking;
		const literalModel = models.some(candidate => candidate.id === agent.model || `${candidate.provider}/${candidate.id}` === agent.model);
		if (thinking === undefined && agent.model && !literalModel) {
			const suffix = agent.model.slice(agent.model.lastIndexOf(":") + 1);
			if (["off", "minimal", "low", "medium", "high", "xhigh"].includes(suffix)) thinking = suffix;
		}
		if (thinking !== undefined && !levels.some(level => level === thinking)) {
			throw new Error(`${agent.name}: ${model.provider}/${model.id} does not support thinking '${thinking}'. No choices changed; thinking was not adjusted.`);
		}
		assignments[agent.name] = { model: `${model.provider}/${model.id}`, ...(thinking === undefined ? {} : { thinking }) };
	}
	return { version: 1, profile, assignments };
}

