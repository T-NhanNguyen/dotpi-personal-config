---
name: update-dotpi
description: Update the dotpi-personal-config repository from any working directory. Use when the user asks to change this personal Pi package, its extensions, skills, prompt catalog, or subagent rules, including /skill:update-dotpi followed by a change request.
---

# Update dotpi

Apply the user's accompanying request to the **dotpi-personal-config package that contains this skill**, not to the project in the current working directory. Text after `/skill:update-dotpi` is the change request. If no change is specified, ask what to update before editing anything.

## Locate the repository

1. Resolve this `SKILL.md` file's real path, following symlinks. The package root is two directories above its containing `skills/update-dotpi/` directory. Do not infer the target from the shell's current directory or use a hardcoded checkout path.
2. Verify that the root's `package.json` has `"name": "dotpi-personal-config"`. Read its `AGENTS.md` instructions if present and applicable instructions above the root or within the target directories. If the skill was copied out of the package or the target cannot be verified, ask for the authoritative checkout path. Do not guess or clone a different copy.
3. Inspect the target checkout's working-tree status. Preserve unrelated edits. If the installed package is not an editable checkout, ask for the source checkout before changing it.

## Make the requested change

Delegate implementation to subagents rather than implementing it yourself. Give each agent the verified absolute repository root, the precise request, relevant starting files, applicable instructions, and acceptance checks. Set its working directory to that root. If delegation is unavailable or fails, report the blocker instead of silently switching to direct implementation.

This package contains multiple extensions, skills, a prompt catalog, and subagent definitions. Locate the authoritative source before assigning changes. For catalog-backed prompts and agents, edit `prompt-catalog/` sources and regenerate their Markdown mirrors with `npm run build:prompts`; do not edit generated files directly. Writing-style guidance currently comes from `prompt-catalog/sections/files-writing-style.ts`, with its snippet entry in `prompt-catalog/snippets/files-writing-style.ts`. Verify these paths before using them.

Prefer small, additive updates unless the user explicitly requests a refactor. Ask these questions in order:

1. Can the requested behavior be added without restructuring existing behavior?
2. What already exists that can be reused or revised instead of duplicated?
3. If the current structure cannot support it, what is the smallest structural change needed?

If the requested scope or target is unclear, ask the user instead of assuming. Do not install packages globally, change another project's settings, commit, or push unless asked.

## Verify and report

Review the agents' diff against the request. Run the relevant repository checks through the available delegated verification workflow. For prompt-catalog changes, include `npm run check:prompts` and the applicable prompt tests. Report any checks that could not run rather than claiming they passed.

Return the changed file paths, what now works, verification results, and any required `/reload` step. Keep all edits scoped to the verified dotpi checkout, even when this skill was invoked from another project.
