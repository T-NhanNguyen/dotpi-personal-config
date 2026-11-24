import type { SourceInfo } from "@earendil-works/pi-coding-agent";
import { basename, dirname, extname, relative } from "node:path";

export type Parent = { id: string; label: string; note?: string };
type Origin = Pick<SourceInfo, "origin" | "source" | "scope" | "baseDir">;

const CORE_NAMES = new Set(["read", "bash", "powershell", "edit", "write", "grep", "find", "ls"]);
const CORE: Parent = { id: "core", label: "Pi built-ins", note: "Core harness tools; usually leave on" };
export const UNAVAILABLE: Parent = { id: "unavailable", label: "Not available here" };
const scopeLabel = { user: "User", project: "Project", temporary: "Temporary" };

function packageParent(origin: Origin): Parent | undefined {
	if (origin.origin !== "package") return;
	const source = origin.source;
	const name = source.startsWith("npm:") ? source.slice(4)
		: origin.baseDir ? basename(origin.baseDir) || source
			: source;
	return { id: `package:${origin.scope}:${source}`, label: `${name} (${scopeLabel[origin.scope].toLowerCase()} package)` };
}

export function resourceParents(path: string, origin: Origin): Parent[] {
	const pkg = packageParent(origin);
	if (pkg) return [pkg];
	const root = origin.baseDir ?? dirname(path);
	return [{ id: `loose:${origin.scope}:${root}`, label: `${scopeLabel[origin.scope]} loose resources: ${root}` }];
}

export function toolParents(name: string, source: SourceInfo | undefined): Parent[] {
	if (!source) return [{ id: "unknown-tools", label: "Tools with no source metadata" }];
	if (CORE_NAMES.has(name) && source.source === "builtin" && source.path === `builtin:${name}`) return [CORE];
	if (source.path.startsWith("<")) return [{ id: `synthetic:${source.source}`, label: `Tools from ${source.source}` }];
	if (source.path.startsWith("builtin:")) {
		return [{ id: source.path, label: `${source.path.slice(8)} (bundled extension)` }];
	}
	const pkg = packageParent(source);
	const path = pkg && source.baseDir ? relative(source.baseDir, source.path) : source.path;
	const namePart = basename(path, extname(path));
	const label = pkg ? path : namePart === "index" ? basename(dirname(path)) : namePart;
	const extension = { id: `extension:${source.path}`, label: `${label} (extension)` };
	return pkg ? [pkg, extension] : [extension];
}
