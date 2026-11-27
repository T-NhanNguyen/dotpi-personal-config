import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { cpSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import test from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";
import { agentCatalog } from "./agents/catalog.ts";
import { maskCatalogAgentPrompt, PRELOADED_REFERENCES_HEADING } from "./agent-prompts.ts";
import { composeSections } from "./compose.ts";

const host = process.env.PI_TEST_HOST;
if (!host) throw new Error("Set PI_TEST_HOST to the installed @earendil-works/pi-coding-agent directory.");
const { createAgentSession, DefaultResourceLoader, loadSkills, parseFrontmatter, SessionManager, SettingsManager } =
	await import(pathToFileURL(resolve(host, "dist/index.js")).href);
const { createAssistantMessageEventStream, getModel } =
	await import(pathToFileURL(resolve(host, "../pi-ai/dist/compat.js")).href);
const repo = new URL("../", import.meta.url);
const digest = (text) => createHash("sha256").update(text).digest("hex");
const baseline = JSON.parse(readFileSync(new URL("./parity-baseline.json", import.meta.url), "utf8"));
const markdownFiles = (directory) => readdirSync(new URL(directory, repo)).filter((name) => name.endsWith(".md")).sort();
const userText = (messages) => messages.filter(({ role }) => role === "user")
	.flatMap(({ content }) => content.filter(({ type }) => type === "text").map(({ text }) => text));

// Use the actual Pi prompt, queue and context pipeline, stopping at the model transport.
async function createOfflineSession(temp, loader, onRequest) {
	const model = getModel("anthropic", "claude-sonnet-4-5");
	const { session } = await createAgentSession({
		cwd: temp, agentDir: temp, model, resourceLoader: loader, sessionManager: SessionManager.inMemory(temp),
		settingsManager: SettingsManager.inMemory({ compaction: { enabled: false }, retry: { enabled: false } }),
	});
	try {
		await session.modelRuntime.setRuntimeApiKey(model.provider, "fixture-key");
		session.agent.streamFunction = async (_model, context) => {
			await onRequest(context.messages);
			const stream = createAssistantMessageEventStream();
			stream.push({ type: "done", reason: "stop", message: {
				role: "assistant", content: [{ type: "text", text: "Fixture response." }],
				api: model.api, provider: model.provider, model: model.id, stopReason: "stop", timestamp: Date.now(),
				usage: { input: 1, output: 1, cacheRead: 0, cacheWrite: 0, totalTokens: 2,
					cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } },
			} });
			return stream;
		};
		await session.bindExtensions({ mode: "print" });
		return session;
	} catch (error) {
		session.dispose();
		throw error;
	}
}

test("all agent definitions and the shared reference preserve Pi-parsed metadata and text", () => {
	execFileSync(process.execPath, [fileURLToPath(new URL("./build.mjs", import.meta.url)), "--check"], { stdio: "pipe" });
	assert.deepEqual(markdownFiles("agents/"), Object.keys(baseline.agents));
	for (const [filename, expected] of Object.entries(baseline.agents)) {
		const { frontmatter, body } = parseFrontmatter(readFileSync(new URL(`agents/${filename}`, repo), "utf8"));
		assert.deepEqual(frontmatter, expected.frontmatter, `${filename}: agent metadata`);
		assert.equal(digest(body), expected.bodySha256, `${filename}: agent body`);
	}
	assert.deepEqual(markdownFiles("agents/references/"), Object.keys(baseline.references));
	for (const [filename, expected] of Object.entries(baseline.references)) {
		const { body } = parseFrontmatter(readFileSync(new URL(`agents/references/${filename}`, repo), "utf8"));
		assert.equal(digest(body), expected, `${filename}: reference body`);
	}
});

