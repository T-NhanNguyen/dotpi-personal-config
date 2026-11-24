import type { ExtensionAPI, ExtensionCommandContext, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { editProfile, pickProfile } from "./editor.js";
import { toolParents, UNAVAILABLE } from "./provenance.js";
import { activeSelection, GROUPS, listProfileResources, listProfiles, readFilters, readMaskedTools, saveFilters, writeProfile, type Resource } from "./storage.js";

const MAX_COMPOSER_PROFILES = 11; // The twelfth option is None.
type Choice = { value: string; label: string; command: string };
type Control = { id: string; remove: true } | {
	id: string; kind: "cycle"; label: string; description: string; value: string; options: Choice[];
};

function chamberHost() {
	return globalThis as typeof globalThis & {
		__PICHAMBER__?: unknown;
		pichamber?: { control?: (ctx: ExtensionContext, control: Control) => Promise<void> };
	};
}

function isTerminal(ctx: ExtensionContext) {
	const chamber = chamberHost();
	return ctx.mode === "tui" && !chamber.pichamber && !chamber.__PICHAMBER__;
}

async function publishControl(ctx: ExtensionContext, trusted: boolean, loaded: string | undefined) {
	const chamber = chamberHost().pichamber;
	if (typeof chamber?.control !== "function") return;
	const profiles = trusted ? listProfiles() : [];
	if (!profiles.length) {
		await chamber.control(ctx, { id: "profile", remove: true });
		return;
	}
	const visible = profiles.slice(0, MAX_COMPOSER_PROFILES);
	if (loaded && profiles.includes(loaded) && !visible.includes(loaded)) visible[visible.length - 1] = loaded;
	const options = [
		{ value: "none", label: "None", command: "profile none" },
		...visible.map((name) => ({ value: name, label: name, command: `profile ${name}` })),
	];
	await chamber.control(ctx, {
		id: "profile", kind: "cycle", label: "Profile",
		description: "Skills, extensions, and prompts for this project",
		value: loaded && visible.includes(loaded) ? loaded : "none",
		options,
	});
}

export default function (pi: ExtensionAPI) {
	let loaded: ReturnType<typeof activeSelection> = { name: undefined, mask: undefined };
	let disabledTools = new Set<string>();
	const removedTools = new Set<string>();

	function filterTools() {
		if (!disabledTools.size) return;
		const active = pi.getActiveTools();
		const kept = active.filter((tool) => !disabledTools.has(tool));
		if (active.length !== kept.length) {
			pi.setActiveTools(kept);
			for (const tool of active) if (disabledTools.has(tool)) removedTools.add(tool);
		}
	}

	pi.on("session_start", async (_event, ctx) => {
		const terminal = isTerminal(ctx);
		try {
			const trusted = ctx.isProjectTrusted();
			loaded = trusted ? activeSelection(ctx.cwd) : { name: undefined, mask: undefined };
			disabledTools = new Set(loaded.name ? readMaskedTools(loaded.mask) : []);
			filterTools();
			if (terminal) ctx.ui.setStatus("project-profile", ctx.ui.theme.fg("dim", `Profile: ${loaded.name ?? "None"}`));
			await publishControl(ctx, trusted, loaded.name);
		} catch (error) {
			if (terminal) ctx.ui.setStatus("project-profile", ctx.ui.theme.fg("dim", "Profile: unavailable"));
			ctx.ui.notify(`Profiles: ${String(error)}`, "error");
		}
	});

	pi.on("session_shutdown", () => {
		// Reload carries the previous active tool list forward. Restore only names
		// this profile removed so a switch to None inherits the prior list again.
		if (removedTools.size) pi.setActiveTools([...new Set([...pi.getActiveTools(), ...removedTools])]);
		removedTools.clear();
	});

	pi.on("before_agent_start", (event, ctx) => {
		if (!ctx.isProjectTrusted()) return;
		filterTools();
		if (event.systemPromptOptions && disabledTools.size) {
			event.systemPromptOptions.selectedTools = event.systemPromptOptions.selectedTools.filter((tool) => !disabledTools.has(tool));
		}
		let current: ReturnType<typeof activeSelection>;
		try {
			current = activeSelection(ctx.cwd);
		} catch {
			return;
		}
		if (current.name !== loaded.name || current.mask !== loaded.mask) {
			const detail = current.name !== loaded.name
				? `Project profile is now ${current.name ?? "none"}; this session still runs ${loaded.name ?? "none"}.`
				: `This session hasn't loaded the latest ${current.name ?? "project"} profile settings.`;
			ctx.ui.notify(`${detail} Run /profile ${current.name ?? "none"} to load it.`, "warning");
		}
	});

	pi.on("tool_call", (event) => {
		if (disabledTools.has(event.toolName)) return { block: true, reason: `Disabled in the ${loaded.name} profile.` };
	});

	async function chooseInTerminal(ctx: ExtensionCommandContext, profiles: string[]) {
		let highlighted = loaded.name;
		for (;;) {
			const choice = await pickProfile(ctx, ["none", ...profiles], highlighted, loaded.name);
			if (!choice || !choice.edit) return choice?.name;
			highlighted = choice.name;
			try {
				const { filters: saved, revision } = readFilters(choice.name);
				const available = await listProfileResources(ctx.cwd, choice.name);
				const tools = new Map(pi.getAllTools().map(({ name, sourceInfo }) => [name, sourceInfo]));
				for (const name of new Set([...pi.getActiveTools(), ...removedTools])) {
					available.push({ group: "tools", id: name, label: name, parents: toolParents(name, tools.get(name)) });
				}
				const rows = new Map<string, Resource>();
				for (const row of available) rows.set(`${row.group}:${row.id}`, row);
				for (const group of GROUPS) {
					for (const id of saved[group]) {
						const key = `${group}:${id}`;
						if (!rows.has(key)) rows.set(key, { group, id, label: id, parents: [UNAVAILABLE] });
					}
				}
				const resources = [...rows.values()].sort((a, b) => GROUPS.indexOf(a.group) - GROUPS.indexOf(b.group) || a.label.localeCompare(b.label));
				const savedChanges = await editProfile(ctx, choice.name, resources, saved, (filters) => {
					saveFilters(choice.name, filters, revision);
				});
				if (savedChanges) ctx.ui.notify(`Saved ${choice.name}. Select it to apply your changes.`, "info");
			} catch (error) {
				ctx.ui.notify(`Profile not edited: ${String(error)}`, "error");
			}
		}
	}

	pi.registerCommand("profile", {
		description: "Switch this project's profile: /profile <name> or /profile none. In the terminal picker, e edits.",
		handler: async (args, ctx) => {
			if (!ctx.isProjectTrusted()) {
				ctx.ui.notify("Trust this project before switching profiles.", "warning");
				return;
			}
			let target: string | undefined;
			try {
				const profiles = listProfiles();
				const terminal = ctx.hasUI && isTerminal(ctx);
				const choice = args.trim() || (terminal
					? await chooseInTerminal(ctx, profiles)
					: await ctx.ui.select("Profile for this project", ["none", ...profiles]));
				if (!choice) return;
				if (choice !== "none" && !profiles.includes(choice)) {
					ctx.ui.notify(`No profile named "${choice}".`, "error");
					return;
				}
				target = choice === "none" ? undefined : choice;
				await writeProfile(ctx.cwd, target, () => ctx.waitForIdle());
			} catch (error) {
				ctx.ui.notify(`Profile not changed: ${String(error)}`, "error");
				return;
			}
			const ui = ctx.ui; // The command context may be invalidated even if reload fails.
			ui.notify(`Profile: ${target ?? "none"}. Reloading.`, "info");
			try {
				await ctx.reload(); // The new runtime publishes its own status in session_start.
			} catch (error) {
				ui.notify(`Profile ${target ?? "none"} is saved, but this session could not reload. Reopen it to apply the profile. ${String(error)}`, "error");
			}
		},
	});
}
