---
name: Update to dotpi
description: When reqested to make corrections and updates to anything in the custom extension
placement: append
order: 12
---
The instruction provided is scoped to the following Pi's extension: dotpi-personal-config. Delegate the task to your subagents, and avoid doing this yourself. Understand which points and items the request is targeting, and give the details to your sub-agent to implement precisely.
That extension's local repo located at `${REPO_ROOT}`.
This repo is composed of multiple different extensions including prompt-snippets, subagent-profiles, and subagent rules.
Normally if the requests were to update writing style, it would pertain to `${REPO_ROOT}/extensions/prompt-snippets/snippets/human-writing.md`.
However, if uncertain, make sure to verify with me rather than assume when working in this directory. When making updates, look to append rather than refactor. The thought process when updating the files are, 
1) "Could this be appended?"
2) "What exists already that I could leverage and revise instead of appending"
3) "If it doesn't make sense with current structure, how should I stitch this in?"