test("update-dotpi is discoverable from an unrelated project as a portable native skill", () => {
	const temp = mkdtempSync(join(tmpdir(), "pi-update-dotpi-skill-"));
	try {
		const skillPath = fileURLToPath(new URL("skills/update-dotpi", repo));
		const { skills, diagnostics } = loadSkills({
			cwd: temp, agentDir: temp, skillPaths: [skillPath], includeDefaults: false,
		});
		assert.deepEqual(diagnostics, []);
		assert.equal(skills.length, 1);
		assert.equal(skills[0].name, "update-dotpi");
		assert.equal(skills[0].disableModelInvocation, false);
		assert.equal(realpathSync(skills[0].filePath), realpathSync(join(skillPath, "SKILL.md")));
		assert.equal(realpathSync(resolve(skills[0].baseDir, "../..")), realpathSync(fileURLToPath(repo)));
		const { body } = parseFrontmatter(readFileSync(skills[0].filePath, "utf8"));
		assert.match(body, /Text after `\/skill:update-dotpi` is the change request/);
		assert.doesNotMatch(body, /\$\{REPO_ROOT\}/, "skills do not expand snippet placeholders");
	} finally {
		rmSync(temp, { recursive: true, force: true });
	}
});

test("Pi compiles the snippet catalog and preserves the remaining 12 snippet codes and one-shot messages", async () => {
	const temp = mkdtempSync(join(tmpdir(), "pi-prompt-catalog-"));
	let session;
	try {
		const loader = new DefaultResourceLoader({
			cwd: temp, agentDir: temp, noExtensions: true, noSkills: true,
			additionalExtensionPaths: [
				fileURLToPath(new URL("extensions/prompt-snippets/index.ts", repo)),
				fileURLToPath(new URL("extensions/traces/index.ts", repo)),
			],
		});
		await loader.reload();
		const { extensions, errors } = loader.getExtensions();
		assert.deepEqual(errors, []);
		assert.equal(extensions.length, 2);
		const requests = [];
		session = await createOfflineSession(temp, loader, (messages) => requests.push(userText(messages)));
		const submit = async () => {
			const count = requests.length;
			await session.prompt("Check this.");
			assert.equal(requests.length, count + 1);
			return requests.at(-1).at(-1);
		};
		const extension = extensions.find(({ commands }) => commands.has("snippet"));
		assert(session.getActiveToolNames().includes("trace_append"));
		const notices = [];
		const ctx = { hasUI: true, mode: "print", ui: { notify: (text) => notices.push(text) } };
		const command = extension.commands.get("snippet").handler;
		await command("list", ctx);
		assert.equal(digest(notices.pop()), baseline.snippetListSha256, "snippet list (includes order, names and descriptions)");
		assert.equal(await submit(), "Check this.");
		await command("a12", ctx);
		assert.ok(notices.some((text) => /Unknown snippet code: a12/.test(text)), "the old update snippet is retired");
		assert.equal(await submit(), "Check this.");
		for (const [code, expected] of Object.entries(baseline.snippetMessages)) {
			await command(code, ctx);
			assert.match(notices.pop(), new RegExp(`^Enabled for the next prompt: ${code} `));
			assert.equal(digest(await submit()), expected, `${code}: projected message`);
			assert.equal(await submit(), "Check this.", `${code} should reset after one message`);
			assert.ok(requests.at(-1).every((text) => text === "Check this."), `${code} should not be saved in history`);
		}
		await command("a1", ctx);
		// Change availability after the snippet was selected; delivery must recheck it.
		session.setActiveToolsByName(session.getActiveToolNames().filter((name) => name !== "trace_append"));
		assert(session.getActiveToolNames().includes("trace_query"));
		const masked = await submit();
		assert.match(masked, /Verify critical facts/);
		assert.doesNotMatch(masked, /trace id|read the trace|outline\/get\/evidence/);
		await command("a2", ctx);
		const seed = await submit();
		assert.match(seed, /what would change our mind\./);
		assert.doesNotMatch(seed, /Point to the trace/);
	} finally {
		session?.dispose();
		rmSync(temp, { recursive: true, force: true });
	}
});

