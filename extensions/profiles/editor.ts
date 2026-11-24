import type { ExtensionCommandContext } from "@earendil-works/pi-coding-agent";
import { Key, matchesKey, truncateToWidth } from "@earendil-works/pi-tui";
import type { Parent } from "./provenance.js";
import { GROUPS, type Filters, type Resource } from "./storage.js";

type Context = ExtensionCommandContext;
type Selection = { kind: "add" } | { kind: "switch" | "edit" | "rename" | "delete"; name: string };
type Menu = { title: string; help: string; notice?: string; length: number; initial: number; row: (index: number) => string };

function list<T>(ctx: Context, menu: Menu, onKey: (data: string, index: number, done: (result: T | undefined) => void) => void) {
	return ctx.ui.custom<T | undefined>((tui, theme, _keys, done) => {
		let selected = Math.max(0, menu.initial);
		return {
			invalidate() {},
			render(width) {
				const count = Math.max(1, Math.min(menu.length, 12, tui.terminal.rows - 8));
				const start = Math.max(0, Math.min(selected - Math.floor(count / 2), menu.length - count));
				const lines = [theme.fg("accent", menu.title)];
				for (let i = start; i < Math.min(start + count, menu.length); i++) {
					const text = `${i === selected ? ">" : " "} ${menu.row(i)}`;
					lines.push(i === selected ? theme.fg("accent", text) : text);
				}
				if (menu.length > count) lines.push(theme.fg("dim", `${selected + 1}/${menu.length}`));
				if (menu.notice) lines.push(theme.fg("warning", menu.notice));
				lines.push(theme.fg("dim", menu.help));
				return lines.map((line) => truncateToWidth(line, width));
			},
			handleInput(data) {
				if (matchesKey(data, Key.up) || matchesKey(data, "k")) selected = Math.max(0, selected - 1);
				else if (matchesKey(data, Key.down) || matchesKey(data, "j")) selected = Math.max(0, Math.min(menu.length - 1, selected + 1));
				else onKey(data, selected, done);
				tui.requestRender();
			},
		};
	});
}

export function pickProfile(ctx: Context, names: string[], highlight: string | undefined, active: string | undefined) {
	return list<Selection>(ctx, {
		title: "Profile for this project",
		help: "↑/↓ move  Enter switch  e edit  a add  r rename  d delete  Esc close",
		length: names.length,
		initial: names.indexOf(highlight ?? "none"),
		row: (index) => {
			const name = names[index];
			return `${name === "none" ? "None" : name}${name === (active ?? "none") ? " (active)" : ""}`;
		},
	}, (data, index, done) => {
		const name = names[index];
		if (matchesKey(data, Key.escape)) done(undefined);
		else if (matchesKey(data, Key.enter)) done({ kind: "switch", name });
		else if (matchesKey(data, "a")) done({ kind: "add" });
		else if (name !== "none" && matchesKey(data, "e")) done({ kind: "edit", name });
		else if (name !== "none" && matchesKey(data, "r")) done({ kind: "rename", name });
		else if (name !== "none" && matchesKey(data, "d")) done({ kind: "delete", name });
	});
}

type Node = { groups: Map<string, Branch>; items: Resource[] };
type Branch = Node & { parent: Parent; descendants: Resource[]; collapsed: boolean };
type Row = { depth: number } & ({ branch: Branch } | { item: Resource });

function groupResources(resources: Resource[]): Node {
	const root: Node = { groups: new Map(), items: [] };
	for (const item of resources) {
		let node = root;
		for (const parent of item.parents) {
			let branch = node.groups.get(parent.id);
			if (!branch) {
				branch = { parent, groups: new Map(), items: [], descendants: [], collapsed: false };
				node.groups.set(parent.id, branch);
			}
			branch.descendants.push(item);
			node = branch;
		}
		node.items.push(item);
	}
	return root;
}

function visibleRows(node: Node, depth = 0): Row[] {
	const groups = [...node.groups.values()].sort((a, b) =>
		Number(Boolean(b.parent.note)) - Number(Boolean(a.parent.note)) || a.parent.label.localeCompare(b.parent.label));
	return [
		...groups.flatMap((branch): Row[] => [
			{ depth, branch },
			...(branch.collapsed ? [] : visibleRows(branch, depth + 1)),
		]),
		...node.items.map((item): Row => ({ depth, item })),
	];
}

export function editProfile(ctx: Context, name: string, resources: Resource[], saved: Filters, save: (filters: Filters) => void) {
	const disabled = Object.fromEntries(GROUPS.map((group) => [group, new Set(saved[group])])) as Record<Resource["group"], Set<string>>;
	const changed = new Set<Resource>();
	const tree = groupResources(resources);
	let rows = visibleRows(tree);
	let confirmDiscard = false;
	let saveError: string | undefined;
	const labels = { skills: "Skill", tools: "Tool", prompts: "Prompt" };
	const isDisabled = ({ group, id }: Resource) => disabled[group].has(id);
	const menu: Menu = {
		title: `Edit ${name} (checked = inherit)`,
		get help() {
			if (confirmDiscard) return "Unsaved changes. Esc again to discard, or Space to keep editing.";
			return `↑/↓ move   Space toggle   Tab fold   Ctrl+S / s save   Esc back${changed.size ? "   (unsaved)" : ""}`;
		},
		get length() { return rows.length; },
		get notice() { return saveError; },
		initial: 0,
		row: (index) => {
			const row = rows[index];
			const indent = "  ".repeat(row.depth);
			if ("item" in row) {
				const { item } = row;
				return `${indent}[${isDisabled(item) ? " " : "x"}] ${labels[item.group]}: ${item.label}`;
			}
			const { branch } = row;
			const count = branch.descendants.filter(isDisabled).length;
			const state = count === 0 ? "x" : count === branch.descendants.length ? " " : "~";
			const { label, note } = branch.parent;
			return `${indent}[${state}] ${branch.collapsed ? "▸" : "▾"} ${label}${note ? ` — ${note}` : ""}`;
		},
	};
	return list<boolean>(ctx, menu, (data, index, done) => {
		if (matchesKey(data, Key.escape)) {
			if (!changed.size || confirmDiscard) done(undefined);
			else confirmDiscard = true;
			return;
		}
		if (matchesKey(data, Key.ctrl("s")) || matchesKey(data, "s")) {
			if (!changed.size) {
				done(undefined);
				return;
			}
			const next = Object.fromEntries(GROUPS.map((group) => [group, [...disabled[group]].sort()])) as Filters;
			try {
				save(next);
				done(true);
			} catch (error) {
				saveError = error instanceof Error ? error.message : String(error);
			}
			return;
		}
		const row = rows[index];
		if (row && "branch" in row && matchesKey(data, Key.tab)) {
			row.branch.collapsed = !row.branch.collapsed;
			rows = visibleRows(tree);
			return;
		}
		if (!matchesKey(data, Key.space)) return;
		if (confirmDiscard) {
			confirmDiscard = false;
			return;
		}
		if (!row) return;
		const items = "item" in row ? [row.item] : row.branch.descendants;
		const disable = !items.some(isDisabled);
		for (const item of items) {
			if (disable) disabled[item.group].add(item.id);
			else disabled[item.group].delete(item.id);
			if (disable !== saved[item.group].includes(item.id)) changed.add(item);
			else changed.delete(item);
		}
	});
}
