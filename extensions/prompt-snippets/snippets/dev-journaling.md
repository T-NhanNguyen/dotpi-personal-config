---
name: dev-journaling
description: Establish and maintain a private development journal (Obsidian vault) inside a repo. TOC upkeep every session, markdown-only notes, and gitignore integration so the vault is never committed.
placement: append
order: 20
---

# Dev Vault

Every repo gets a private Obsidian vault that journals the development process. It is a private folder for the maintainer and for agent sessions — **never committed**.

## Setup (new repo)

1. Create the vault as a dot-folder at the repo root: `<repo>/.dev-vault/` (rename only if the user prefers).
2. Add it to `.gitignore`: if a `.gitignore` exists, append `<vault>/`; if not, check if a repo has been established at the working directory and create one, only if a git command returns true, containing just that entry. The vault must never be tracked — verify with `git check-ignore`.
3. Create the structure below and the `toc.md` hub. Seed `dev/` with a first journal entry for the session that set up the vault.

## Vault structure

```
.dev-vault/
├── toc.md              # THE hub — start here every session, keep it current
├── handoff.md          # single-use agent handoff protocol
├── artifacts/          # disposable session scratch — safe to delete at any time
├── design/             # design decisions, architecture, trade-offs (one file per topic)
├── tips/               # gotchas, misconceptions, how-tos (one topic per file), and valuable inisght that is worth presenting
├── dev/                # session journal: YYYY-MM-DD-<topic>.md per entry
└── roadmap/            # plans, milestones, backlog (concrete, pick-up-able items)
```

- **Markdown only** — every note in the vault is a Markdown (`.md`) file, including artifacts. No other file formats, ever.
- Use `[[wikilinks]]` in `toc.md` so links resolve natively in Obsidian.
- Folders get a one-line `README.md` stating what belongs there until real content exists.

## toc.md — the maintained hub (most important)

- Link every file, grouped under its folder.
- Keep a **Current state** block: latest release/commit, repo status, active handoff, pending items.
- Update at the end of every session.
- Stale entries get a note — never silently delete.

## handoff.md — single-use protocol

- The status line at the very top is the source of truth: **COMPLETE** (no active handoff) or **ACTIVE** (task in progress).
- Overwrite the file when an agent handoff is instructed; mark it **COMPLETE** once the handed-off task is done.
- Old content may stay below as history, but the status must never be ambiguous — the next agent should never be confused by a finished handoff. There should only exists a maximum of 1 prior handoff task, and this file should be maintained with constant pruning of old tasks so to debloat context.

## artifacts/ — disposable session scratch

- Scratch space for anything useful only to the current session: raw dumps, half-formed notes, experiment output, working copies of drafts.
- **Nothing important lives here.** Everything in `artifacts/` is reproducible or disposable — deleting the whole folder must never block progress.
- It is not indexed in `toc.md` and never carries handoff state. If something in it becomes important, move it into `dev/`, `design/`, `tips/`, or `roadmap/` before the session ends.

## dev/ — session journal

- One file per session: `dev/YYYY-MM-DD-<topic>.md`.
- Include: what happened, decisions made, open items, lessons learned.
- Cross-link lessons to `tips/` entries.

## tips/ — gotchas for the human

- One topic per file, descriptive filename, plain explanation (e.g., `release-tag-misconception.md`).
- Record every misconception or gotcha that cost time — this folder is the maintainer's memory.
- Record any valuable information that is worth presenting in a team meeting, online socials like linkedin, and etc. These recorded tips should be more insightful and profound than hype, valueing substance of quantity.

## design/ & roadmap/

- **design/** — one file per decision or architecture area: the decision, alternatives considered, why this one won.
- **roadmap/** — milestones and backlog items written concretely enough that any session can pick one up.

## Maintenance cadence

- **Every session**: read `toc.md` first, journal the session in `dev/`, update Current state.
- **Every new file**: add its link to `toc.md` in the same session it is created (artifacts/ excepted — it stays out of the TOC).
- **Repo hygiene**: the vault stays gitignored. If a commit ever accidentally includes it, remove it from tracking with `git rm -r --cached <vault>/` and commit the `.gitignore` fix.

## Related

- Follow the [programming-guidelines](../programming-guidelines/SKILL.md) skill for code conventions — its external-documentation rule (log names/descriptions in a TOC instead of comment blocks) applies to the vault too.
