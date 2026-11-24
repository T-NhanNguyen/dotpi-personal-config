import assert from "node:assert/strict";
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, join, relative, resolve } from "node:path";
import { pathToFileURL } from "node:url";

const sdkEntry = process.argv[2];
if (!sdkEntry) throw new Error("Pass the installed Pi SDK's dist/index.js path.");
const repo = new URL("../../../", import.meta.url);
const tmp = realpathSync(mkdtempSync(join(tmpdir(), "pi-profile-test-")));
const agentDir = join(tmp, "agent");
process.env.PI_CODING_AGENT_DIR = agentDir;
process.env.HOME = tmp;
process.env.USERPROFILE = tmp;
const opened = [];

try {
	const { createAgentSession, SettingsManager, SessionManager } = await import(pathToFileURL(resolve(sdkEntry)).href);
	const pkg = join(tmp, "config-package");
	const cwd = join(tmp, "project");
	const projectPi = join(cwd, ".pi");
	const path = join(projectPi, "settings.json");
	const extra = join(tmp, "extra-package");
	const profilePath = (name) => join(pkg, "profiles", name);
	const writeJson = (file, value) => writeFileSync(file, JSON.stringify(value, null, 2));
	const readJson = (file) => JSON.parse(readFileSync(file, "utf8"));
	const keep = { source: relative(projectPi, extra), extensions: [] };
	const initial = { packages: [keep], quietStartup: true };
	mkdirSync(join(pkg, "extensions", "profiles"), { recursive: true });
	mkdirSync(projectPi, { recursive: true });
	mkdirSync(agentDir);
	mkdirSync(extra);
	cpSync(new URL("package.json", repo), join(pkg, "package.json"));
	for (const file of ["index.ts", "editor.ts", "storage.ts", "provenance.ts"]) {
		cpSync(new URL(`extensions/profiles/${file}`, repo), join(pkg, "extensions", "profiles", file));
	}
	cpSync(new URL("profiles", repo), join(pkg, "profiles"), {
		recursive: true,
		filter: (source) => basename(source) !== "filters.json",
	});
	for (const name of ["webdev", "embedded"]) {
		const prompts = join(profilePath(name), "prompts");
		mkdirSync(prompts, { recursive: true });
		writeFileSync(join(prompts, `${name}-test.md`), "Test-only profile prompt.\n");
	}
	writeJson(join(extra, "package.json"), { name: "extra-package", version: "1.0.0", private: true });
	writeJson(join(agentDir, "settings.json"), { packages: [pkg] });
	writeJson(path, initial);

	async function open({ label, trusted = true, history = false, waitForIdle = async () => {}, custom, input, select, reload }) {
		const settingsManager = SettingsManager.create(cwd, agentDir);
		settingsManager.setProjectTrusted(trusted);
		const sessionManager = SessionManager.inMemory(cwd);
		if (history) sessionManager.appendMessage({ role: "user", content: "Earlier message", timestamp: 1 });
		const { session } = await createAgentSession({ cwd, agentDir, settingsManager, sessionManager });
		opened.push(session);
		const notifications = [];
		const controls = [];
		const statuses = new Map();
		globalThis.pichamber = label === "cli" ? undefined : { async control(_ctx, control) { controls.push(control); } };
		await session.bindExtensions({
			mode: custom ? "tui" : "rpc",
			uiContext: {
				custom, input, select,
				notify(text, level) { notifications.push({ text, level }); },
				setStatus(key, value) { statuses.set(key, value); },
				theme: { fg(color, text) { assert.equal(color, "dim"); return text; } },
			},
			commandContextActions: { reload: reload ?? (() => session.reload()), waitForIdle },
			onError(event) { assert.fail(`${label}: ${JSON.stringify(event)}`); },
		});
		return { session, sessionManager, controls, notifications, statuses };
	}

	function expectResources({ session }, profile) {
		const tools = new Set(session.getAllTools().map(({ name }) => name));
		const activeTools = new Set(session.getActiveToolNames());
		const prompts = new Set(session.promptTemplates.map(({ name }) => name));
		const skills = new Set(session.resourceLoader.getSkills().skills.map(({ name }) => name));
		for (const [name, tool, skill, prompt] of [
			["webdev", "http_check", "web-accessibility", "webdev-test"],
			["embedded", "serial_ports", "embedded-c", "embedded-test"],
		]) {
			assert.equal(tools.has(tool), name === profile, tool);
			assert.equal(activeTools.has(tool), name === profile, `active ${tool}`);
			assert.equal(skills.has(skill), name === profile, skill);
			assert.equal(prompts.has(prompt), name === profile, prompt);
		}
	}

	const untrusted = await open({ label: "untrusted", trusted: false });
	assert.deepEqual(untrusted.controls.at(-1), { id: "profile", remove: true });
	await untrusted.session.prompt("/profile webdev");
	assert.match(untrusted.notifications.at(-1).text, /Trust this project/);
	assert.deepEqual(readJson(path), initial);

	let releaseIdle;
	let enteredIdle;
	const reachedIdle = new Promise((resolve) => { enteredIdle = resolve; });
	const idleGate = new Promise((resolve) => { releaseIdle = resolve; });
	const primary = await open({ label: "primary", history: true, waitForIdle: () => { enteredIdle(); return idleGate; } });
	const initialId = primary.session.sessionId;
	const initialHistory = primary.sessionManager.getBranch();
	expectResources(primary, "none");
	assert.equal(primary.controls.at(-1).value, "none");
	assert.deepEqual(primary.controls.at(-1).options.map(({ command }) => command), ["profile none", "profile embedded", "profile webdev"]);
	const switching = primary.session.prompt("/profile webdev");
	await Promise.race([reachedIdle, switching.then(() => assert.fail("did not wait for idle"))]);
	assert.deepEqual(readJson(path), initial);
	releaseIdle();
	await switching;
	assert.deepEqual(readJson(path), { ...initial, packages: [keep, profilePath("webdev")] });
	assert.equal(primary.controls.at(-1).value, "webdev");
	expectResources(primary, "webdev");
	assert.equal(primary.session.sessionId, initialId);
	assert.deepEqual(primary.sessionManager.getBranch(), initialHistory);

	const overridden = { ...initial, packages: [
		{ source: relative(projectPi, profilePath("webdev")), extensions: [], prompts: ["-prompts/other.md"] },
		keep,
	] };
	writeJson(path, overridden);
	await primary.session.prompt("/profile webdev");
	assert.deepEqual(readJson(path), overridden, "Reapply must preserve the package entry and its position");
	assert.equal(primary.session.getAllTools().some(({ name }) => name === "http_check"), false);
	assert.equal(primary.session.promptTemplates.some(({ name }) => name === "webdev-test"), true);
	writeJson(path, { ...initial, packages: [keep, profilePath("webdev")] });
	await primary.session.prompt("/profile webdev");

	const secondary = await open({ label: "cli" });
	expectResources(secondary, "webdev");
	// A project settings editor may store a local package as an object with a relative source.
	writeJson(path, { ...initial, packages: [keep, { source: relative(projectPi, profilePath("webdev")) }] });
	await secondary.session.prompt("/profile embedded");
	assert.deepEqual(readJson(path), { ...initial, packages: [keep, profilePath("embedded")] });
	expectResources(secondary, "embedded");
	expectResources(primary, "webdev");
	await primary.session.extensionRunner.emit({ type: "before_agent_start", prompt: "next turn", systemPrompt: "" });
	assert.match(primary.notifications.at(-1).text, /still runs webdev.*\/profile embedded/);
	globalThis.pichamber = { async control(_ctx, control) { primary.controls.push(control); } };
	await primary.session.prompt("/profile embedded");
	expectResources(primary, "embedded");
	assert.equal(primary.controls.at(-1).value, "embedded");
	await primary.session.prompt("/profile none");
	assert.deepEqual(readJson(path), initial);
	expectResources(primary, "none");
	assert.equal(primary.controls.at(-1).value, "none");

	await primary.session.prompt("/profile unknown");
	assert.deepEqual(readJson(path), initial);
	assert.match(primary.notifications.at(-1).text, /No profile named/);

	for (const raw of ["{ broken", "[]", '{"packages":"not an array"}']) {
		writeFileSync(path, raw);
		await primary.session.prompt("/profile webdev");
		assert.equal(readFileSync(path, "utf8"), raw);
		assert.match(primary.notifications.at(-1).text, /Profile not changed/);
	}
	writeJson(path, initial);
	const looseSkill = join(agentDir, "skills", "local-example");
	mkdirSync(looseSkill, { recursive: true });
	writeFileSync(join(looseSkill, "SKILL.md"), "---\nname: local-example\ndescription: A loose skill\n---\nInstructions.\n");
	mkdirSync(join(agentDir, "prompts"));
	writeFileSync(join(agentDir, "prompts", "local-example.md"), "A loose prompt.\n");
	const inherited = join(tmp, "inherited-package");
	mkdirSync(join(inherited, "skills", "inherited-skill"), { recursive: true });
	mkdirSync(join(inherited, "prompts"));
	writeJson(join(inherited, "package.json"), { name: "inherited-package", private: true });
	writeFileSync(join(inherited, "skills", "inherited-skill", "SKILL.md"), "---\nname: inherited-skill\ndescription: A packaged global skill\n---\nInstructions.\n");
	writeFileSync(join(inherited, "prompts", "inherited-prompt.md"), "An inherited prompt.\n");
	mkdirSync(join(agentDir, "extensions"));
	const provider = (names) => `export default function (pi) { for (const name of ${JSON.stringify(names)}) pi.registerTool({ name, label: name, description: name, parameters: { type: 'object' }, async execute() { return { content: [], details: {} }; } }); }`;
	writeFileSync(join(agentDir, "extensions", "tools.ts"), provider(["test_first", "test_sibling"]));
	writeFileSync(join(agentDir, "extensions", "disabled.ts"), provider(["test_disabled_extension"]));
	const globalSettings = { packages: [pkg, inherited], extensions: ["-extensions/disabled.ts"] };
	writeJson(join(agentDir, "settings.json"), globalSettings);
	const filtersPath = join(profilePath("webdev"), "filters.json");
	const ui = [];
	const custom = async (factory) => await new Promise((resolve) => {
		const view = factory({ terminal: { rows: 40 }, requestRender() {} }, { fg: (_color, text) => text }, {}, resolve);
		const script = ui.shift();
		assert.ok(script, "Unexpected terminal dialog");
		script(view);
	});
	const failure = await open({ label: "cli", reload: async () => { throw new Error("fixture reload failure"); } });
	await failure.session.prompt("/profile embedded");
	assert.deepEqual(readJson(path), { ...initial, packages: [keep, profilePath("embedded")] });
	assert.match(failure.notifications.at(-1).text, /embedded is saved.*Reopen it.*fixture reload failure/);
	assert.equal(failure.notifications.at(-1).level, "error");
	writeJson(path, initial);

	const inputs = [];
	const selections = [];
	const terminal = await open({
		label: "cli", custom,
		async input(title) {
			const next = inputs.shift();
			assert.ok(next, `Unexpected input: ${title}`);
			assert.equal(title, next[0]);
			return next[1];
		},
		async select(title, options) {
			const next = selections.shift();
			assert.ok(next, `Unexpected select: ${title}`);
			assert.match(title, next[0]);
			assert.equal(options[0], "Cancel");
			assert.ok(options.includes(next[1]));
			return next[1];
		},
	});
	assert.equal(terminal.statuses.get("project-profile"), "Profile: None");
	await terminal.session.prompt("/profile webdev");
	assert.equal(terminal.statuses.get("project-profile"), "Profile: webdev");
	const otherSession = await open({ label: "cli" });
	await otherSession.session.prompt("/profile embedded");
	assert.deepEqual(readJson(path), { ...initial, packages: [keep, profilePath("embedded")] });
	assert.equal(terminal.statuses.get("project-profile"), "Profile: webdev");
	await terminal.session.prompt("/profile webdev");
	const beforeEdit = readJson(path);
	ui.push(
		(view) => { assert.match(view.render(90).join("\n"), /webdev \(active\)/); view.handleInput("e"); },
		(view) => {
			const targets = new Set(["Skill: inherited-skill", "Skill: local-example", "Tool: read", "Prompt: /inherited-prompt", "Prompt: /local-example"]);
			const screen = () => view.render(130).join("\n");
			const selected = () => view.render(130).find((row) => row.startsWith(">"));
			const down = () => view.handleInput("\x1b[B");
			assert.match(screen(), /Pi built-ins — Core harness tools; usually leave on/);
			let sawPackage = false;
			let sawExtension = false;
			for (let i = 0; i < 45 && (targets.size || !sawPackage || !sawExtension); i++) {
				const row = selected();
				if (row?.includes("▾ webdev (project package)")) {
					sawPackage = true;
					view.handleInput("\t");
					assert.match(selected(), /▸ webdev/);
					assert.doesNotMatch(screen(), /Skill: web-accessibility/);
					view.handleInput(" "); // A folded group still toggles all children.
					assert.match(selected(), /\[ \] ▸ webdev/);
					view.handleInput(" ");
					assert.match(selected(), /\[x\] ▸ webdev/);
					view.handleInput(" ");
					view.handleInput("\t");
					down();
					assert.match(selected(), /\[ \].*extensions[/\\]http-check\.ts \(extension\)/);
					view.handleInput(" "); // Keep the tool, but not the skill or prompt.
					assert.match(screen(), /\[~\] ▾ webdev \(project package\)/);
				} else if (row?.includes("▾ tools (extension)")) {
					sawExtension = true;
					view.handleInput(" ");
					down();
					assert.match(selected(), /\[ \] Tool: test_first/);
					down();
					assert.match(selected(), /\[ \] Tool: test_sibling/);
					view.handleInput(" ");
					assert.match(screen(), /\[~\] ▾ tools \(extension\)/);
				} else if (targets.delete(row?.replace(/^>\s+\[x\] /, ""))) {
					view.handleInput(" ");
				}
				down();
			}
			assert.equal(targets.size, 0, `missing: ${[...targets]}`);
			assert.ok(sawPackage && sawExtension, "Expected package and extension groups");
			view.handleInput("\x13"); // Ctrl+S
		},
		(view) => view.handleInput("\x1b"),
	);
	await terminal.session.prompt("/profile");
	assert.equal(ui.length, 0);
	assert.deepEqual(readJson(path), beforeEdit, "Save must not switch or reload");
	assert.equal(terminal.session.getActiveToolNames().includes("read"), true);
	const saved = readJson(filtersPath);
	assert.deepEqual(saved.tools, ["read", "test_first"]);
	assert.ok(saved.skills.includes("./webdev/skills/web-accessibility/SKILL.md"));
	assert.ok(saved.prompts.includes("./webdev/prompts/webdev-test.md"));

	const masks = join(agentDir, "profile-masks");
	const rejected = await open({ label: "cli", waitForIdle: async () => { throw new Error("fixture idle failure"); } });
	await rejected.session.prompt("/profile webdev");
	assert.match(rejected.notifications.at(-1).text, /Profile not changed: .*fixture idle failure/);
	assert.equal(existsSync(masks), false);
	assert.deepEqual(readJson(path), beforeEdit);

	const competingSettings = { ...beforeEdit, quietStartup: false };
	const conflict = await open({ label: "cli", waitForIdle: async () => { writeJson(path, competingSettings); } });
	await conflict.session.prompt("/profile webdev");
	assert.match(conflict.notifications.at(-1).text, /Project settings changed while switching/);
	assert.equal(existsSync(masks), false);
	assert.deepEqual(readJson(path), competingSettings);
	writeJson(path, beforeEdit);

	ui.push(
		(view) => view.handleInput("e"),
		(view) => {
			view.handleInput(" ");
			view.handleInput("\x1b");
			assert.match(view.render(90).join("\n"), /Unsaved changes/);
			view.handleInput("\x1b");
		},
		(view) => view.handleInput("\x1b"),
	);
	await terminal.session.prompt("/profile");
	assert.deepEqual(readJson(filtersPath), saved);

	const otherSave = { ...saved, tools: [...saved.tools, "other-session-tool"] };
	const lock = join(pkg, "profiles", ".profiles.lock");
	ui.push(
		(view) => view.handleInput("e"),
		(view) => {
			view.handleInput(" ");
			mkdirSync(lock); // Simulate another process holding the save lock.
			view.handleInput("s");
			assert.match(view.render(100).join("\n"), /Profile save is locked/);
			assert.deepEqual(readJson(filtersPath), saved);
			rmSync(lock, { recursive: true });
			writeJson(filtersPath, otherSave); // Another editor saves after this one opened.
			view.handleInput("\x13");
			const screen = view.render(100).join("\n");
			assert.match(screen, /Filters changed on disk/);
			assert.match(screen, /\(unsaved\)/);
			assert.deepEqual(readJson(filtersPath), otherSave);
			assert.equal(existsSync(lock), false);
			view.handleInput("\x1b");
			assert.match(view.render(100).join("\n"), /Unsaved changes/);
			view.handleInput("\x1b");
		},
		(view) => view.handleInput("\x1b"),
	);
	await terminal.session.prompt("/profile");
	assert.deepEqual(readJson(filtersPath), otherSave);
	writeJson(filtersPath, saved);

	ui.push((view) => view.handleInput("\r")); // Enter reapplies the highlighted profile.
	await terminal.session.prompt("/profile");
	assert.equal(terminal.session.getActiveToolNames().includes("read"), false);
	assert.equal(terminal.session.getActiveToolNames().includes("http_check"), true);
	assert.equal(terminal.session.getActiveToolNames().includes("test_first"), false);
	assert.equal(terminal.session.getActiveToolNames().includes("test_sibling"), true);
	assert.equal(terminal.session.getAllTools().some(({ name }) => name === "test_disabled_extension"), false);
	assert.deepEqual(terminal.session.resourceLoader.getSkills().skills.map(({ name }) => name), []);
	assert.deepEqual(terminal.session.promptTemplates.map(({ name }) => name), []);
	const reopened = await open({ label: "cli" });
	assert.equal(reopened.session.getActiveToolNames().includes("read"), false);
	assert.equal(reopened.session.getActiveToolNames().includes("http_check"), true);
	ui.push(
		(view) => view.handleInput("e"),
		(view) => {
			for (let i = 0; i < 30; i++) {
				if (view.render(90).some((row) => /^>\s+\[ \] Tool: read$/.test(row))) {
					view.handleInput(" ");
					view.handleInput("s");
					return;
				}
				view.handleInput("j");
			}
			assert.fail("Filtered tool should remain editable");
		},
		(view) => view.handleInput("\r"),
	);
	await terminal.session.prompt("/profile");
	assert.deepEqual(readJson(filtersPath).tools, ["test_first"]);
	assert.equal(terminal.session.getActiveToolNames().includes("read"), true);
	assert.equal(terminal.session.getActiveToolNames().includes("test_first"), false);
	assert.equal(reopened.session.getActiveToolNames().includes("read"), false, "Other sessions keep their snapshot");
	await terminal.session.prompt("/profile none");
	assert.equal(terminal.statuses.get("project-profile"), "Profile: None");
	assert.deepEqual(readJson(path), initial);
	assert.equal(terminal.session.getActiveToolNames().includes("read"), true);
	assert.equal(terminal.session.getActiveToolNames().includes("http_check"), false);
	assert.equal(terminal.session.getActiveToolNames().includes("test_first"), true);
	assert.deepEqual(terminal.session.resourceLoader.getSkills().skills.map(({ name }) => name).sort(), ["inherited-skill", "local-example"]);
	assert.deepEqual(terminal.session.promptTemplates.map(({ name }) => name).sort(), ["inherited-prompt", "local-example"]);
	assert.deepEqual(readJson(join(agentDir, "settings.json")), globalSettings);

	function hotkeyFor(name, key) {
		return (view) => {
			for (let i = 0; i < 10; i++) {
				const selected = view.render(110).find((line) => line.startsWith("> "));
				if (selected?.slice(2).replace(/ \(active\)$/, "") === name) {
					view.handleInput(key);
					return;
				}
				view.handleInput("j");
			}
			assert.fail(`Could not highlight ${name}`);
		};
	}

	inputs.push(["New profile name", undefined], ["New profile name", "../escape"], ["New profile name", "scratch"], ["New profile name", "scratch"]);
	ui.push(
		hotkeyFor("None", "a"),
		hotkeyFor("None", "a"),
		hotkeyFor("None", "a"),
		hotkeyFor("scratch", "a"),
		(view) => {
			assert.deepEqual(readJson(path), initial, "Creating must not select the profile");
			const manifest = readJson(join(profilePath("scratch"), "package.json"));
			assert.equal(manifest.name, "profile-scratch");
			assert.equal(manifest.private, true);
			assert.equal(existsSync(join(pkg, "escape")), false);
			hotkeyFor("scratch", "\r")(view);
		},
	);
	await terminal.session.prompt("/profile");
	assert.equal(inputs.length, 0);
	assert.deepEqual(readJson(path).packages, [keep, profilePath("scratch")]);
	assert.deepEqual(terminal.session.resourceLoader.getExtensions().errors, [], "An empty profile isn't an extension entrypoint");
	assert.ok(terminal.notifications.some(({ text }) => /already in use/.test(text)));

	ui.push(hotkeyFor("scratch", "r"), hotkeyFor("scratch", "d"), (view) => view.handleInput("\x1b"));
	await terminal.session.prompt("/profile");
	assert.equal(terminal.notifications.at(-1).text, "Switch to None or another profile first.");
	assert.equal(existsSync(profilePath("scratch")), true);
	await terminal.session.prompt("/profile none");

	const ownPrompt = join(profilePath("scratch"), "prompts", "notes.md");
	mkdirSync(join(profilePath("scratch"), "prompts"));
	writeFileSync(ownPrompt, "Keep all the profile's files on rename.\n");
	writeJson(join(profilePath("scratch"), "filters.json"), { skills: [], tools: ["bash"], prompts: ["./scratch/prompts/notes.md"] });
	inputs.push(["Rename scratch", "webdev"], ["Rename scratch", "renamed"]);
	ui.push(hotkeyFor("scratch", "r"), hotkeyFor("scratch", "r"), (view) => {
		assert.match(view.render(110).join("\n"), /^> renamed$/m);
		view.handleInput("\x1b");
	});
	await terminal.session.prompt("/profile");
	assert.equal(inputs.length, 0);
	assert.equal(existsSync(profilePath("scratch")), false);
	assert.equal(readFileSync(join(profilePath("renamed"), "prompts", "notes.md"), "utf8"), "Keep all the profile's files on rename.\n");
	assert.deepEqual(readJson(join(profilePath("renamed"), "filters.json")), { skills: [], tools: ["bash"], prompts: ["./renamed/prompts/notes.md"] });

	selections.push([/Permanently delete renamed/, "Cancel"], [/Permanently delete renamed/, "Delete renamed"]);
	ui.push(hotkeyFor("renamed", "d"), hotkeyFor("renamed", "d"), (view) => {
		assert.doesNotMatch(view.render(110).join("\n"), /renamed/);
		view.handleInput("\x1b");
	});
	await terminal.session.prompt("/profile");
	assert.equal(selections.length, 0);
	assert.equal(existsSync(profilePath("renamed")), false);
	assert.ok(existsSync(profilePath("embedded")) && existsSync(profilePath("webdev")));
	assert.deepEqual(readJson(path), initial);
	assert.equal(existsSync(lock), false);
	console.log("Profile integration checks passed: switching, editing, creation, renaming, deletion, filters and restoration.");
} finally {
	for (const session of opened) session.dispose();
	rmSync(tmp, { recursive: true, force: true });
}
