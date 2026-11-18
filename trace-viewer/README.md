# trace-viewer

Static frontend for the live trace vault. Not a pi extension: the traces
extension's `/trace-view` command spawns this server:

```sh
<viewer>/node_modules/.bin/tsx <viewer>/server.ts --cwd <repoRoot> --port 4777 [--trace <id>]
```

The first stdout line is `http://localhost:<port>/?trace=<id>`; the extension
reads that line and opens the URL. Build before launching.

## Layout

- `public/` — canonical HTML, CSS, plain JavaScript, and licensed local fonts.
  The supplied three-panel layout and organic graph are implemented without a
  frontend framework or runtime dependencies.
- `build.mjs` — dependency-free, validated copy of `public/` to `dist/`.
  It clears obsolete output; edit sources in `public/`, not generated `dist/`.
- `server.ts` — `node:http` API and static server over
  `../extensions/traces/core.ts`. `tsconfig.json` checks the server and shared
  imports, not browser JavaScript.
- `tests/` — Node adapter checks against canonical public sources and real-server
  HTTP checks using isolated temporary vaults and sessions.
- `examples/full-feature-workspace/` — explicitly synthetic vault and sessions;
  see its README for an isolated launch and fixture validation.

## Commands

Run inside `trace-viewer/`:

```sh
npm ci
npm run build                    # public/ -> dist/; no bundler
npm start -- --cwd <repoRoot> --port 4777 --trace <id>
npm run dev -- --cwd <repoRoot> --port 4777
npm run preview -- --cwd <repoRoot> --port 4777
npx tsc --noEmit -p tsconfig.json
npm test                         # node --test tests/*.test.mjs
node examples/full-feature-workspace/validate.mjs
```

`start`, `dev`, and `preview` all run the same tsx server CLI; there is no
hot-reload or mock-data server. Rebuild and refresh after changing public assets.
The HTTP asset checks build automatically, so `npm test` also works before the
first manual build. The printed URL uses `127.0.0.1`, matching the IPv4 listener:
`localhost` can otherwise reach a different, stale IPv6 server on the same port.
After server-code changes, reopen with `/trace-view` (or restart the CLI); refreshing
only reloads static assets. A missing deletion-preview API shows recovery guidance
and leaves the current selection staged; navigating to a new server requires restaging.

## Live data and writes

The frontend loads vaults, traces, full record details, supports edges,
vault-wide tagged-record groups, and external session messages through the existing
API. The sidebar calls these **Record tags**: optional labels on reviews and other
records, backed by the existing `failureClass` field (no data migration). Selecting
a tag filters the current trace; expanding its matches lets you browse the vault.
Search/kind filters, graph navigation, session refresh, and review forms
operate on that live data. A successful review POST appends a human review and
reloads graph/detail/pattern data; it does not edit existing records. Unsupported
comment, new finding/decision, resolve, and other write controls remain disabled.
No demo-only server, archive adapter, or bundled mock trace data is used.

Both sidebar and record-panel collapse controls use `public/panel-toggle.js` and
shared edge-tab styles. They hide content without rebuilding it or fetching data,
preserving drafts, filters, and staged deletions. A collapsed sidebar occupies no
width or padding; only its external expand tab remains. Both tabs share the
fullscreen button's responsive dimensions and the Trace Progress `‹` / `›` icons.
The record-panel tab remains available in Graph and Timeline. The `segmented-control` style is shared by the
view switcher and staged-deletion action row.

`--cwd` selects the initial project vault. Additional vaults can be opened by
path or discovered from known sessions; loaded vaults persist in
`~/.pi/agent/trace-viewer.json` (`TRACE_VIEWER_CONFIG` overrides it).
Session transcripts default to `~/.pi/agent/sessions`; override with
`--sessions-dir` or `TRACE_VIEWER_SESSIONS_DIR` for isolated examples/tests.
All cooperating JSONL writers (viewer and extension) use a shared filesystem
lock covering read, durable ID reservation, and append/rewrite; request bodies over
64 KB are rejected with 413. Review submissions change the selected vault on disk.
The server binds only to IPv4 loopback, validates Host and mutation Origin, and
requires JSON for mutations (absent Origin is allowed for trusted-Host clients).

## Permanent review deletion

In **Detail**, stage a review for deletion. Staged reviews remain visible. The
three-column **Undo / Review / Cancel** action row shares the Graph/Timeline
switcher's styling. Undo unstages the selected review when it is staged, otherwise
the most recently staged review; its accessible label identifies the target.
**Review** opens a separate confirmation UI listing selected IDs, titles/text,
individual unstage actions, per-item conflicts, and changed surviving connections. Cancel writes nothing; discard the batch to clear selections.
Trace/vault navigation asks before discarding pending selections. Reload/close
warns using the browser's unload prompt, but staging is ephemeral and is lost.

