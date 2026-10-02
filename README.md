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
    └── worker.md
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
  `~/.pi/agent/agents`). Symlink or copy the bundled `agents/` directory (or its
  files into an existing agents directory) there to use them.
- The bundled `extensions/subagent/` fork loads automatically. Keep any other
  subagent extension disabled, or remove its package entry (for example,
  `pi-interactive-subagents` in `~/.pi/agent/settings.json`). Both extensions
  register a `subagent` tool. Loading two subagent extensions causes a
  **fatal conflict that stops Pi from loading**, not just a warning.
