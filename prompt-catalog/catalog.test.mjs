import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { cpSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import test from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";
import { agentCatalog } from "./agents/catalog.ts";
import { maskCatalogAgentPrompt, PRELOADED_REFERENCES_HEADING } from "./agent-prompts.ts";
import { composeSections } from "./compose.ts";

const host = process.env.PI_TEST_HOST;
if (!host) throw new Error("Set PI_TEST_HOST to the installed @earendil-works/pi-coding-agent directory.");
const { createAgentSession, DefaultResourceLoader, parseFrontmatter, SessionManager, SettingsManager } =
	await import(pathToFileURL(resolve(host, "dist/index.js")).href);
const repo = new URL("../", import.meta.url);
const digest = (text) => createHash("sha256").update(text).digest("hex");
const baseline = JSON.parse(readFileSync(new URL("./parity-baseline.json", import.meta.url), "utf8"));
const markdownFiles = (directory) => readdirSync(new URL(directory, repo)).filter((name) => name.endsWith(".md")).sort();

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

test("Pi compiles the snippet catalog and preserves all 13 snippet codes and one-shot messages", async () => {
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
		({ session } = await createAgentSession({ cwd: temp, agentDir: temp, resourceLoader: loader, sessionManager: SessionManager.inMemory() }));
		await session.bindExtensions({ mode: "print" });
		const extension = extensions.find(({ commands }) => commands.has("snippet"));
		assert(session.getActiveToolNames().includes("trace_append"));
		const notices = [];
		const ctx = { hasUI: true, mode: "print", ui: { notify: (text) => notices.push(text) } };
		const input = extension.handlers.get("input")[0];
		const command = extension.commands.get("snippet").handler;
		const event = { text: "Check this." };
		await command("list", ctx);
		assert.equal(digest(notices.pop()), baseline.snippetListSha256, "snippet list (includes order, names and descriptions)");
		assert.equal(await input(event, ctx), undefined);
		for (const [code, expected] of Object.entries(baseline.snippetMessages)) {
			await command(code, ctx);
			assert.match(notices.pop(), new RegExp(`^Enabled for the next prompt: ${code} `));
			const transformed = await input(event, ctx);
			assert.equal(transformed?.action, "transform", code);
			assert.equal(digest(transformed.text), expected, `${code}: transformed message`);
			assert.equal(await input(event, ctx), undefined, `${code} should reset after one message`);
		}
		await command("a1", ctx);
		// Change availability after the snippet was selected; delivery must recheck it.
		session.setActiveToolsByName(session.getActiveToolNames().filter((name) => name !== "trace_append"));
		assert(session.getActiveToolNames().includes("trace_query"));
		const masked = (await input(event, ctx)).text;
		assert.match(masked, /Verify critical facts/);
		assert.doesNotMatch(masked, /trace id|read the trace|outline\/get\/evidence/);
		await command("a2", ctx);
		const seed = (await input(event, ctx)).text;
		assert.match(seed, /what would change our mind\./);
		assert.doesNotMatch(seed, /Point to the trace/);
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
		({ session } = await createAgentSession({ cwd: temp, agentDir: temp, resourceLoader: loader, sessionManager: SessionManager.inMemory() }));
		await session.bindExtensions({ mode: "print" });
		const notices = [];
		const ctx = { hasUI: true, mode: "print", ui: { notify: (text) => notices.push(text) } };
		const command = extensions.find(({ commands }) => commands.has("snippet")).commands.get("snippet").handler;
		await command("list", ctx);
		assert.doesNotMatch(notices.at(-1), /a801/);
		assert.match(notices.at(-1), /a802 Mirror Fixture/);
		assert.match(notices.at(-1), /a803 Handwritten Fixture/);
		await command("a801", ctx);
		assert.match(notices.join("\n"), /Unknown snippet code: a801/);
		assert.equal((await session.extensionRunner.emitInput("Check this.", undefined, "interactive")).action, "continue");
		await command("a803", ctx);
		assert.match((await session.extensionRunner.emitInput("Check this.", undefined, "interactive")).text, /User-written body\./);

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
	const temp = mkdtempSync(join(tmpdir(), "pi-catalog-child-"));
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
		const profile = fileURLToPath(new URL("profiles/embedded", repo));
		for (const mode of ["enabled", "profile-masked", "unavailable"]) {
			writeFileSync(settingsFile, JSON.stringify({ packages: mode === "profile-masked"
				? [{ source: mask, autoload: false }, { source: profile, autoload: false }]
				: [] }));
			const settingsManager = SettingsManager.create(cwd, agentDir);
			settingsManager.setProjectTrusted(true);
			const additionalExtensionPaths = ["extensions/subagent/catalog-child.ts", "extensions/prompt-snippets/index.ts", "extensions/profiles/index.ts"];
			if (mode !== "unavailable") additionalExtensionPaths.push("extensions/traces/index.ts");
			const loader = new DefaultResourceLoader({
				cwd, agentDir, settingsManager, noExtensions: true, noSkills: true,
				appendSystemPrompt: [masked + references],
				additionalExtensionPaths: additionalExtensionPaths.map((entry) => fileURLToPath(new URL(entry, repo))),
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
					const input = await session.extensionRunner.emitInput("Check this.", undefined, "interactive");
					assert.equal(input.action, "transform");
					assert.match(input.text, /Verify critical facts/);
					assert.doesNotMatch(input.text, /trace id|read the trace|outline\/get\/evidence/);
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
