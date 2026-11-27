/**
 * Prompt Snippets — mix-and-match single-purpose prompt rules.
 *
 * Snippets can come from the TypeScript prompt catalog or from Markdown
 * files with frontmatter in the `snippets/` directory next to this file.
 *
 * - Press alt+s or run /snippet (alias: /snippets) to open the toggle menu (space: toggle,
 *   tab: preview, enter: apply, esc: cancel). The menu is a bordered,
 *   scrollable view.
 * - Active snippets appear as a widget above the editor, with prepend and
 *   append groups visually distinguished.
 * - Active snippets accompany the first model request for the next user or
 *   custom submission, after Pi has expanded skills and prompt templates.
 * - Toggles reset to all-off after attachment and at session start.
 * - Snippet bodies may use ${REPO_ROOT}, which expands to this package's root
 *   directory at load time. It is derived from this file's location, so the
 *   package works wherever `pi install` places it, with no configuration.
 */

import { existsSync, mkdirSync, readFileSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { isDeepStrictEqual } from "node:util";
import type { ContextWithSystemEvent, ExtensionAPI, ExtensionContext, MessageStartEvent } from "@earendil-works/pi-coding-agent";
import { Key, matchesKey, truncateToWidth, wrapTextWithAnsi } from "@earendil-works/pi-tui";
import { composeSections, tracePromptEnabled } from "../../prompt-catalog/compose.ts";
import { isSnippetMirror } from "../../prompt-catalog/snippet-mirrors.ts";
import { snippetCatalog } from "../../prompt-catalog/snippets/catalog.ts";
import { profileFilteredTools } from "../profiles/tool-availability.ts";

interface Snippet {
	/** Filename, e.g. "concise.md" */
	id: string;
	name: string;
	description: string;
	placement: "prepend" | "append";
	order: number;
	body: string;
}

const extensionDir = dirname(fileURLToPath(import.meta.url));
const repoRoot = dirname(dirname(extensionDir));
const snippetsDir = join(extensionDir, "snippets");

/**
 * Placeholders expanded in snippet bodies at load time. REPO_ROOT points at
 * the package root (the parent of extensions/), derived from this file's own
 * path so installed packages resolve correctly no matter where pi puts them.
 */
const TOKENS: Record<string, string> = {
	REPO_ROOT: repoRoot,
};

/** Expand ${NAME} tokens; unknown tokens are left untouched. */
function expandTokens(text: string): string {
	return text.replace(/\$\{(\w+)\}/g, (raw, name: string) => TOKENS[name] ?? raw);
}
const WIDGET_ID = "prompt-snippets";

type UserSubmission = Extract<MessageStartEvent["message"], { role: "user" }>;
type CustomSubmission = Extract<MessageStartEvent["message"], { role: "custom" }>;
type Submission = { role: "user"; message: UserSubmission }
	| { role: "custom"; message: CustomSubmission; previousLeafId: string | null };

function findCustomSubmissionIndex(
	target: Extract<Submission, { role: "custom" }>,
	messages: ContextWithSystemEvent["messages"],
	sessionManager: ExtensionContext["sessionManager"],
): number {
	// Pi persists this custom message after message_start and rebuilds request
	// context from the session, assigning it the entry's timestamp, not the live one.
	const projection = sessionManager.buildSessionProjection();
	const boundary = projection.entries.findIndex(({ sourceEntry }) => sourceEntry.id === target.previousLeafId);
	if (target.previousLeafId !== null && boundary === -1) return -1;
	const entry = projection.entries.slice(boundary + 1).find(({ sourceEntry }) =>
		sourceEntry.type === "message" || sourceEntry.type === "custom_message");
	if (entry?.sourceEntry.type !== "custom_message" || entry.sourceEntry.customType !== target.message.customType
		|| !isDeepStrictEqual(entry.sourceEntry.content, target.message.content)) return -1;

	// Use the entry's projected slot so identical history is never a fallback target.
	const index = projection.messages.indexOf(entry.messages[0]);
	return index >= 0 && messages.length === projection.messages.length
		&& isDeepStrictEqual(messages[index], entry.messages[0]) ? index : -1;
}

function parseSnippet(filename: string, raw: string): Snippet | null {
	const match = raw.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/);
	if (!match) return null;

	const meta: Record<string, string> = {};
	for (const line of match[1].split(/\r?\n/)) {
		const kv = line.match(/^([A-Za-z][\w-]*)\s*:\s*(.*)$/);
		if (kv) meta[kv[1].toLowerCase()] = kv[2].trim().replace(/^["']|["']$/g, "");
	}

	const body = expandTokens(match[2].trim());
	if (!body) return null;

	const parsedOrder = Number.parseInt(meta.order ?? "", 10);
	return {
		id: filename,
		name: meta.name || filename.replace(/\.md$/i, ""),
		description: meta.description ?? "",
		placement: meta.placement === "prepend" ? "prepend" : "append",
		order: Number.isFinite(parsedOrder) ? parsedOrder : 9999,
		body,
	};
}

/** Load all snippets, sorted: prepend group first, append group last, each by (order, name). */
function loadSnippets(includeTrace: boolean): Snippet[] {
	const snippets: Snippet[] = snippetCatalog.map(({ sections, ...metadata }) => ({
		...metadata,
		body: expandTokens(composeSections(sections, includeTrace).trim()),
	}));
	const catalogIds = new Set(snippets.map((snippet) => snippet.id));
	const files = existsSync(snippetsDir) ? readdirSync(snippetsDir) : [];
	for (const file of files) {
		// Generated Markdown mirrors are for references and inspection, not delivery.
		if (catalogIds.has(file) || !file.toLowerCase().endsWith(".md")) continue;
		try {
			const raw = readFileSync(join(snippetsDir, file), "utf8");
			// A renamed or removed catalog entry can leave an owned mirror behind.
			if (isSnippetMirror(raw)) continue;
			const snippet = parseSnippet(file, raw);
			if (snippet) snippets.push(snippet);
		} catch {
			// Skip unreadable files
		}
	}
	const byOrder = (a: Snippet, b: Snippet) => a.order - b.order || a.name.localeCompare(b.name);
	return [
		...snippets.filter((s) => s.placement === "prepend").sort(byOrder),
		...snippets.filter((s) => s.placement === "append").sort(byOrder),
	];
}

export default function (pi: ExtensionAPI) {
	// Available snippets (sorted). Refreshed whenever the menu opens or a message is sent.
	let snippets: Snippet[] = [];
	// IDs of snippets queued for the next submission, not bound to any command or loop.
	let enabled = new Set<string>();
	let submission: Submission | undefined;

	function refreshSnippets() {
		snippets = loadSnippets(tracePromptEnabled(profileFilteredTools(pi, pi.getActiveTools())));
	}

	function updateWidget(ctx: ExtensionContext) {
		if (!ctx.hasUI || ctx.mode !== "tui") return;
		const active = snippets.filter((s) => enabled.has(s.id));
		const prepends = active.filter((s) => s.placement === "prepend");
		const appends = active.filter((s) => s.placement === "append");

		if (prepends.length === 0 && appends.length === 0) {
			ctx.ui.setWidget(WIDGET_ID, undefined);
			return;
		}

		const theme = ctx.ui.theme;
		const lines: string[] = [];
		if (prepends.length > 0) {
			lines.push(theme.fg("accent", `↑ prepend: ${prepends.map((s) => s.name).join(" · ")}`));
		}
		if (appends.length > 0) {
			lines.push(theme.fg("warning", `↓ append: ${appends.map((s) => s.name).join(" · ")}`));
		}
		ctx.ui.setWidget(WIDGET_ID, lines);
	}

	function output(ctx: ExtensionContext, text: string) {
		if (ctx.hasUI) ctx.ui.notify(text, "info");
		else process.stderr.write(text + "\n");
	}

	const usage = "Usage: /snippet [list | <code> ...] (alias: /snippets). Codes: p<order> = prepend, a<order> = append; e.g. /snippet p70 a30. Enables snippets for the next prompt.";
	const snippetCode = (snippet: Snippet) => `${snippet.placement === "prepend" ? "p" : "a"}${snippet.order}`;

	function printList(ctx: ExtensionContext) {
		output(ctx, snippets.length === 0
			? `No snippets found in ${snippetsDir}`
			: snippets.map((s) => `${snippetCode(s)} ${s.name} — ${s.description} [${enabled.has(s.id) ? "enabled" : "disabled"}]`).join("\n"));
	}

	async function openMenu(ctx: ExtensionContext) {
		if (!ctx.hasUI || ctx.mode !== "tui") {
			refreshSnippets();
			output(ctx, usage);
			printList(ctx);
			return;
		}

		refreshSnippets();
		// Drop toggles for snippets that no longer exist on disk.
		enabled = new Set([...enabled].filter((id) => snippets.some((s) => s.id === id)));

		if (snippets.length === 0) {
			ctx.ui.notify(`No snippets found in ${snippetsDir}`, "warning");
			updateWidget(ctx);
			return;
		}

		// Working copy; only committed to `enabled` on confirm.
		const working = new Set(enabled);

		const confirmed = await ctx.ui.custom<boolean>((tui, theme, _keybindings, done) => {
			const prepends = snippets.filter((s) => s.placement === "prepend");
			const appends = snippets.filter((s) => s.placement === "append");
			const items = [...prepends, ...appends];

			let mode: "list" | "preview" = "list";
			let cursor = 0;
			let listScroll = 0;
			let previewScroll = 0;

			const itemRow = (snippet: Snippet, idx: number, width: number): string => {
				const pointer = idx === cursor ? theme.fg("accent", "> ") : "  ";
				const checkbox = working.has(snippet.id) ? theme.fg("success", "[x]") : theme.fg("dim", "[ ]");
				const desc = snippet.description ? theme.fg("dim", ` — ${snippet.description}`) : "";
				return truncateToWidth(`${pointer}${checkbox} ${theme.bold(snippet.name)}${desc}`, width);
			};

			/** List rows with the item index each row corresponds to (null for headers/blanks). */
			const buildListRows = (width: number): { text: string; itemIndex: number | null }[] => {
				const rows: { text: string; itemIndex: number | null }[] = [];
				rows.push({ text: theme.fg("dim", "↑ PREPEND — added before your message"), itemIndex: null });
				prepends.forEach((s, i) => rows.push({ text: itemRow(s, i, width), itemIndex: i }));
				rows.push({ text: "", itemIndex: null });
				rows.push({ text: theme.fg("dim", "↓ APPEND — added after your message"), itemIndex: null });
				appends.forEach((s, i) => rows.push({ text: itemRow(s, prepends.length + i, width), itemIndex: prepends.length + i }));
				return rows;
			};

			const buildPreviewRows = (snippet: Snippet, width: number): string[] => {
				const rows: string[] = [];
				rows.push(truncateToWidth(theme.bold(snippet.name), width));
				rows.push(truncateToWidth(theme.fg("dim", `${snippet.placement} · order ${snippet.order} · ${snippet.id}`), width));
				rows.push(theme.fg("dim", "─".repeat(Math.min(width, 40))));
				for (const line of snippet.body.split("\n")) {
					for (const wrapped of wrapTextWithAnsi(line, width)) {
						rows.push(truncateToWidth(wrapped, width));
					}
				}
				return rows;
			};

			/**
			 * Slice `lines` to a scrollable viewport of at most `maxView` lines,
			 * reserving indicator slots when clipped. Returns the visible lines
			 * plus the clamped scroll position. When `focusRow` is given, scrolls
			 * so it stays visible.
			 */
			const viewport = (
				lines: string[],
				scroll: number,
				maxView: number,
				focusRow?: number,
			): { out: string[]; scroll: number } => {
				const clipped = lines.length > maxView;
				const view = clipped ? Math.max(1, maxView - 2) : maxView;

				let s = Math.min(Math.max(0, scroll), Math.max(0, lines.length - view));
				if (focusRow !== undefined) {
					if (focusRow < s) s = focusRow;
					else if (focusRow >= s + view) s = focusRow - view + 1;
				}

				const visible = lines.slice(s, s + view);
				if (!clipped) return { out: visible, scroll: s };

				const above = s;
				const below = lines.length - (s + view);
				return {
					out: [
						above > 0 ? theme.fg("dim", `  ↑ ${above} more`) : "",
						...visible,
						below > 0 ? theme.fg("dim", `  ↓ ${below} more`) : "",
					],
					scroll: s,
				};
			};

			return {
				render(width: number): string[] {
					// Reserve lines for: top border, title, blank, blank, hints, bottom border.
					const maxView = Math.max(5, tui.terminal.rows - 10);

					let content: string[];
					let title: string;
					let hints: string;
					if (mode === "list") {
						const rows = buildListRows(width);
						const cursorRow = rows.findIndex((r) => r.itemIndex === cursor);
						const v = viewport(rows.map((r) => r.text), listScroll, maxView, cursorRow);
						content = v.out;
						listScroll = v.scroll;
						title = "Prompt snippets";
						hints = "↑↓ navigate • Space toggle • Tab preview • Enter apply • Esc cancel";
					} else {
						const snippet = items[cursor];
						const rows = buildPreviewRows(snippet, width);
						const v = viewport(rows, previewScroll, maxView);
						content = v.out;
						previewScroll = v.scroll;
						title = `Preview: ${snippet.name}`;
						hints = "↑↓ scroll • Tab/Esc back";
					}

					return [
						theme.fg("accent", "─".repeat(width)),
						truncateToWidth(` ${theme.fg("accent", theme.bold(title))}`, width),
						"",
						...content,
						"",
						truncateToWidth(theme.fg("dim", ` ${hints}`), width),
						theme.fg("accent", "─".repeat(width)),
					];
				},
				invalidate() {},
				handleInput(data: string) {
					if (mode === "list") {
						if (matchesKey(data, Key.up)) {
							cursor = (cursor - 1 + items.length) % items.length;
							tui.requestRender();
						} else if (matchesKey(data, Key.down)) {
							cursor = (cursor + 1) % items.length;
							tui.requestRender();
						} else if (matchesKey(data, Key.space)) {
							const id = items[cursor].id;
							if (working.has(id)) working.delete(id);
							else working.add(id);
							tui.requestRender();
						} else if (matchesKey(data, Key.tab)) {
							mode = "preview";
							previewScroll = 0;
							tui.requestRender();
						} else if (matchesKey(data, Key.enter)) {
							done(true);
						} else if (matchesKey(data, Key.escape)) {
							done(false);
						}
					} else {
						if (matchesKey(data, Key.up)) {
							previewScroll--;
							tui.requestRender();
						} else if (matchesKey(data, Key.down)) {
							previewScroll++;
							tui.requestRender();
						} else if (matchesKey(data, Key.tab) || matchesKey(data, Key.escape)) {
							mode = "list";
							tui.requestRender();
						}
					}
				},
			};
		});

		if (confirmed) {
			enabled = working;
		}
		updateWidget(ctx);
	}

	pi.on("session_start", (_event, ctx) => {
		enabled = new Set();
		submission = undefined;
		refreshSnippets();
		if (!existsSync(snippetsDir)) mkdirSync(snippetsDir, { recursive: true });
		updateWidget(ctx);
	});

	pi.on("message_start", ({ message }, ctx) => {
		// Pi emits this for both idle starts and delivered steering/follow-up messages.
		// Commands that only append custom history do not emit this extension event.
		if (enabled.size === 0 || submission) return;
		if (message.role === "user") submission = { role: "user", message };
		else if (message.role === "custom") {
			submission = { role: "custom", message, previousLeafId: ctx.sessionManager.getLeafId() };
		}
	});

	pi.on("agent_settled", () => {
		// An abort can settle the run before the recorded message reaches a request.
		submission = undefined;
	});

	pi.on("context_with_system", (event, ctx) => {
		const target = submission;
		submission = undefined;
		if (!target) return;

		// Look in the new batch for user submissions; replayed custom history may
		// also be in this suffix, so custom submissions use a session-entry boundary.
		const lastAssistant = event.messages.findLastIndex((message) => message.role === "assistant");
		const index = target.role === "custom"
			? findCustomSubmissionIndex(target, event.messages, ctx.sessionManager)
			: event.messages.findIndex((message, i) => i > lastAssistant && message.role === "user"
				&& message.timestamp === target.message.timestamp && isDeepStrictEqual(message.content, target.message.content));
		if (index <= lastAssistant) return;
		const message = event.messages[index];
		if (message?.role !== "user" && message?.role !== "custom") return;

		refreshSnippets();
		const active = snippets.filter((s) => enabled.has(s.id));
		if (active.length > 0 && message.role === "user") {
			const prependBodies = active.filter((s) => s.placement === "prepend").map((s) => s.body);
			const appendBodies = active.filter((s) => s.placement === "append").map((s) => s.body);
			const [first, ...rest] = message.content;
			const inquiry = `<user_inquiry>\n${first?.type === "text" ? first.text : ""}\n</user_inquiry>`;
			const text = [...prependBodies, inquiry, ...appendBodies].join("\n\n");
			event.messages[index] = { ...message, content: [{ type: "text", text }, ...(first?.type === "text" ? rest : message.content)] };
		} else if (active.length > 0 && message.role === "custom") {
			const text = `<prompt_snippets>\n${active.map((s) => s.body).join("\n\n")}\n</prompt_snippets>`;
			const content = typeof message.content === "string" ? [{ type: "text" as const, text: message.content }] : message.content;
			event.messages[index] = { ...message, content: [{ type: "text", text }, ...content] };
		}

		enabled.clear();
		updateWidget(ctx);
		if (active.length > 0) return { messages: event.messages };
	});

	pi.registerShortcut("alt+s", {
		description: "Toggle prompt snippets",
		handler: async (ctx) => {
			await openMenu(ctx);
		},
	});

	async function handleCommand(args: string, ctx: ExtensionContext) {
		const argument = args.trim();
		if (!argument) {
			await openMenu(ctx);
			return;
		}

		refreshSnippets();
		if (argument === "list" || argument === "ls" ) {
			printList(ctx);
			return;
		}

		const codes = argument.split(/\s+/);
		if (codes.some((code) => !/^([pa])(\d+)$/i.test(code))) {
			output(ctx, usage);
			return;
		}

		const selected = new Set<string>();
		const errors: string[] = [];
		for (const code of codes) {
			const placement = code[0].toLowerCase() === "p" ? "prepend" : "append";
			const order = Number(code.slice(1));
			const matches = snippets.filter((s) => s.placement === placement && s.order === order);
			if (matches.length === 0) errors.push(`Unknown snippet code: ${code}`);
			else if (matches.length > 1) errors.push(`Ambiguous snippet code: ${code} (${matches.map((s) => s.name).join(", ")})`);
			else selected.add(matches[0].id);
		}

		// Resolve every code before changing selection; invalid batches leave it untouched.
		if (errors.length > 0) {
			output(ctx, errors.join("\n"));
			printList(ctx);
			return;
		}

		for (const id of selected) enabled.add(id);
		updateWidget(ctx);
		output(ctx, `Enabled for the next prompt: ${snippets.filter((s) => selected.has(s.id)).map((s) => `${snippetCode(s)} ${s.name}`).join(", ")}`);
	}

	for (const command of ["snippet", "snippets"]) {
		pi.registerCommand(command, {
			description: "List or enable prompt snippets: /snippet [list | p<order> a<order> ...]",
			handler: handleCommand,
		});
	}
}
