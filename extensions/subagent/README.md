# Portable subagent model and thinking picker

Run `/reload` after installing or changing this extension.

## Session profiles

Use `/subagent-profile muse` to switch all installed user agents in this session.
Each agent keeps its current explicit thinking level. A saved thinking preference
wins over a level in the agent's `model:` suffix. Agents using child thinking
defaults keep that behavior; their actual child-selected level is not known here.
The command does not copy the parent session's thinking level.

Built-in profiles:

| Profile | Model |
| --- | --- |
| `muse` | Muse Spark 1.3 Contributor |
| `gpt` | GPT 6.1 Sol |
| `deepseek` | DeepSeek V4.1 Flash |

- `/subagent-profile` lists profiles and the current selection.
- `/subagent-profile clear` returns this session to configured defaults.
- `/subagent-model list` shows the effective model, thinking, and source.

Activation resolves the actual provider-qualified model ID from the available
registry. It validates every explicit thinking level before writing anything.
Missing or ambiguous models and unsupported thinking levels reject the whole
change. Thinking is never silently raised, lowered, or removed. Project agents,
the parent model, and already-running children are unchanged.

The resolved assignments are a snapshot in a hidden `subagent-profile` custom
session entry, not in global preferences and not in model context. Parallel
sessions in the same directory remain independent. Resume, continue, reload,
and compaction retain the selection. Branch navigation uses the marker on that
branch; forks inherit the selection at the fork point. Clear appends a reset
entry rather than deleting history. Sessions started without disk persistence
keep the selection only while that process lives. Do not open the *same session
file* concurrently in multiple processes; separate sessions are the isolation
boundary.

The inspector and each spawn read the active branch directly, so no lifecycle
cache can carry a choice into another session. A model removed after activation
blocks affected runs with explicit thinking rather than silently choosing a
fallback. Reapply a supported profile or clear it. Newly installed agents not
in a snapshot use their normal defaults until the profile is reapplied.

Optional global configuration in `subagent-models.json` can define additional
model-only profiles and a default for sessions without a selection:

```json
{
  "version": 2,
  "agents": {},
  "profiles": { "backup": "provider/model-id" },
  "defaultProfile": "backup"
}
```

The default remains shared configuration. Use session activation when you want
a stable snapshot that other sessions cannot change. Clear returns to that
default if present, otherwise saved per-agent preferences and agent definitions.
Existing `/subagent-model set` and picker saves still update global preferences;
while a session profile is active, the command warns that it takes precedence.
Profile activation itself never writes the global file.

Commands use notifications in TUI and dialog-capable RPC clients such as
PiChamber, and stderr in headless modes. No custom terminal UI is required.

## Usage

- `/subagent-model`: choose a user agent; labels show its current model and thinking preference.
- `/subagent-model explore`: skip agent selection.
- Choose **Search models…**, enter a filter, then choose a model. Matching is case-insensitive across provider, ID and name; all typed words must match. Blank input clears the filter. If no models match, Search remains available.
- After choosing a specific `provider/model-id`, select its thinking level. Options come from pi's public `getSupportedThinkingLevels()` helper, not a private picker or custom compatibility table.
- Choosing **Use child thinking defaults (may be high)** leaves thinking up to the spawned pi process's settings. It does not read the parent session's thinking level.
- **Use pi default (child settings; thinking may be high)** clears the fixed model and thinking override. This uses the child process's configured defaults, not the parent's current model/thinking.
- **Use agent definition** removes both saved overrides and restores original frontmatter/default behavior.

For predictable low-cost delegation, choose a specific model and an explicit supported level such as `low` or `off`. An explicit level is passed via `--thinking`, taking precedence over global/per-model defaults and model thinking suffixes. Explicit thinking is intentionally paired with a fixed model so compatibility can be checked reliably; choosing a dynamic pi-default model clears it.

The flow uses only built-in `ctx.ui.input`, `ctx.ui.select` and notifications, supporting both pi TUI and dialog-capable RPC clients without custom rendering. Search is a separate input dialog, not live filtering inside a custom terminal list. JSON/print modes cannot open the picker. Canceling any dialog leaves saved preferences unchanged; model and thinking are committed together after the entire flow completes.

## Preferences and safeguards

Preferences live in `<pi agent directory>/subagent-models.json` (normally `~/.pi/agent/subagent-models.json`). Existing version-1 model-only preferences are read unchanged and migrated to version 2 on the next save:

```json
{
  "version": 2,
  "agents": {
    "explore": { "model": "provider/model-id", "thinking": "low" },
    "worker": { "model": null }
  }
}
```

Only installed user agents are listed; project agents are intentionally unaffected. Each invocation reads preferences and refreshes the model registry. Preferences apply to future single, parallel and chain runs, not already-running children. The parent session, global settings and agent Markdown remain unchanged.

Explicit thinking is revalidated against pi's model metadata before spawning. If the selected model disappears or no longer supports the saved level, the run fails with instructions to use `/subagent-model <agent>` again. No automatic clamping or upward thinking escalation is applied. Malformed preferences produce an error rather than being silently overwritten. Old model-only preferences continue using child thinking defaults until the user explicitly configures thinking.

A fixed model must also be available in the child pi process. Providers registered only in the parent session may not be usable there. Model metadata changed by child-specific project configuration can differ from the parent's registry; the child CLI applies its own compatibility rules as well. For consistent behavior, use models available in both contexts and avoid differing capability overrides.

## Tests

```sh
node ~/.pi/agent/extensions/subagent/tests/model-picker.test.mjs
node ~/.pi/agent/extensions/subagent/tests/session-profiles.test.mjs
```

The test harness discovers a global npm pi installation. For another installation layout, set `PI_TEST_HOST` to the installed `@earendil-works/pi-coding-agent` package directory. Production extension code has no machine-specific paths.

Tests use a temporary agent directory, mocked built-in dialogs and real child processes running a fake pi fixture. They do not change real preferences or make provider requests. They cover search, cancellation, native compatibility lookup, legacy migration, independent thinking and CLI flags in all three spawn modes. Live TUI/RPC appearance and actual model-provider requests require manual smoke testing after reload.
