# dotpi-personal-config

Personal Pi coding-agent configuration packaged as an installable Pi package.

## Install

Install from the local checkout:

```sh
pi install /Users/nhan/ai-workspace/dotpi-personal-config
```

Or, from inside this repository:

```sh
pi install .
```

Install from GitHub:

```sh
pi install git:github.com/T-NhanNguyen/dotpi-personal-config
```

Local installs load in place, without copying files: edits here take effect
after `/reload` in Pi. npm/git installs use copies managed by Pi rather than
loading this working checkout.

### Required: link the bundled subagent definitions

**Installing the package loads the subagent extension, but does not install its
agent definitions.** Without this step, calls to bundled agents such as
`explore`, `worker`, `documentation-reviewer`, or `code-auditor` fail with
`Unknown agent` / `Available agents: none`.

For this local checkout, run once:

```sh
ln -s /Users/nhan/ai-workspace/dotpi-personal-config/agents \
  /Users/nhan/.pi/agent/agents
```

The extension looks for definitions in `${PI_CODING_AGENT_DIR:-$HOME/.pi/agent}/agents`.
The command above uses the default; if `PI_CODING_AGENT_DIR` is set, link into
its `agents` directory instead. This symbolic link points that directory at
the repo's `agents/`, without copying or moving files; edits to the definitions
stay in sync. If your checkout is elsewhere, use its absolute `agents/` path
instead. Keep the checkout in place or update the link if you move it.

If the destination already exists, do not overwrite it: symlink the individual
`.md` definitions to the source package instead. Linking either the directory
or individual definitions lets reviewers resolve the definition's realpath
back to the package and its snippets. If you copy definitions, preserve the
relative paths to their declared references; an explicit package root does not
override reference loading (see below).

## What loads

All bundled extensions are auto-loaded, including `extensions/prompt-snippets/`
and `extensions/subagent/`.

## Layout

```text
dotpi-personal-config/
├── package.json
├── .gitignore
├── README.md
├── extensions/
│   ├── prompt-snippets/
│   │   ├── index.ts
│   │   └── snippets/
│   └── subagent/
│       ├── index.ts
│       ├── agents.ts
│       ├── model-picker.ts
│       ├── README.md
│       └── tests/
└── agents/
    ├── explore.md
    ├── worker.md
    ├── test-writer.md
    ├── test-merit-gate.md
    ├── transcript-review.md
    ├── documentation-reviewer.md
    ├── code-auditor.md
    └── references/
        └── test-integrity.md
```

## Adding resources

| Conventional package path | Resource type |
| --- | --- |
| `extensions/<name>/index.ts` | Extension |
| `skills/<name>/SKILL.md` | Skill |
| `prompts/*.md` | Prompt template |
| `themes/*.json` | Theme |

Pi supports conventional resource discovery. This package's `pi.extensions`
manifest uses `extensions/*/index.ts`, so new extension directories with an
`index.ts` entry point are picked up without editing `package.json`. All
extensions in this repository are intentional and included; the manifest has
no extension exclusions.
Skills, prompts, and themes are discovered conventionally when added to their
respective directories; those directories need not exist until needed.

## prompt-snippets

Press **alt+s** or run **/snippets** to open the menu and toggle prompt rules.
Snippet files live in `extensions/prompt-snippets/snippets/`.

## Bundled agents

| Agent | Role |
| --- | --- |
| `explore` | Read-only codebase reconnaissance with evidence-backed findings. |
| `worker` | Implement changes and write tests; run non-test checks, not the test suite. |
| `test-writer` | Propose intent-bound test plans without approving or executing them. |
| `test-merit-gate` | Adjudicate test plans and serve as the sole test runner. |
| `transcript-review` | Review full YouTube transcripts and make narrowly scoped, source-grounded Markdown edits. |
| `code-auditor` | Audit and correct implementation; delegate test execution to the gate. |
| `documentation-reviewer` | Review, correct, and validate changed documentation against the implementation. |

### Preloaded references

Agent definitions can declare a `references:` frontmatter field:

```yaml
references:
  - ../extensions/prompt-snippets/snippets/programming-guideline.md
```

Before spawning the child, the subagent extension resolves each path relative
to the directory containing the definition's `realpath` (the symlink target,
not the installation link). It preloads each referenced file's body, excluding
frontmatter, into the child system prompt. No `read` tool call is needed for
these references.