A non-review directly supporting a selected review protects it from deletion.
Surviving review children inherit all nearest surviving targets through deleted
chains, retaining other targets and deduplicating only rewritten connections.
No surviving target means trace-level review. Non-review records are never
rewritten. Malformed JSONL anywhere blocks mutation rather than losing data.

Internal viewer endpoints (no CLI or agent tool):
- `POST /api/trace/:trace/review-deletions/preview?vault=<loaded path>` accepts
  `{selection:[{id,snapshot:<prior full review record>}]}`. It returns
  `{preview:{revision,authorization,selected,conflicts,changes}}`. Revision hashes
  raw JSONL bytes; each selection is compared against its prior snapshot.
- `POST .../review-deletions/commit` additionally requires `authorization` from
  that exact preview. The token binds vault, trace, ordered selection/snapshots,
  and revision. Under the same filesystem lock, a stale/conflicted commit returns
  409 with a refreshed `preview`; the user must reconfirm, never auto-retry.
  Success returns `{deleted,revision}` after one same-directory atomic rename.

Deletion is permanent: actual JSONL records are removed, without archive/recovery
copies. Unchanged records retain their original bytes. `trace.jsonl.reserved-ids`
contains only durable identity reservations; do not delete it or IDs could be
reused. A failed commit can consume reservations but never partially delete.
After upgrading, restart viewer processes and reload the traces extension in
all Pi sessions before using deletion; older loaded writers do not participate
in the new locking/reservation protocol.
Locks time out after two seconds and are **never stolen**, even if old. After a
crash, stop all writers and inspect before manually removing an abandoned
`trace.jsonl.mutation-lock` directory. The cooperating-writer lock does not
protect against arbitrary external editors; stop them before mutating traces.

Implementation boundaries: shared `extensions/traces/review-deletion.ts` plans
promotion/conflicts, `mutation.ts` owns locked I/O, viewer `review-deletion.ts`
owns authorization/commit, and `public/deletion-confirmation.js` is replaceable
UI without domain or filesystem logic. See [proposed verification manifest](REVIEW-DELETION-PLAN.md).

For a browser asset check, request `/`, `/app.js`, `/organic-layout.js`,
`/style.css`, `/fonts/dm-sans.ttf`, and `/fonts/space-grotesk.ttf`.
Both TTF responses must have `Content-Type: font/ttf`.

## Reading and interaction checks

The dashed spine shows JSONL order only. Solid arrows preserve recorded
`source → target` supports (including repeated entries); position is neither
causal strength nor elapsed time. **How to read / Data check** reports raw and
rendered counts, dangling/filtered entries and exact selected ID pairs. Filters
dim nonmatching graph records and remove nonmatching timeline rows; matching
counts remain visible. Default selection uses actual 100% scale (12px titles).
Fit all is an overview; the adjacent ◎ control returns to a readable selection.
Drag to pan, wheel to zoom, or use progress/previous/next to recenter a record.

The visible single-choice menus are dependency-free listboxes; native selects
remain hidden as the value/change API. Click to open, use arrows/Home/End to
focus choices, Enter/Space to choose, Escape to close, or click outside. Choosing
a discovered vault fills its path and focuses it; **Load vault** is the explicit
next action (no implicit disk write). A single loaded vault still displays its
name and trace count; absence of further discovered vaults is stated explicitly.

`tests/ui-browser.test.mjs` drives real Chromium CDP mouse and keyboard input,
not `onchange` stubs, at 1063×777 and 1512×758. It uses an isolated read-only API
with the 40-record sample and adversarial support entries. It also reads the
local `.dev-vault/traces/frontend-swap/trace.jsonl` when available; otherwise it
prints a diagnostic omitting that private-data case. `CHROME_BIN` overrides the
macOS Chrome default; the browser test explicitly skips if it is absent. No
browser installation or dependency is added. Geometry and existing adapter tests
run without Chrome.

Runtime selectors: `#vaultSelectButton`, `#knownVaultsButton`, `#filterButton`
open menus; their `*Listbox [data-value="…"]` children choose values.
`#matchingcount`, `.node:not(.fade)` and `.timeline-item` expose filter results.
`#clearFilters` resets; `#reset` fits all; `#readable` recenters at 100%.
`#progress [data-step="…"]` selects/recenters a record. `.support-edge` paths
carry `data-source`/`data-target`; `.sequence-edge` paths are never supports.
`#dataCheckContent`, `#details`, `.playback` and `.visual-column` expose counts,
scroll containment and bottom-gap geometry for independent checks.
