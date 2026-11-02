# Kinetograph: canonical local setup and recovery

This is the setup, rebuild, and reconnect procedure for the personal Pi package and
its local Kinetograph/audio.cpp integration. The extension selects the fork CLI and
skill **together**. Its installed upstream fallback supports video tools but
**does not provide `audio_narrate`**; the video-maker agent must stop narration
rather than silently use upstream or raw audio.cpp.

## 1. Establish paths and preserve the integration

Use Node.js **22+**, including the Node runtime launching Pi. Set absolute paths
for your checkouts; these examples do not assume the current task directory:

```sh
export DOTPI_ROOT="/absolute/path/to/dotpi-personal-config"
export KINETOGRAPH_FORK_ROOT="$(dirname "$DOTPI_ROOT")/kinetograph"
export AUDIOCPP_ROOT="$(dirname "$DOTPI_ROOT")/audio-v0.9.0-bin-macos-arm64-metal"
```

`KINETOGRAPH_FORK_ROOT` overrides the sibling checkout. `AUDIOCPP_ROOT` must point
to an **existing installed** audio.cpp root; otherwise supply `audio-root` explicitly
for narration. The agent can discover only the named existing sibling above,
anchored to its saved definition's realpath, not an arbitrary working directory.
If neither configured nor present, it asks for the audio directory. No model downloads.

**Recovery warning:** the current integration modifications on local branch
`audiocpp-integration` are not published. Preserve the checkout, branch **and
uncommitted files** in a backup/patch before moving or rebuilding elsewhere.
A branch name alone does not preserve uncommitted work. A plain upstream clone
will NOT restore `build-local.mjs`, `local-cli.ts`, narration code, tests, or the
fork skill. Do not reset or overwrite an existing checkout.

Only if the destination is absent, and cloning is authorized, clone your preserved
local fork (preferred) or upstream as a base:

```sh
# Choose ONE source; do not run against an existing destination.
git clone /absolute/path/to/preserved-kinetograph "$KINETOGRAPH_FORK_ROOT"
# Or, with network authorization:
# git clone https://github.com/0xS4N4TG/kinetograph.git "$KINETOGRAPH_FORK_ROOT"
```

Verify the upstream URL against your original checkout's `git remote -v` before
using it. Restore the preserved integration branch/patch and untracked integration
files before building; upstream alone is insufficient. Never create a remote fork
or push as part of setup. If no preserved integration exists, stop and recover it
from the original machine rather than claiming upstream provides narration.

## 2. Install and build (explicit authorization required)

No startup hook installs dependencies, downloads models, or replaces symlinks.
After authorization, install this personal package's dependencies and build the
restored local integration:

```sh
(cd "$DOTPI_ROOT" && npm install --legacy-peer-deps)
node "$KINETOGRAPH_FORK_ROOT/packages/cli/build-local.mjs"
node "$KINETOGRAPH_FORK_ROOT/.local-cli/cli.mjs" audio narrate --help
```

The peer flag avoids fetching Pi's host-provided packages. The builder installs
pinned registry **0.2.0** dependencies in ignored `.local-cli/`, strictly typechecks
the narration core, and bundles the coupling CLI. It can download npm packages,
not audio models; no Rust build is needed. Do not run the fork workspace's root
`npm install` or `npm run build` for this workflow. Latest upstream CLI source uses
unpublished APIs, so this fork couples its narration to the matching published
renderer and skill. Ignore partially emitted `packages/cli/dist/` files.

