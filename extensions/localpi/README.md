# localpi — project-local .pi overrides

Run `/reload` after installing. Project `.pi` resources require trust: run `/trust`, then restart pi.

## Why

When a model provider hits its usage limit mid-session, swap subagents to a
fallback provider without touching global config or thinking levels:

- `/localpi worker "Muse Spark"` — copy repo `agents/worker.md` to
  `<cwd>/.pi/agents/worker.md` with only the `model:` id replaced.
  `:thinking` suffix (e.g. `:medium`) is preserved.
- `/localpi all "provider/model-id"` (alias: `/localpi submodel ...`) —
  localize every repo agent at once. This is the token-limit escape hatch.
- `/localpi subagent` — copy the whole `extensions/subagent/` tree to
  `<cwd>/.pi/extensions/subagent/` unchanged (model queries don't apply).

## Notes

- Shortcuts (exact, no registry lookup): `gpt` → `openai/gpt-6.1-sol`,
  `deepseek` → `deepseek/deepseek-flash`, `kimi` →
  `kimi-coding/kimi-for-coding`, `muse` →
  `meta/muse-spark-1.3-contributor`. Full names/ids still resolve via the
  model registry when available.

- Barebone v1: agents get model-swap; extensions get plain recursive copy.
- Model names resolve via the model registry (exact `provider/id`, id, display
  name, then substring). Unknown names are preserved literally; the child pi
  validates them at spawn time.
- CLI and dialog-capable RPC clients (PiChamber) supported: notify/stderr
  output only, optional `select` disambiguation when interactive.
- Overrides apply after `/trust` + restart. With `agentScope: "both"` (or
  `"project"`), project agents shadow the global ones.