test("queued snippets survive administrative commands and accompany expanded and loop-like submissions", async () => {
	const temp = mkdtempSync(join(tmpdir(), "pi-snippet-delivery-"));
	let session;
	try {
		const textBlock = (text) => ({ type: "text", text });
		let forceWakeTimestamp = false;
		let liveWake;
		const skillDir = join(temp, "fixture-skill");
		const skillPath = join(skillDir, "SKILL.md");
		const templatePath = join(temp, "fixture-template.md");
		mkdirSync(skillDir);
		writeFileSync(skillPath, "---\nname: fixture-skill\ndescription: Exercise native expansion.\n---\nLoaded skill body.\n");
		writeFileSync(templatePath, "Expanded template: $1\n");
		const loader = new DefaultResourceLoader({
			cwd: temp, agentDir: temp, noExtensions: true, noSkills: true, noPromptTemplates: true,
			additionalExtensionPaths: [fileURLToPath(new URL("extensions/prompt-snippets/index.ts", repo))],
			additionalSkillPaths: [skillPath], additionalPromptTemplatePaths: [templatePath],
			extensionFactories: [(pi) => {
				const loopMessage = (text) => ({ customType: "pi-loop", content: [textBlock(text)], display: false });
				pi.registerCommand("fixture-admin", {
					handler(args) {
						pi.sendMessage(loopMessage(args || "History only."), { triggerTurn: false });
					},
				});
				pi.registerCommand("fixture-wake", {
					handler(args) {
						pi.sendMessage(loopMessage(args), { triggerTurn: true, deliverAs: "steer" });
					},
				});
				pi.on("message_end", ({ message }) => {
					if (!forceWakeTimestamp || message.role !== "custom" || message.customType !== "pi-loop") return;
					// Pi updates the live message in place but timestamps the entry separately.
					liveWake = message;
					return { message: { ...message, timestamp: -1 } };
				});
			}],
		});
		await loader.reload();
		assert.deepEqual(loader.getExtensions().errors, []);
		const requests = [];
		let whileRunning;
		session = await createOfflineSession(temp, loader, async (messages) => {
			requests.push(messages);
			const callback = whileRunning;
			whileRunning = undefined;
			await callback?.();
		});
		const latest = () => userText(requests.at(-1));
		const select = () => session.prompt("/snippet a1");
		const wake = async (text) => {
			await session.prompt(`/fixture-wake ${text}`);
			await session.waitForIdle();
		};
		const snippetBody = /Verify critical facts/;

		await select();
		await session.prompt("/fixture-admin");
		assert.equal(requests.length, 0, "history-only custom message must not start a request");
		await session.prompt("/skill:fixture-skill Skill arguments.");
		assert.match(latest().at(-1), /<skill name="fixture-skill"[\s\S]*Loaded skill body\.[\s\S]*<\/skill>\n\nSkill arguments\./);
		assert.match(latest().at(-1), snippetBody);

		await select();
		await session.prompt("/fixture-template value");
		assert.match(latest().at(-1), /Expanded template: value/);
		assert.match(latest().at(-1), snippetBody);

		const idleWakeText = "Idle wake.";
		await select();
		const beforeIdle = requests.length;
		await session.prompt(`/fixture-admin ${idleWakeText}`);
		assert.equal(requests.length, beforeIdle, "identical history must not start a request");
		forceWakeTimestamp = true;
		try {
			await wake(idleWakeText);
		} finally {
			forceWakeTimestamp = false;
		}
		assert.equal(requests.length, beforeIdle + 1);
		const persistedWake = session.sessionManager.getBranch().findLast(({ type }) => type === "custom_message");
		assert.deepEqual(persistedWake?.content, [textBlock(idleWakeText)]);
		assert.equal(liveWake?.timestamp, -1, "fixture must change the live wake timestamp");
		const persistedTimestamp = Date.parse(persistedWake.timestamp);
		assert.ok(Number.isFinite(persistedTimestamp));
		assert.notEqual(liveWake.timestamp, persistedTimestamp, "wake timestamps must differ");

		const [historyMessage, wakeMessage] = requests.at(-1).slice(-2);
		assert.equal(historyMessage.role, "user");
		assert.equal(wakeMessage.role, "user");
		assert.equal(wakeMessage.timestamp, persistedTimestamp, "request must use the persisted wake timestamp");
		const snippetText = wakeMessage.content[0]?.text;
		assert.match(snippetText, /^<prompt_snippets>\n[\s\S]*\n<\/prompt_snippets>$/);
		assert.match(snippetText, snippetBody);
		assert.deepEqual([historyMessage.content, wakeMessage.content], [
			[textBlock(idleWakeText)],
			[textBlock(snippetText), textBlock(idleWakeText)],
		], "only the live wake receives one snippet block, after unchanged history");
		await wake("Second wake.");
		assert.equal(requests.length, beforeIdle + 2);
		assert.deepEqual(requests.at(-1).at(-1).content, [textBlock("Second wake.")]);
		assert.doesNotMatch(latest().join("\n"), snippetBody);

		const before = requests.length;
		whileRunning = async () => {
			await select();
			await session.prompt("/fixture-admin");
			await session.prompt("/fixture-wake Steered wake.");
		};
		await session.prompt("Start a run.");
		assert.equal(requests.length, before + 2);
		assert.doesNotMatch(userText(requests[before]).join("\n"), snippetBody);
		assert.match(latest().at(-2), snippetBody);
		assert.equal(latest().at(-1), "Steered wake.");
		await session.prompt("Clean follow-up.");
		assert.doesNotMatch(latest().join("\n"), snippetBody);
	} finally {
		session?.dispose();
		rmSync(temp, { recursive: true, force: true });
	}
});