Relative paths, including `../`, are allowed. The canonical prompt snippets in
`extensions/prompt-snippets/snippets/` remain the single source of truth;
references point to them rather than copying their guidance. Shared agent-only
references live in `agents/references/`, including `test-integrity.md` for
`test-writer` and `test-merit-gate`. Absolute paths, URLs, and `~` prefixes are
rejected. A missing or unreadable reference is a hard failure before spawn,
not a request for the child to find replacement guidance.

## Review, fix, and verify

Delegate to `documentation-reviewer` or `code-auditor` to inspect changes,
make needed corrections, and arrange relevant verification. Your requested
scope takes precedence. Otherwise, both inspect staged and unstaged changes
plus relevant untracked files. They preserve unrelated user work and do not
commit or push.

| Agent | Work and required snippets |
| --- | --- |
| `documentation-reviewer` | Correct changed docs and READMEs against the implementation using preloaded `human-writing.md`, and validate affected docs. |
| `code-auditor` | Correct implementation loose ends using preloaded `programming-guideline.md` and delegate relevant tests to `test-merit-gate`. Also read and apply `c-audit.md` on demand for C or genuinely C-compatible portions, not all C++ code. |

The extension preloads `human-writing.md` for `documentation-reviewer` and
`programming-guideline.md` for `code-auditor` fresh before each spawn using their
`references:` declarations. Neither reviewer needs to re-read its preloaded
snippet. Missing or unreadable references prevent spawn.

For the on-demand `c-audit.md` read, use an explicit caller-supplied authoritative
package root, or derive it from the installed definition's `realpath` under
`${PI_CODING_AGENT_DIR:-$HOME/.pi/agent}/agents/`. The root is the parent of the
resolved definition's `agents` directory. Snippets live under
`<root>/extensions/prompt-snippets/snippets/`. If that root or the required
on-demand guidance is unavailable, the auditor reports a blocker instead of
using remembered guidance.

`test-merit-gate` is the sole test runner in the normal workflow. `worker`
writes tests but does not execute the suite; it runs non-test checks such as
build, lint, and typecheck. `code-auditor` delegates test execution to the gate
via the `subagent` tool, supplying an implementation reference, an explicit test
list, and a budget. If delegation is unavailable or the gate errors, the auditor
runs the checks itself as a fallback and explicitly reports that fallback.

The gate is the test lead: it keeps a project-local test index at
`.dev-vault/tests/toc.md` for quick suite context, runs tests itself, and
commands `test-writer` through the `subagent` tool only when tests must be
created or revised, passing an explicit scope and budget. `test-writer` stays a
leaf with no `subagent` tool, so the chain cannot recurse; it may also be called
directly by the orchestrator for independent, pre-implementation test design.

Each agent returns changed files, corrections, check results, and remaining
issues or blockers. The code auditor also reports readiness within the audited
scope, supported by verification evidence.

Example requests to Pi:

- “Ask documentation-reviewer to review and fix my uncommitted README changes,
  then validate the affected docs.”
- “Ask code-auditor to audit and correct my uncommitted implementation changes,
  including applicable C interfaces, and run relevant tests.”
- “Ask code-auditor to review, fix, and verify my uncommitted changes using the
  authoritative package root `/Users/nhan/ai-workspace/dotpi-personal-config`.”

## Development loop

Edit files in this repository, then run `/reload` in Pi to reload resources
from the local installation.

## Notes

- Before installing this package, remove any overlapping explicit entries from
  `~/.pi/agent/settings.json`. For example, if `extensions` still lists
  `+extensions/prompt-snippets/index.ts`, both that copy and the package copy
  load, and Pi disambiguates the duplicate command as `snippets:1` and
  `snippets:2`. Drop the old entry so `/snippets` resolves to the package copy.
- `agents/` is **not** a native Pi package resource type. The bundled subagent
  extension discovers user agents from `<agent-dir>/agents` (normally
  `~/.pi/agent/agents`, respecting `PI_CODING_AGENT_DIR`). Symlink the bundled
  `agents/` directory or its files there to use them. If you copy definitions
  instead, preserve their relative reference paths as described above. An
  explicit authoritative package root only helps resolve on-demand guidance;
  it does not override `references:` resolution.
- The bundled `extensions/subagent/` fork loads automatically. Keep any other
  subagent extension disabled, or remove its package entry (for example,
  `pi-interactive-subagents` in `~/.pi/agent/settings.json`). Both extensions
  register a `subagent` tool. Loading two subagent extensions causes a
  **fatal conflict that stops Pi from loading**, not just a warning.
