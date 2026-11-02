# Global model sampling profiles

Run `/model-profile init`, inspect the generated `model-profiles.json`, then run
`/model-profile coding`. This extension never targets every model automatically.

## Commands

| Command | Effect |
| --- | --- |
| `/model-profile` | Built-in selector when UI is available; usage on stderr otherwise. |
| `/model-profile coding`, `writing`, `education` | Apply the named preset to every explicitly configured target. |
| `/model-profile status` | Show disk profile, owned-key count and configuration path; does not verify runtime or endpoint acceptance. |
| `/model-profile init` | Create example configuration without modifying models; never overwrite existing configuration. |
| `/model-profile restore` | Restore only sampling keys owned by this extension, after checking for conflicting edits. |

The package's existing `extensions/*/index.ts` discovery includes this directory.
Restart Pi or use `/reload` after installing it to discover the command. A standalone
copy belongs in the agent directory's `extensions/model-profiles/`. For development,
`pi --extension ./extensions/model-profiles/index.ts` also loads it.

## Configuration

All paths use the host's `getAgentDir()`: normally `~/.pi/agent`, or the directory
selected by `PI_CODING_AGENT_DIR`. The editable configuration is
`<agent-dir>/model-profiles.json`:

```json
{
  "version": 1,
  "targets": [
    { "provider": "openai", "model": "YOUR-EXACT-MODEL-ID" }
  ],
  "profiles": {
    "coding": { "temperature": 0.2 },
    "writing": { "temperature": 0.7 },
    "education": { "temperature": 0.4 }
  }
}
```

`init` uses only the active model as its target, and only when its API is compatible.
Otherwise it creates an empty target list and asks you to add compatible exact IDs.
Applying a profile with missing configuration can seed this same single-model
example; an empty target list is never valid for application. Targets must be
nonempty provider/model ID pairs, unique by pair, and present in the current model
registry. Model IDs are literal, including slashes and colons.

Each of the three profiles must contain at least one supported key. `temperature`
must be a finite number in `[0, 2]`, and `top_p` a finite number in `[0, 1]`.
For example, replace a profile with `"writing": { "top_p": 0.9 }` to use nucleus
sampling instead of temperature. Both keys are supported together, but changing
one knob at a time is easier to evaluate. Preset temperatures are editable starting
choices, not measured optima or guarantees of better coding, writing or teaching.
Endpoint/model constraints can be stricter than this configuration validation.

## Scope and compatibility

The extension changes only
`models.json.providers[provider].modelOverrides[model].samplingParams` keys selected
by the profile. Other sampling keys, model definitions, providers, authentication
and unrelated settings are preserved. It does not change model identity or intended
thinking level. Existing base/provider sampling values still participate in the
host's shallow sampling merge; removing an override may expose a base value.

Only `openai-completions`, `openai-responses` and `azure-openai-responses` APIs are
supported because these host adapters consume raw sampling parameters. **An API
match is not proof that a particular model or endpoint accepts a parameter.**
Unsupported or unknown targets reject the entire operation without configuration
writes. No requests are sent to test sampling acceptance.

Commands wait until the parent session is idle. Applying a preset first refreshes
the registry offline to validate targets against current disk configuration; a
preflight failure changes no profile files. After saving, the registry is
refreshed again with `allowNetwork: false`, registry errors are checked, and a fresh object
for the active model is selected. Thinking is captured and restored because model
selection can change it. A reload failure reports **disk saved, runtime not
confirmed**; it does not undo the disk profile or claim runtime success. Fix the
configuration/registry issue and reload Pi. Host authentication checks during
active-model selection remain in force.

Newly spawned subagents that use this same agent directory reread the shared
`models.json`; they do not inherit the parent's in-memory model object or sampling
state. Their exact provider/model must be targeted to receive the override.
Already-running children and other sessions are not refreshed by this command.
Request-local sampling choices and endpoint behavior can still affect results.

## Persistence and restore safety

- `model-profiles.state.json` stores only each owned key's original presence/value
  and last-applied value, plus the active profile name. Switching first restores
  previous ownership, then applies the next profile. Keys or targets omitted by
  the next profile therefore stop being owned. Restore never replaces a whole
  `models.json` snapshot. Empty structural containers created for overrides may
  remain after restore.
- Before switching or restoring, every owned key must still equal its last-applied
  value. A manual change or deletion blocks the operation without writes. Reconcile
  the edit explicitly before retrying; do not delete the state file unless you
  intentionally abandon automatic restore. Same-value edits cannot be detected.
- Files must be strict JSON. BOM is accepted and preserved in `models.json`;
  comments, trailing commas, malformed JSON and non-object roots are explicitly
  rejected before modification. JSON indentation is normalized to two spaces;
  comments are **not** silently stripped. No comment-preserving editor dependency
  is introduced. Existing JSON values outside owned keys remain unchanged.
- An exclusive `model-profiles.lock` coordinates extension instances. Byte comparisons
  immediately before atomic same-directory renames detect changes by other writers.
  Persistence failures attempt reverse-order rollback only if written content has
  not changed again. There is no cross-file filesystem transaction: crashes between
  renames can leave state/models out of sync, non-cooperating writers can race after
  comparison, and a process crash can leave a stale lock. Remove a stale lock only
  after confirming no command is running. Keep backups for critical configuration;
  inspect both models and ownership state if rollback reports incomplete recovery.
  File permissions are retained; newly created config/state files use mode `0600`.

## Local checks

Tests use isolated temporary directories and the installed host's Jiti loader,
following the subagent test harness convention:

```sh
PI_TEST_HOST=/path/to/@earendil-works/pi-coding-agent \
  node extensions/model-profiles/tests/model-profiles.test.mjs
```

Omit `PI_TEST_HOST` to resolve the global npm installation. The checks cover
preservation, profile cycling, ownership restoration/conflicts, malformed and
commented JSON, BOM, profile validation, target compatibility, locking, and active
model refresh/thinking. They do not contact model endpoints.
