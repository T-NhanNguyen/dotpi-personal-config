import { existsSync, lstatSync, mkdirSync, readFileSync, readdirSync, unlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { agentCatalog } from "./agents/catalog.ts";
import { snippetCatalog } from "./snippets/catalog.ts";
import { referenceCatalog } from "./references/catalog.ts";
import { composeSections } from "./compose.ts";
import { isSnippetMirror, SNIPPET_MIRROR_MARKER } from "./snippet-mirrors.ts";

const args = process.argv.slice(2);
if (args.length > 1 || (args.length === 1 && args[0] !== "--check")) {
	throw new Error("Usage: node prompt-catalog/build.mjs [--check]");
}

const check = args[0] === "--check";
const repo = fileURLToPath(new URL("../", import.meta.url));
const snippetDirectory = "extensions/prompt-snippets/snippets/";
const snippetOutput = join(repo, snippetDirectory);

function markdown(metadata, sections, marker) {
	// JSON scalar and flow-list syntax are valid YAML; Pi's agent parser reads both.
	const frontmatter = Object.entries(metadata).map(([key, value]) => `${key}: ${JSON.stringify(value)}`);
	if (marker) frontmatter.unshift(marker);
	return `---\n${frontmatter.join("\n")}\n---\n\n${composeSections(sections)}\n`;
}

const artifacts = new Map();
function add(path, rendered) {
	if (artifacts.has(path)) throw new Error(`Duplicate prompt artifact: ${path}`);
	artifacts.set(path, rendered);
}

for (const { sections, tools, ...metadata } of agentCatalog) {
	add(`agents/${metadata.name}.md`, markdown({ ...metadata, tools: tools.join(", ") }, sections));
}
for (const { id, sections, ...metadata } of snippetCatalog) {
	add(`${snippetDirectory}${id}`, markdown(metadata, sections, SNIPPET_MIRROR_MARKER));
}
for (const { id, sections } of referenceCatalog) {
	add(`agents/references/${id}`, `${composeSections(sections)}\n`);
}

for (const [path, rendered] of artifacts) {
	const output = join(repo, path);
	const snippet = path.startsWith(snippetDirectory);
	const existing = snippet ? lstatSync(output, { throwIfNoEntry: false }) : undefined;
	let current;
	try {
		if (!existing || existing.isFile()) current = readFileSync(output, "utf8");
	} catch (error) {
		if (error.code !== "ENOENT") throw error;
	}
	if (current === rendered) continue;
	if (existing && (current === undefined || !isSnippetMirror(current))) {
		console.error(`${path} is not an owned snippet mirror. Move it before building prompts.`);
		process.exitCode = 1;
		continue;
	}
	if (check) {
		console.error(`${path} is out of date. Run npm run build:prompts.`);
		process.exitCode = 1;
	} else {
		if (snippet) mkdirSync(snippetOutput, { recursive: true });
		writeFileSync(output, rendered);
		console.log(`Generated ${path}`);
	}
}

const entries = existsSync(snippetOutput) ? readdirSync(snippetOutput, { withFileTypes: true }) : [];
for (const entry of entries) {
	if (!entry.isFile() || !entry.name.toLowerCase().endsWith(".md")) continue;
	const path = `${snippetDirectory}${entry.name}`;
	if (artifacts.has(path)) continue;
	const file = join(snippetOutput, entry.name);
	if (!isSnippetMirror(readFileSync(file, "utf8"))) continue;
	if (check) {
		console.error(`${path} is a stale snippet mirror. Run npm run build:prompts.`);
		process.exitCode = 1;
	} else {
		unlinkSync(file);
		console.log(`Removed stale ${path}`);
	}
}
