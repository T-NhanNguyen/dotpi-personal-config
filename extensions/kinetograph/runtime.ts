import { existsSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

/** Select CLI + skill as one unit; never advertise fork instructions with the upstream runtime. */
export function resolveKinetograph() {
  const root = process.env.KINETOGRAPH_FORK_ROOT
    ? resolve(process.env.KINETOGRAPH_FORK_ROOT)
    : resolve(dirname(fileURLToPath(import.meta.url)), "../../../kinetograph");
  const cli = join(root, ".local-cli/cli.mjs");
  const skill = join(root, "packages/cli/skills/kinetograph/SKILL.md");
  if (existsSync(cli) && existsSync(skill) && existsSync(join(root, ".local-cli/node_modules/kinetograph/dist/cli.js"))) {
    return { cli, skill, source: "local fork" };
  }
  console.warn(`[kinetograph] Fork unavailable at ${root}; using installed CLI and skill together (audio_narrate unavailable). Narration must stop until the fork is restored and built with node <fork>/packages/cli/build-local.mjs.`);
  const require = createRequire(import.meta.url);
  const dist = dirname(require.resolve("kinetograph"));
  const installedCli = require.resolve(join(dist, "cli.js"));
  const installedSkill = join(dirname(dist), "skills/kinetograph/SKILL.md");
  if (!existsSync(installedSkill)) throw new Error(`Missing installed Kinetograph skill: ${installedSkill}`);
  return { cli: installedCli, skill: installedSkill, source: "installed 0.2.x" };
}
