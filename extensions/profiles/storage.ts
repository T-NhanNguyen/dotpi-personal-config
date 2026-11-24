import { CONFIG_DIR_NAME, DefaultPackageManager, SettingsManager, getAgentDir, loadSkills } from "@earendil-works/pi-coding-agent";
import { createHash } from "node:crypto";
import { lstatSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, renameSync, rmdirSync, rmSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { resourceParents, type Parent } from "./provenance.js";

const PROFILES_DIR = fileURLToPath(new URL("../../profiles", import.meta.url));
const PROFILE_NAME = /^[a-z0-9][a-z0-9-]{0,39}$/;
const MASK_NAME = /^[a-f0-9]{64}$/;
export const GROUPS = ["skills", "tools", "prompts"] as const;
export type Group = (typeof GROUPS)[number];
export type Filters = Record<Group, string[]>;
export type FilterSnapshot = { filters: Filters; revision: string | undefined };
export type Resource = { group: Group; id: string; label: string; parents: Parent[] };
type Settings = Record<string, unknown>;

const emptyFilters = (): Filters => ({ skills: [], tools: [], prompts: [] });
const maskRoot = () => resolve(getAgentDir(), "profile-masks");

export function listProfiles(): string[] {
	return readdirSync(PROFILES_DIR, { withFileTypes: true })
		.filter((entry) => entry.isDirectory() && entry.name !== "none" && PROFILE_NAME.test(entry.name))
		.map((entry) => entry.name)
		.sort();
}

function readObject(path: string): { value: Settings; mode: number } | undefined {
	try {
		const stat = lstatSync(path);
		if (!stat.isFile()) throw new Error(`${path} is not a regular file.`);
		const value: unknown = JSON.parse(readFileSync(path, "utf8"));
		if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(`${path} must contain a JSON object.`);
		return { value: value as Settings, mode: stat.mode & 0o777 };
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
	}
}

function writeObject(path: string, value: object, mode = 0o600) {
	const dir = dirname(path);
	mkdirSync(dir, { recursive: true });
	const tempDir = mkdtempSync(join(dir, ".profile-"));
	try {
		const temp = join(tempDir, "write.json");
		writeFileSync(temp, `${JSON.stringify(value, null, 2)}\n`, { mode });
		renameSync(temp, path);
	} finally {
		rmSync(tempDir, { recursive: true, force: true });
	}
}

function projectSettings(cwd: string) {
	const path = join(cwd, CONFIG_DIR_NAME, "settings.json");
	const existing = readObject(path);
	const settings = existing?.value ?? {};
	const { packages } = settings;
	if (packages !== undefined && !Array.isArray(packages)) throw new Error(`${path}: packages must be an array.`);
	return { path, settings, packages: packages ?? [], mode: existing?.mode };
}

function entryPath(entry: unknown, settingsDir: string) {
	const source = typeof entry === "object" && entry !== null && "source" in entry ? entry.source : entry;
	if (typeof source !== "string" || !source) return;
	const expanded = source === "~" ? homedir() : /^~[\\/]/.test(source) ? join(homedir(), source.slice(2)) : source;
	return resolve(settingsDir, expanded);
}

function isMask(path: string) {
	return dirname(path) === maskRoot() && MASK_NAME.test(basename(path));
}

function baselinePackages(packages: unknown[], dir: string, target: string | undefined) {
	const targetPath = target === undefined ? undefined : join(PROFILES_DIR, target);
	const existing = targetPath === undefined ? -1 : packages.findLastIndex((entry) => entryPath(entry, dir) === targetPath);
	const kept = packages.filter((entry, index) => {
		const path = entryPath(entry, dir);
		// Keep the selected entry and its position: pi config can store overrides on it.
		return index === existing || path === undefined || (dirname(path) !== PROFILES_DIR && !isMask(path));
	});
	if (targetPath !== undefined && existing === -1) kept.push(targetPath);
	return kept;
}

export function activeSelection(cwd: string) {
	const { path, packages } = projectSettings(cwd);
	const paths = packages.map((entry) => entryPath(entry, dirname(path))).filter((entry) => entry !== undefined);
	const profile = paths.find((entry) => dirname(entry) === PROFILES_DIR);
	return { name: profile === undefined ? undefined : basename(profile), mask: paths.find(isMask) };
}

function validateStrings(value: unknown, key: string, path: string): string[] {
	if (value === undefined) return [];
	if (!Array.isArray(value) || value.some((item) => typeof item !== "string" || item.length === 0)) {
		throw new Error(`${path}: ${key} must be an array of nonempty strings.`);
	}
	return [...new Set(value as string[])].sort();
}

export function readFilters(profile: string): FilterSnapshot {
	const path = join(PROFILES_DIR, profile, "filters.json");
	const settings = readObject(path)?.value;
	return {
		revision: settings === undefined ? undefined : JSON.stringify(settings),
		filters: settings ? {
			skills: validateStrings(settings.skills, "skills", path),
			tools: validateStrings(settings.tools, "tools", path),
			prompts: validateStrings(settings.prompts, "prompts", path),
		} : emptyFilters(),
	};
}

export function saveFilters(profile: string, filters: Filters, expectedRevision: FilterSnapshot["revision"]) {
	const path = join(PROFILES_DIR, profile, "filters.json");
	const lock = `${path}.lock`;
	// Hold the lock across both the revision check and the atomic replacement.
	try {
		mkdirSync(lock);
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
		throw new Error("Profile save is locked. Try again when the other save finishes.");
	}
	try {
		const current = readObject(path);
		const revision = current === undefined ? undefined : JSON.stringify(current.value);
		if (revision !== expectedRevision) {
			throw new Error("Filters changed on disk. Reopen the editor to load them.");
		}
		writeObject(path, { ...current?.value, ...filters }, current?.mode);
	} finally {
		rmdirSync(lock);
	}
}

function resourceId(path: string) {
	const rel = relative(PROFILES_DIR, path);
	return rel && rel !== ".." && !rel.startsWith(`..${sep}`) && !isAbsolute(rel)
		? `./${rel.split(sep).join("/")}` : path;
}

async function resolveResources(cwd: string, settings: Settings, packages: unknown[]) {
	const agentDir = getAgentDir();
	const global = JSON.stringify(SettingsManager.create(cwd, agentDir).getGlobalSettings());
	const project = JSON.stringify({ ...settings, packages });
	const settingsManager = SettingsManager.fromStorage({
		withLock(scope, read) { read(scope === "global" ? global : project); },
	});
	const manager = new DefaultPackageManager({ cwd, agentDir, settingsManager });
	return manager.resolve(async () => "skip");
}

export async function listProfileResources(cwd: string, target: string): Promise<Resource[]> {
	const { path, settings, packages } = projectSettings(cwd);
	const resolved = await resolveResources(cwd, settings, baselinePackages(packages, dirname(path), target));
	// Load one file at a time so a disabled winner doesn't hide another candidate with the same name.
	const skills = resolved.skills.filter(({ enabled }) => enabled).flatMap(({ path, metadata }) => {
		const parents = resourceParents(path, metadata);
		return loadSkills({ cwd, agentDir: getAgentDir(), skillPaths: [path], includeDefaults: false }).skills
			.map(({ name, filePath }): Resource => ({ group: "skills", id: resourceId(filePath), label: name, parents }));
	});
	return [
		...skills,
		...resolved.prompts.filter(({ enabled }) => enabled).map(({ path, metadata }): Resource => ({
			group: "prompts", id: resourceId(path), label: `/${basename(path, ".md")}`, parents: resourceParents(path, metadata),
		})),
	];
}

export function readMaskedTools(mask: string | undefined): string[] {
	if (!mask) return [];
	const path = join(mask, "package.json");
	const value = readObject(path)?.value;
	if (!value) throw new Error(`Profile filter snapshot not found: ${path}. Reapply the profile.`);
	return validateStrings(value.profileDisabledTools, "profileDisabledTools", path);
}

function prepareMask(skills: string[], prompts: string[], tools: string[]) {
	const manifest = { name: "pi-profile-mask", private: true, pi: { skills, prompts }, profileDisabledTools: tools };
	const hash = createHash("sha256").update(JSON.stringify(manifest)).digest("hex");
	const dir = join(maskRoot(), hash);
	const path = join(dir, "package.json");
	// Pi resolves project packages first. A disabled path in this delta shadows the
	// same file in inherited packages and loose resources, without changing either.
	return {
		entry: { source: dir, autoload: false, skills: skills.map((path) => `-${path}`), prompts: prompts.map((path) => `-${path}`) },
		persist() { if (!readObject(path)) writeObject(path, manifest); },
	};
}

export async function writeProfile(cwd: string, target: string | undefined, waitForIdle: () => Promise<void>) {
	const current = projectSettings(cwd);
	const { path, settings, packages, mode } = current;
	const next = baselinePackages(packages, dirname(path), target);
	let mask: ReturnType<typeof prepareMask> | undefined;
	if (target !== undefined) {
		const { filters } = readFilters(target);
		if (filters.skills.length || filters.prompts.length || filters.tools.length) {
			const resolved = filters.skills.length || filters.prompts.length ? await resolveResources(cwd, settings, next) : undefined;
			const excluded = (group: "skills" | "prompts") => (resolved?.[group] ?? [])
				.filter(({ path, enabled }) => enabled && filters[group].includes(resourceId(path))).map(({ path }) => path).sort();
			const skills = excluded("skills");
			const prompts = excluded("prompts");
			if (skills.length || prompts.length || filters.tools.length) mask = prepareMask(skills, prompts, filters.tools);
		}
	}
	await waitForIdle();
	// Resource discovery and idle waiting can take time; don't replace edits made meanwhile.
	if (JSON.stringify(projectSettings(cwd).settings) !== JSON.stringify(settings)) {
		throw new Error("Project settings changed while switching. Try /profile again.");
	}
	if (mask) {
		mask.persist();
		next.unshift(mask.entry);
	}
	if (JSON.stringify(next) !== JSON.stringify(packages)) writeObject(path, { ...settings, packages: next }, mode);
}