If this checkout is not installed in Pi, run `pi install "$DOTPI_ROOT"` with approval.
Agent definitions require a separate link. Inspect
`${PI_CODING_AGENT_DIR:-$HOME/.pi/agent}/agents` first: **preserve an existing link
or directory**. If absent, link it to `$DOTPI_ROOT/agents`; if it already exists,
add only missing individual definition symlinks after inspecting them. Never use
`ln -sf` or replace the existing agents link. See the [root install guide](../../README.md#required-link-the-bundled-subagent-definitions).

## 3. Launch or reconnect Pi

Environment exports must happen **before launching Pi** from that shell. `/reload`
reloads extension/resources but cannot import new environment variables from a
different shell into an already-running process. Restart Pi from the configured
shell after environment changes. For code changes or a completed rebuild with the
same environment, use `/reload`, then inspect `/mcp` and reconnect/restart the
`kinetograph` server there if it retains an old process.

1. Keep built-in MCP enabled. Inspect **kinetograph** in `/mcp` for the selected
   command, source, connection status, and errors.
2. A same-name `kinetograph` entry in `mcp.json` **overrides** extension registration.
   Inspect and intentionally remove/disable an unwanted override; do not overwrite
   configuration automatically. Shell `pi mcp list` does not load extensions.
3. Use `tool_search` with query `audio_narrate` to load/inspect the tool schema
   **without invoking it**. Discovery is not generation authorization. Tools are
   deferred, so not seeing all tool declarations initially is expected.
4. Read `/skill:kinetograph`. The discovered skill must be the fork skill when
   narration is needed. The manifest has no static skill to avoid collisions.

The resolver requires the fork's `.local-cli/cli.mjs`, fork skill, and
`.local-cli/node_modules/kinetograph/dist/cli.js`. If any is missing it warns and
selects the installed CLI/skill pair; **audio_narrate is unavailable**. Report the
missing path and restore/rebuild the fork before narration. A connected server is
not proof that narration, GPU rendering, or every encoder works.

## Exact-file narration and approved video

Use `node "$KINETOGRAPH_FORK_ROOT/.local-cli/cli.mjs" <command>` for **all** fork
commands. Read its `packages/cli/skills/kinetograph/SKILL.md` and the matching
published-runtime references before narration or authoring. Never use npx or a
raw `audiocpp_cli` fallback for fork narration; never guess MCP calls.

Only with synthesis authorization, save the exact narration as UTF-8 and run:

```sh
node "$KINETOGRAPH_FORK_ROOT/.local-cli/cli.mjs" audio narrate \
  /absolute/project/narration.txt --audio-root "$AUDIOCPP_ROOT" \
  --voice alba --output /absolute/project/narration.wav --json
```

CLI `--audio-root` (MCP `audio-root`) overrides `AUDIOCPP_ROOT`. The installed root
needs executable `audiocpp_cli`, `models/PocketTTS-GGUF/english/*.gguf`, and the
selected `embeddings/<voice>.safetensors`. Default voice `alba`, PocketTTS English,
Metal, unchanged token/chunk defaults. Timeout defaults to 540 seconds; MCP
requests have a 600-second timeout. Cancellation reaches the synthesis child.

Success returns absolute `output`, measured `durationSeconds`, `sampleRate`,
`channels`, `textFile`, `textSha256`, `textBytes`, and `voice`. SHA256 proves exact
input bytes, not ASR fidelity. An old output retained after failure is not a new
successful take. Review the script and sound sample **before** composition or video.
After approval, put that **same WAV** in `<Audio>` from `remotion`, using its exact
absolute path or `staticFile` with the same file in `public/` beside the entry.
Use `Math.ceil(durationSeconds * fps)` plus an intentional tail. Run `check` and
`lint`, inspect `still` and `strip`, resolve issues, then `render`. Script/narration
changes require renewed approval. Setup and verification never authorize generation.

## Verification gate (no real synthesis or rendering)

Run only with test authorization, after building the fork and installing personal
package dependencies. These are the exact focused commands:

```sh
(cd "$DOTPI_ROOT" && node extensions/subagent/tests/references.test.mjs)
(cd "$DOTPI_ROOT" && node --experimental-strip-types --test extensions/kinetograph/tests/runtime.test.mjs)
node --test "$KINETOGRAPH_FORK_ROOT/packages/cli/test/narrate.local.test.mjs"
```

The subagent test uses a fake Pi child and the **actual saved** video-maker prompt,
with a neutral task. Resolver tests require the installed fallback and exercise
missing fork CLI, skill, and published runtime independently. Narration tests use
a fake executable, isolated fixtures, and CLI help, not real audio.cpp or a renderer.
`PI_TEST_HOST` can select the installed Pi package for the subagent harness.
Non-test syntax checks: `node --check` on the changed `.mjs` test files and
`node --experimental-strip-types --check extensions/kinetograph/runtime.ts`.

## Rendering requirements and troubleshooting

Rendering needs a supported prebuilt native addon and wgpu-compatible GPU/driver
(Metal on macOS, Vulkan on Linux/Windows). No browser/display is required. FFmpeg
encoding resolves via `KINETOGRAPH_FFMPEG`, the platform package's `bin/ffmpeg`,
then `ffmpeg` on PATH; some codecs require an external executable. Install it only
with approval. Building native code from source additionally needs FFmpeg development
libraries and Rust; the prebuilt workflow does not.

- A `registerMcpServer` warning means Pi needs updating; a CLI warning needs the
  authorized dependency install or restored fork rebuild, not a guessed MCP call.
- `--no-mcp`, disabled built-in MCP, or an addon replacing `/mcp` prevents this
  wiring. No extra MCP adapter or subagent addon is needed.
- For upstream-only video fallback, use the selected installed skill and
  `$DOTPI_ROOT/node_modules/.bin/kinetograph`, not fork authoring instructions.
  Narration remains blocked until the fork is restored.

Kinetograph 0.2.0 uses the **PolyForm Small Business License 1.0.0**. Review upstream
license terms for your use case; this package does not relicense its guidance.