test("a renamed snippet mirror is checked, never delivered, and pruned without touching handwritten Markdown", async () => {
	const temp = mkdtempSync(join(tmpdir(), "pi-snippet-mirror-"));
	let session;
	try {
		cpSync(new URL("prompt-catalog/", repo), join(temp, "prompt-catalog"), { recursive: true });
		const extensionDir = join(temp, "extensions", "prompt-snippets");
		const snippets = join(extensionDir, "snippets");
		mkdirSync(snippets, { recursive: true });
		mkdirSync(join(temp, "agents", "references"), { recursive: true });
		mkdirSync(join(temp, "extensions", "profiles"), { recursive: true });
		cpSync(new URL("extensions/prompt-snippets/index.ts", repo), join(extensionDir, "index.ts"));
		cpSync(new URL("extensions/profiles/tool-availability.ts", repo), join(temp, "extensions", "profiles", "tool-availability.ts"));
		const catalog = join(temp, "prompt-catalog", "snippets", "catalog.ts");
		const writeCatalog = (id, order) => writeFileSync(catalog, `export const snippetCatalog = ${JSON.stringify([{
			id, order, name: "Mirror Fixture", description: "A generated snippet", placement: "append", sections: ["Catalog mirror body."],
		}])};\n`);
		const build = (...args) => execFileSync(process.execPath, [join(temp, "prompt-catalog", "build.mjs"), ...args], { stdio: "pipe" });
		writeCatalog("old.md", 801);
		build();
		const stale = join(snippets, "old.md");
		const mirror = readFileSync(stale, "utf8");
		writeCatalog("new.md", 802);
		const handwritten = join(snippets, "handwritten.md");
		const unrelated = '---\nname: "Handwritten Fixture"\norder: 803\n---\nUser-written body.\nprompt-catalog-generated: "snippet-mirror-v1"\n';
		writeFileSync(handwritten, unrelated);
		const check = spawnSync(process.execPath, [join(temp, "prompt-catalog", "build.mjs"), "--check"], { encoding: "utf8" });
		assert.equal(check.status, 1);
		assert.match(check.stderr, /old\.md is a stale snippet mirror/);
		assert.equal(readFileSync(stale, "utf8"), mirror, "check must not prune");

		const loader = new DefaultResourceLoader({
			cwd: temp, agentDir: temp, noExtensions: true, noSkills: true,
			additionalExtensionPaths: [join(extensionDir, "index.ts")],
		});
		await loader.reload();
		const { extensions, errors } = loader.getExtensions();
		assert.deepEqual(errors, []);
		const requests = [];
		session = await createOfflineSession(temp, loader, (messages) => requests.push(userText(messages)));
		const notices = [];
		const ctx = { hasUI: true, mode: "print", ui: { notify: (text) => notices.push(text) } };
		const command = extensions.find(({ commands }) => commands.has("snippet")).commands.get("snippet").handler;
		await command("list", ctx);
		assert.doesNotMatch(notices.at(-1), /a801/);
		assert.match(notices.at(-1), /a802 Mirror Fixture/);
		assert.match(notices.at(-1), /a803 Handwritten Fixture/);
		await command("a801", ctx);
		assert.match(notices.join("\n"), /Unknown snippet code: a801/);
		await session.prompt("Check this.");
		assert.deepEqual(requests.at(-1), ["Check this."]);
		await command("a803", ctx);
		await session.prompt("Check this.");
		assert.match(requests.at(-1).at(-1), /User-written body\./);

		build();
		assert.throws(() => readFileSync(stale, "utf8"), { code: "ENOENT" });
		assert.match(readFileSync(join(snippets, "new.md"), "utf8"), /Catalog mirror body\./);
		assert.equal(readFileSync(handwritten, "utf8"), unrelated);
		build("--check");

		writeCatalog("handwritten.md", 803);
		assert.throws(() => build(), /handwritten\.md is not an owned snippet mirror/);
		assert.equal(readFileSync(handwritten, "utf8"), unrelated);
	} finally {
		session?.dispose();
		rmSync(temp, { recursive: true, force: true });
	}
});

