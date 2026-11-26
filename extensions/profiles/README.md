# Project profiles

Open a trusted project and run `/profile` to select or create a local profile. In
PiChamber builds that expose `globalThis.pichamber.control`, you can also use the
**Profile** control in the composer. In the Pi terminal, the footer shows the
profile this session loaded, including `Profile: None`. Run `/profile` to pick
from a list, or `/profile none` to remove the profile.

Your existing install of this repo loads the switcher. It finds local packages
under this checkout's `profiles/` directory, which is ignored by Git. Fresh
checkouts do not ship profiles such as `webdev` or `embedded`; existing local
profiles stay in place. Leave them out of global settings if you want them to
load only when selected.
These profiles don't change `/model-profile` or `/subagent-profile`.

## Manage profiles in the terminal

In `/profile`, press **a** to add, **r** to rename the highlighted profile, or
**d** to delete it. Enter submits the name; Esc cancels. Use 1–40 lowercase
letters, digits, or dashes, starting with a letter or digit. `none` is reserved.
A new profile starts with just a `package.json`; creating it doesn't activate it.

Rename moves the whole folder and preserves its saved filters. Delete removes
all files in the folder after confirmation. Switch away from the profile before
renaming or deleting it. Other projects that point to that folder need to select
a new profile themselves.

## Edit a profile in the terminal

1. Run `/profile` in the interactive Pi CLI. Highlight a profile with **↑/↓**
   (or **j/k**) and press **e**. **Enter** selects the profile instead.
2. The list groups resources by package, extension, or discovery folder. Press
   **Space** to toggle an item or the whole group; a mixed `[~]` group switches
   to all checked. Press **Tab** on a group to fold or expand it. Checked means
   “inherit Pi's normal behavior”; unchecked hides the item in this profile.
3. Press **Ctrl+S** (or **s**) to save and return to the picker. **Esc** goes back
   and asks before discarding edits. Press **Enter** on the profile to apply the
   saved changes, even if it is already active. If another session saved while
   you were editing, Pi refuses the save and keeps your draft open. Reopen the
   editor to start from the latest saved filters.

This is a filter, not an installer. Leave extensions disabled in `pi config`
if you don't want Pi to load them. Tools come from the current session, so
select a profile first to edit its own tools. Skills and prompts come from the
configured packages and loose files for the current project and the profile
being edited. Tools registered by the same extension can be toggled separately;
the extension itself stays loaded, including its hooks and slash commands.
**Pi built-ins** shows core harness tools like `read` and `edit` separately from
extensions. Those tools are still visible and editable, but usually stay on.
PiChamber still switches profiles but does not show the editor.

Saved filters live in `profiles/<name>/filters.json` and are ignored by Git.
Paths inside `profiles/` are relative; other skill and prompt paths can be
machine-specific. Applied
filters are recorded as a generated package under the Pi agent directory's
`profile-masks/`; don't edit or commit its absolute entry in project settings.
Selecting **None** removes the profile and its filter without changing the
normal `pi config` setup.

The command waits for Pi to go idle, updates only the profile and generated
filter entries in the trusted project's `.pi/settings.json` `packages` array,
and reloads the same session. Reapplying the active profile keeps options set
on its package entry by `pi config`. The setting records an absolute path to this checkout; don't commit
that machine-specific entry to a shared repo. Another open session keeps its
old resources until reloaded. Before its next turn it warns and names the
`/profile` command to run to pick up the new selection.

If the pill is missing, try `/profile webdev` in a trusted project. A build
without `globalThis.pichamber.control` won't show the pill, even if it can run
extension commands. Current upstream PiChamber uses `pichamber.control`, not
the release-candidate `pichamber:composer` event.

## Integration check

From the repo root, run:

```sh
node extensions/profiles/tests/switching.mjs /path/to/pi-coding-agent/dist/index.js
```

This uses real Pi sessions with temporary settings and stubbed composer and
terminal interactions. It needs no model request and doesn't change your
installed Pi settings.
