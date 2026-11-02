import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, writeFile, rm } from "node:fs/promises";
import { realpathSync, existsSync } from "node:fs";
import { tmpdir, homedir } from "node:os";
import path from "node:path";
import { execSync } from "node:child_process";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const host = (() => {
  const candidates = [
    process.env.PI_TEST_HOST,
    path.join(homedir(), ".bun/install/global/node_modules/@earendil-works/pi-coding-agent"),
    path.join(execSync("npm root -g", { encoding: "utf8" }).trim(), "@earendil-works/pi-coding-agent"),
  ];
  for (const candidate of candidates) {
    if (candidate && existsSync(path.join(candidate, "package.json"))) return candidate;
  }
  throw new Error("Cannot locate @earendil-works/pi-coding-agent. Set PI_TEST_HOST to its install dir.");
})();
const require = createRequire(path.join(host, "package.json"));
const { createJiti } = require("jiti");
const jiti = createJiti(import.meta.url, { moduleCache: false });
const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const source = await readFile(path.join(root, "index.ts"), "utf8");
const temporary = await mkdtemp(path.join(tmpdir(), "kinetograph-test-"));
const originalCwd = process.cwd();
let count = 0;
const check = async (name, fn) => { await fn(); console.log(`ok ${++count}: ${name}`); };

async function fixture(name, withCli) {
  const directory = path.join(temporary, name);
  await mkdir(directory, { recursive: true });
  await writeFile(path.join(directory, "index.ts"), source);
  await writeFile(path.join(directory, "runtime.ts"), await readFile(path.join(root, "runtime.ts"), "utf8"));
  if (withCli !== undefined) {
    const pkg = path.join(directory, "node_modules", "kinetograph");
    await mkdir(path.join(pkg, "dist"), { recursive: true });
    await writeFile(path.join(pkg, "package.json"), JSON.stringify({ name: "kinetograph", type: "module", exports: { ".": "./dist/index.js" } }));
    // Resolution must not execute the package's engine entry or CLI.
    await writeFile(path.join(pkg, "dist/index.js"), 'throw new Error("engine was imported");');
    if (withCli) {
      await writeFile(path.join(pkg, "dist/cli.js"), 'throw new Error("CLI was imported");');
      await mkdir(path.join(pkg, "skills/kinetograph"), { recursive: true });
      await writeFile(path.join(pkg, "skills/kinetograph/SKILL.md"), "# Kinetograph fixture\n");
    }
  }
  return { factory: await jiti.import(path.join(directory, "index.ts"), { default: true }), directory };
}

function warnings(fn) {
  const original = console.warn;
  const messages = [];
  console.warn = message => messages.push(message);
  try { fn(); } finally { console.warn = original; }
  return messages;
}

const originalForkRoot = process.env.KINETOGRAPH_FORK_ROOT;
process.env.KINETOGRAPH_FORK_ROOT = path.join(temporary, "nonexistent-fork");
const fallbackWarning = /\[kinetograph\] Fork unavailable at .*; using installed CLI and skill together \(audio_narrate unavailable\)\. Narration must stop until the fork is restored and built with node <fork>\/packages\/cli\/build-local\.mjs\./;
const selectedWarning = /\[kinetograph\] Selected installed 0\.2\.x: .*; skill: .*\. An mcp\.json server with this name overrides the runtime; check \/mcp before using the skill\./;
function assertWarnings(messages, patterns) {
  assert.equal(messages.length, patterns.length);
  patterns.forEach((pattern, index) => assert.match(messages[index], pattern));
}

try {
  process.chdir(temporary);
  await check("registers the installed local CLI with deferred exposure and a render timeout", async () => {
    const factory = await jiti.import(path.join(root, "index.ts"), { default: true });
    const calls = [];
    assertWarnings(warnings(() => factory({ on: () => {}, registerMcpServer: (...args) => calls.push(args) })), [fallbackWarning, selectedWarning]);
    assert.equal(calls.length, 1);
    const [name, config] = calls[0];
    const local = createRequire(path.join(root, "index.ts"));
    assert.equal(name, "kinetograph");
    assert.equal(config.command, process.execPath);
    assert.deepEqual(config.args, [local.resolve(path.join(path.dirname(local.resolve("kinetograph")), "cli.js")), "mcp"]);
    assert.equal(config.exposure, "deferred");
    assert.equal(config.timeout, 600);
    assert.match(config.description, /video/i);
    assert.equal(config.cwd, undefined);
  });
  await check("resolves from the extension, not cwd, despite package subpath export restrictions", async () => {
    const { factory, directory } = await fixture("valid", true);
    let config;
    assertWarnings(warnings(() => factory({ on: () => {}, registerMcpServer: (_name, value) => { config = value; } })), [fallbackWarning, selectedWarning]);
    // macOS may resolve the temporary directory's /var alias to /private/var.
    assert.equal(realpathSync(config.args[0]), realpathSync(path.join(directory, "node_modules/kinetograph/dist/cli.js")));
    const local = createRequire(path.join(directory, "index.ts"));
    assert.throws(() => local.resolve("kinetograph/dist/cli.js"), { code: "ERR_PACKAGE_PATH_NOT_EXPORTED" });
  });
  await check("unsupported Pi reports an actionable warning before dependency resolution", async () => {
    const { factory } = await fixture("unsupported");
    const messages = warnings(() => factory({}));
    assertWarnings(messages, [/registerMcpServer.*Update Pi/]);
  });
  await check("missing dependency warns without registering or throwing", async () => {
    const { factory } = await fixture("missing");
    const messages = warnings(() => factory({ on: () => {}, registerMcpServer: () => assert.fail("must not register") }));
    assertWarnings(messages, [fallbackWarning, /cannot resolve.*npm install/]);
  });
  await check("missing CLI in an incomplete installation fails before registration", async () => {
    const { factory } = await fixture("incomplete", false);
    const messages = warnings(() => factory({ on: () => {}, registerMcpServer: () => assert.fail("must not register") }));
    assertWarnings(messages, [fallbackWarning, /cannot resolve.*npm install/]);
  });
  await check("registration rejection does not escape the extension factory", async () => {
    const { factory } = await fixture("rejected", true);
    const messages = warnings(() => factory({ on: () => {}, registerMcpServer: () => { throw new Error("name owned by another extension"); } }));
    assertWarnings(messages, [fallbackWarning, selectedWarning, /registration failed.*\/mcp.*name owned by another extension/]);
  });
} finally {
  if (originalForkRoot === undefined) delete process.env.KINETOGRAPH_FORK_ROOT;
  else process.env.KINETOGRAPH_FORK_ROOT = originalForkRoot;
  process.chdir(originalCwd);
  await rm(temporary, { recursive: true, force: true });
}
console.log(`passed ${count} checks`);
