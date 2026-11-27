# Prompt Snippets

Mix-and-match single-purpose prompt rules for the next model-facing submission.
Unlike skills, each snippet is a tiny, standalone instruction — toggle exactly
the ones you want for that submission.

## Usage

- Press **alt+s** or run **/snippets** to open the toggle menu.
  - `up`/`down` to navigate, `space` to toggle, `enter` to apply, `esc` to cancel.
  - `tab` previews the highlighted snippet (name, placement, order, filename,
    and full body; `up`/`down` scroll long bodies). `tab` or `esc` returns to
    the list with your cursor position preserved.
  - The menu is framed with top/bottom border lines and scrolls when the list
    exceeds the viewport (max height adapts to your terminal), with
    `↑ n more` / `↓ n more` indicators when clipped.
- Active snippets show up as a widget above the editor:
  - `↑ prepend: ...` (accent color) — inserted before your message
  - `↓ append: ...` (warning color) — inserted after your message
- For an ordinary message, the first model request keeps the existing layout:
  prepend group → your text wrapped in `<user_inquiry>` → append group. Pi
  expands native `/skill:name` commands and prompt templates before snippets
  are attached, so the fence contains the expanded text.
- A custom submission, including a `/loop` wake, gets a separate
  `<prompt_snippets>` text block before its original content. The prepend group
  comes first, then the append group; both retain their usual ordering. The
  literal slash command is not sent. This also works when the wake is delivered
  as steering during a run.
- Toggles reset to **all off** when the snippets attach and at session start.
  Commands that do not submit a message to the model leave snippets queued.
  Snippets are not written into the session transcript and are not attached to
  later requests (including tool continuations, retries, or subsequent wakes)
  unless you select them again.

## Snippet files

Snippets live in `snippets/` next to `index.ts` — one markdown file each,
with frontmatter:

```markdown
---
name: Concise
description: Keep answers short and to the point
placement: prepend
order: 10
---
Keep your response concise. Skip preamble and unnecessary explanation.
```

| Field | Required | Notes |
|---|---|---|
| `name` | no | Display name; defaults to the filename without `.md` |
| `description` | no | Shown next to the name in the toggle menu |
| `placement` | no | `prepend` or `append` (default: `append`) |
| `order` | no | Number; sorts snippets within their group, in the menu and in the applied text (default: `9999`, ties broken by name) |

Files are re-scanned when the menu opens and when selected snippets are about
to attach, so edits take effect immediately — no `/reload` needed for snippet
body edits.
