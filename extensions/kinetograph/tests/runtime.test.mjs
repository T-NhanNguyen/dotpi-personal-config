import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { resolveKinetograph } from "../runtime.ts";

test("selects fork CLI and skill together, otherwise installed pair", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "kinetograph fork with spaces "));
  const previous = process.env.KINETOGRAPH_FORK_ROOT;
  t.after(async () => {
    if (previous === undefined) delete process.env.KINETOGRAPH_FORK_ROOT;
    else process.env.KINETOGRAPH_FORK_ROOT = previous;
    await rm(root, { recursive: true, force: true });
  });
  const warnings = [];
  const previousWarn = console.warn;
  console.warn = message => warnings.push(message);
  t.after(() => { console.warn = previousWarn; });
  process.env.KINETOGRAPH_FORK_ROOT = root;
  const missing = resolveKinetograph();
  assert.equal(missing.source, "installed 0.2.x");
  assert.match(warnings.at(-1), /audio_narrate unavailable/);
  assert.match(warnings.at(-1), /Narration must stop/);
  assert.match(missing.cli, /node_modules\/kinetograph\/dist\/cli\.js$/);
  assert.match(missing.skill, /node_modules\/kinetograph\/skills\/kinetograph\/SKILL\.md$/);
  for (const file of [".local-cli/cli.mjs", "packages/cli/skills/kinetograph/SKILL.md", ".local-cli/node_modules/kinetograph/dist/cli.js"]) {
    const path = join(root, file);
    await mkdir(join(path, ".."), { recursive: true });
    await writeFile(path, "fixture");
  }
  const fork = resolveKinetograph();
  assert.equal(fork.source, "local fork");
  assert.equal(fork.cli, join(root, ".local-cli/cli.mjs"));
  assert.equal(fork.skill, join(root, "packages/cli/skills/kinetograph/SKILL.md"));
  // Each required member is independently necessary: never mix a fork skill
  // with the published CLI or advertise narration with a missing runtime.
  for (const required of [fork.skill, fork.cli, join(root, '.local-cli/node_modules/kinetograph/dist/cli.js')]) {
    await rm(required);
    const fallback = resolveKinetograph();
    assert.equal(fallback.source, "installed 0.2.x");
    assert.equal(fallback.cli, missing.cli);
    assert.equal(fallback.skill, missing.skill);
    assert.match(warnings.at(-1), /audio_narrate unavailable/);
    await writeFile(required, 'fixture');
    assert.deepEqual(resolveKinetograph(), fork);
  }
});
