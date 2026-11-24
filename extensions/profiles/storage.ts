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

function validProfileName(name: string) {
	return name !== "none" && PROFILE_NAME.test(name);
}

export function listProfiles(): string[] {
	try {
		return readdirSync(PROFILES_DIR, { withFileTypes: true })
			.filter((entry) => entry.isDirectory() && validProfileName(entry.name))
			.map((entry) => entry.name)
			.sort();
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
		throw error;
	}
}

function profilePath(name: string) {
	if (!validProfileName(name)) throw new Error('Use 1–40 lowercase letters, digits or dashes, starting with a letter or digit. "none" is reserved.');
	return join(PROFILES_DIR, name);
}

function existingProfile(name: string) {
	const path = profilePath(name);
	if (!listProfiles().includes(name)) throw new Error(`Profile "${name}" no longer exists.`);
	return path;
}

function withProfileLock<T>(action: () => T): T {
	mkdirSync(PROFILES_DIR, { recursive: true });
	const lock = join(PROFILES_DIR, ".profiles.lock");
	try {
		mkdirSync(lock);
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
		throw new Error("Profile save is locked. Try again when the other operation finishes.");
	}
	try {
		return action();
	} finally {
		rmdirSync(lock);
	}
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

export function createProfile(name: string) {
	const path = profilePath(name);
	withProfileLock(() => {
		try {
			mkdirSync(path);
		} catch (error) {
			if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
			throw new Error(`Profile name "${name}" is already in use.`);
		}
		try {
			writeObject(join(path, "package.json"), {
				name: `profile-${name}`,
				private: true,
				version: "0.1.0",
				// Declare conventional paths even when empty so Pi doesn't try this directory as an extension.
				pi: { extensions: ["extensions"], skills: ["skills"], prompts: ["prompts"], themes: ["themes"] },
			}, 0o644);
		} catch (error) {
			rmdirSync(path);
			throw error;
		}
	});
}

function assertInactive(cwd: string, name: string) {
	if (activeSelection(cwd).name === name) throw new Error("Switch this project to None or another profile first.");
}

export function renameProfile(cwd: string, name: string, nextName: string) {
	const next = profilePath(nextName);
	withProfileLock(() => {
		const current = existingProfile(name);
		if (current === next) return;
		assertInactive(cwd, name);
		try {
			lstatSync(next);
			throw new Error(`Profile name "${nextName}" is already in use.`);
		} catch (error) {
			if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
		}
		const filterFile = "filters.json";
		const saved = readObject(join(current, filterFile));
		const value = saved ? { ...saved.value } : undefined;
		const prefix = `./${name}/`;
		// Repo-local skill and prompt IDs include the folder name; preserve their exclusions.
		let changed = false;
		if (value) {
			for (const group of ["skills", "prompts"]) {
				const ids = value[group];
				if (!Array.isArray(ids)) continue;
				value[group] = ids.map((id) => {
					if (typeof id !== "string" || !id.startsWith(prefix)) return id;
					changed = true;
					return `./${nextName}/${id.slice(prefix.length)}`;
				});
			}
		}
		renameSync(current, next);
		if (!changed || !value) return;
		try {
			writeObject(join(next, filterFile), value, saved?.mode);
		} catch (error) {
			renameSync(next, current);
			throw error;
		}
	});
}

export function deleteProfile(cwd: string, name: string) {
	withProfileLock(() => {
		const path = existingProfile(name);
		assertInactive(cwd, name);
		rmSync(path, { recursive: true });
	});
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
	// Hold the lock across both the revision check and the atomic replacement.
	withProfileLock(() => {
		const path = join(existingProfile(profile), "filters.json");
		const current = readObject(path);
		const revision = current === undefined ? undefined : JSON.stringify(current.value);
		if (revision !== expectedRevision) {
			throw new Error("Filters changed on disk. Reopen the editor to load them.");
		}
		writeObject(path, { ...current?.value, ...filters }, current?.mode);
	});
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
	withProfileLock(() => {
		// Resource discovery and idle waiting can take time; don't replace edits made meanwhile.
		if (JSON.stringify(projectSettings(cwd).settings) !== JSON.stringify(settings)) {
			throw new Error("Project settings changed while switching. Try /profile again.");
		}
		if (target !== undefined) existingProfile(target);
		if (mask) {
			mask.persist();
			next.unshift(mask.entry);
		}
		if (JSON.stringify(next) !== JSON.stringify(packages)) writeObject(path, { ...settings, packages: next }, mode);
	});
}