test("catalog child uses its own settled tool selection, including the profile mask", async () => {
	const temp = realpathSync(mkdtempSync(join(tmpdir(), "pi-catalog-child-")));
	const previousAgentDir = process.env.PI_CODING_AGENT_DIR;
	const agentDir = join(temp, "agent");
	process.env.PI_CODING_AGENT_DIR = agentDir;
	const mask = join(agentDir, "profile-masks", "a".repeat(64));
	const cwd = join(temp, "project");
	const settingsFile = join(cwd, ".pi", "settings.json");
	const worker = agentCatalog.find(({ name }) => name === "worker");
	const full = composeSections(worker.sections);
	const masked = maskCatalogAgentPrompt(worker.name, full);
	const references = PRELOADED_REFERENCES_HEADING + "\nKeep this actual reference suffix outside the compiler gate.\n";
	assert.match(full, /Trace triggers:/);
	assert.doesNotMatch(masked, /Trace triggers:|trace: <id>/);
	assert.equal(maskCatalogAgentPrompt(worker.name, "Handwritten override."), "Handwritten override.");
	try {
		mkdirSync(mask, { recursive: true });
		mkdirSync(join(cwd, ".pi"), { recursive: true });
		writeFileSync(join(mask, "package.json"), JSON.stringify({ name: "fixture-mask", profileDisabledTools: ["trace_append"] }));
		// Local profiles are not shipped; recreate the extension's layout in this fixture.
		const profile = join(temp, "profiles", "embedded");
		const profileExtensionDir = join(temp, "extensions", "profiles");
		mkdirSync(profile, { recursive: true });
		mkdirSync(profileExtensionDir, { recursive: true });
		writeFileSync(join(profile, "package.json"), JSON.stringify({ name: "fixture-profile", pi: { extensions: [] } }));
		for (const file of ["index.ts", "editor.ts", "provenance.ts", "storage.ts", "tool-availability.ts"]) {
			cpSync(new URL(`extensions/profiles/${file}`, repo), join(profileExtensionDir, file));
		}
		for (const mode of ["enabled", "profile-masked", "unavailable"]) {
			writeFileSync(settingsFile, JSON.stringify({ packages: mode === "profile-masked"
				? [{ source: mask, autoload: false }, { source: profile, autoload: false }]
				: [] }));
			const settingsManager = SettingsManager.create(cwd, agentDir);
			settingsManager.setProjectTrusted(true);
			const fromRepo = (entry) => fileURLToPath(new URL(entry, repo));
			const additionalExtensionPaths = [
				fromRepo("extensions/subagent/catalog-child.ts"),
				fromRepo("extensions/prompt-snippets/index.ts"),
				join(profileExtensionDir, "index.ts"),
			];
			if (mode !== "unavailable") additionalExtensionPaths.push(fromRepo("extensions/traces/index.ts"));
			const loader = new DefaultResourceLoader({
				cwd, agentDir, settingsManager, noExtensions: true, noSkills: true,
				appendSystemPrompt: [masked + references],
				additionalExtensionPaths,
			});
			await loader.reload();
			const { extensions, errors } = loader.getExtensions();
			assert.deepEqual(errors, []);
			const adapter = extensions.findIndex(({ path }) => path.endsWith("/catalog-child.ts"));
			const profileExtension = extensions.findIndex(({ commands }) => commands.has("profile"));
			assert(adapter >= 0 && adapter < profileExtension, "exercise the adapter before profile pruning");
			const { session } = await createAgentSession({ cwd, agentDir, settingsManager, resourceLoader: loader, sessionManager: SessionManager.inMemory() });
			try {
				await session.bindExtensions({ mode: "print" });
				const startupTools = session.getActiveToolNames();
				assert.equal(startupTools.includes("trace_append"), mode === "enabled", mode);
				assert.equal(startupTools.includes("trace_query"), mode !== "unavailable", mode);
				if (mode === "profile-masked") {
					const snippets = extensions.find(({ commands }) => commands.has("snippet"));
					const ctx = { hasUI: true, mode: "print", ui: { notify: () => {} } };
					await snippets.commands.get("snippet").handler("a1", ctx);
					// A disk edit does not change the loaded profile, and another extension
					// can reactivate tools before either prompt-delivery hook runs.
					writeFileSync(settingsFile, JSON.stringify({ packages: [] }));
					session.setActiveToolsByName([...startupTools, "trace_append"]);
					assert(session.getActiveToolNames().includes("trace_append"));
					const message = { role: "user", content: [{ type: "text", text: "Check this." }], timestamp: Date.now() };
					await session.extensionRunner.emit({ type: "message_start", message });
					const [text] = userText(await session.extensionRunner.emitContext([message]));
					assert.match(text, /Verify critical facts/);
					assert.doesNotMatch(text, /trace id|read the trace|outline\/get\/evidence/);
				}
				const selectedTools = session.getActiveToolNames();
				assert.equal(selectedTools.includes("trace_append"), mode !== "unavailable", mode);
				const result = await session.extensionRunner.emitBeforeAgentStart(
					{ messageType: "user", prompt: "Check this." },
					{ selectedTools, appendSystemPrompt: loader.getAppendSystemPrompt().join("\n\n") },
				);
				assert.equal(result.systemPromptOptions.selectedTools.includes("trace_append"), mode === "enabled", mode);
				assert.equal(result.systemPromptOptions.appendSystemPrompt, (mode === "enabled" ? full : masked) + references, mode);
			} finally {
				session.dispose();
			}
		}
	} finally {
		if (previousAgentDir === undefined) delete process.env.PI_CODING_AGENT_DIR;
		else process.env.PI_CODING_AGENT_DIR = previousAgentDir;
		rmSync(temp, { recursive: true, force: true });
	}
});
