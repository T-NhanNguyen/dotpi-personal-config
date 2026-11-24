# Synthetic outage investigation workspace

Run from the repository root (installed `trace-viewer/node_modules` required):

```sh
SAMPLE="$PWD/trace-viewer/examples/full-feature-workspace"
SESSIONS="$(node "$SAMPLE/prepare-sessions.mjs")"
CONFIG_DIR="$(mktemp -d "${TMPDIR:-/tmp}/synthetic-trace-config.XXXXXX")"
TRACE_VIEWER_CONFIG="$CONFIG_DIR/viewer.json" \
  trace-viewer/node_modules/.bin/tsx trace-viewer/server.ts \
  --cwd "$SAMPLE" --sessions-dir "$SESSIONS" --trace ui-design-sample --port 4777
```

Open the URL printed by the server. If the static build is missing, first run
`npm --prefix trace-viewer run build`. Stop with Ctrl-C. The sessions and config
paths above are disposable temporary directories; retain their printed shell
variables if you want to remove them later. No real pi sessions are accessed.
`--cwd` selects only this sample vault; the config override prevents reopening
persisted personal vaults. Do not add personal vaults while exploring this sample.

**Every incident, record, agent, check, transcript, timestamp, and source is
invented.** `verified` means a *fictional* check inside the story, not a check
against any service. The example.invalid URL is deliberately unusable. There
are no credentials, real session IDs, real telemetry, or real deployments.

## Contents and story

`ui-design-sample` has 40 records: 8 findings, 6 decisions, 4 concepts, 4 paths,
9 evidence records, 4 deadends, and 5 synthetic human reviews. A fictional
checkout outage progresses from alert to queue investigation, rejected DNS /
worker / timeout / cache explanations, bounded renewal-lane recommendation,
fake canary, and explicit model limitations. Short bodies, a 1,000-character
body, escaped newlines, Unicode (`α → β`), and markdown-like text exercise
layout without exceeding the 1,200-character body contract.

`ui-design-companion` has 2 records about a separate invented billing incident.
Both traces repeat `renewal-starvation`: 8 records across 2 traces in viewer
Patterns. Pattern groups are vault-wide, not just the selected trace. They
aggregate by `failureClass`, count records and distinct traces, collect agents,
and sort repeat-first. Matching IDs in different traces do not join records.
The third session template is the companion transcript; the secondary outage
session is intentionally present but not the most common session in its trace.

## Data contract (authoritative types: extensions/traces/core.ts)

Each physical line of `trace.jsonl` is one JSON object; embedded newlines are
JSON-escaped. No comments or wrapper array. `meta.json` contains `trace` and
`created` (ISO timestamp); creation time orders trace-list entries, newest first.

| Field | Meaning in this fixture |
| --- | --- |
| `id` | Unique within its trace, with kind prefix f/d/c/p/e/x/r. Not globally unique. |
| `trace` | Directory slug, lowercase letters/digits/dot/underscore/hyphen. |
| `kind` | finding: conclusion; decision: choice and rejected alternative; concept: needed definition; path: ordered narrowing; evidence: source observation; deadend: refuted approach; review: human feedback. |
| `title` | Scan-friendly heading, at most 200 characters. Every fixture heading says SYNTHETIC. |
| `body` | Explanation, at most 1,200 characters. All bodies explicitly mark the story synthetic. |
| `refs` | Nonempty source-reference array. These fictional sources deliberately do not resolve. |
| `supports` (optional) | Trace-local target IDs: the current record supports or depends on these targets. An absent or empty list makes no explicit relationship claim. |
| `confidence` (optional) | verified / inferred / unverified; omitted means unspecified, not verified. All four states are present. |
| `check` (optional) | `method` and `output`, with optional `revision`. Verified records have nonempty fictional check output. Some checks omit revision. |
| `steps` (optional) | Ordered `{action, ref}` pairs describing a path's narrowing procedure. |
| `agent` (optional) | Synthetic producer label; reviews use `human`. This is not authentication. |
| `failureClass` (optional) | Stable lowercase slug for pattern aggregation; not an edge or an error severity. |
| `session` (optional) | External session ID used by the server to locate a separate transcript. |
| `ts` | Record ISO timestamp; no user-local date parsing is needed. |

Each ref has `type` and optional `path`, `lines`, `page`, `note` (all strings).
Examples cover file, datasheet, command, url, measurement, and other; the core
interface allows arbitrary type strings, not a closed enum. A measurement ref
includes **all** ref fields; a minimal other ref omits path. `lines` is a range
string and `page` is a document-page qualifier, not a filesystem offset.
`note` explains provenance or fictional status. Check `output` and bodies can
contain escaped multiline text; `revision` is an illustrative label, not a git
commit claim. Optional field omission is intentional.

## Relationships, order, and review

1. Select `d2`. `r1` and `r2` both target it, exercising stacked review branches.
2. Select `r5`: it targets `d6` and `f6`, exercising a multi-target review.
3. Select `r4`: it has no targets and remains on the main sequence.
4. Select `c4`: it has no supports edges in either direction, yet still appears
   in the timeline. Other evidence and decisions exercise fan-in and fan-out.

JSON/API and displayed support edges run **record → supports target**. The
organic layout preserves explicit multi-target, reverse, self, and disconnected
relationships without inventing adjacency edges. This fixture points only to
earlier records, but physical adjacency does not imply support. Disconnected
records still appear on the canvas.

In Review, enter text, optionally enter a failure class, select one or more
targets in the multi-select, and submit. The server appends a human review; the first
80 trimmed characters become its title, the full text becomes its body, and
targets become supports. The graph refreshes after submission; this changes
the fixture file on disk. Reviews are annotations, not edits, approvals with
special powers, or replacements for the original findings. The checked-in
reviews are synthetic data, not actual human approvals. Avoid submitting when
you need a pristine fixture, or regenerate only after intentionally discarding
your sample annotations with `node "$SAMPLE/generate.mjs"` (overwrites fixtures).

## Implemented UI coverage and limits

- Left panel: loaded vault selection, add-by-path / known-vault discovery,
  trace selection and record counts, and repeat-failure patterns. Only the
  isolated sample is loaded initially. Selecting the pattern highlights
  matching nodes and related supports edges; clicking again clears it.
- Canvas: kind-colored nodes, selection, kind/search filters, explicit supports
  arrows, pan/zoom and reset controls. Deep links use `?trace=ui-design-sample`,
  not record IDs. The organic layout does not add sequence-chain edges.
- Inspector: selecting nodes shows body, metadata, refs, supports IDs, check
  output and ordered steps. Session shows role/time/text messages and refresh.
  Review shows required targets/text, optional failure class, and busy/error
  feedback; unsupported comment, resolve and new-record writes are disabled.
- The supplied three-panel layout and responsive styling remain intact.
  Server/data failures have error or notice states. This valid fixture does not intentionally manufacture broken
  API responses. Omitting `--sessions-dir` is **not** a safe missing-session
  demo: it falls back to personal sessions. To see “session unknown”, point it
  at a separate empty temporary directory instead.

`steps` is retained in JSON, returned by the record API, and rendered in the
inspector as ordered-step data. Markdown is displayed as text, not rich markdown; refs
are displayed as text/code, not a source browser. There is no in-viewer JSONL
editor, arbitrary session picker, dedicated confidence filter, or diagram/export
button. Session/ref paths are not portable source links.

The viewer initially **shows** deadends (dimmed). Its Patterns API includes
deadends even when the canvas hides them. Extension `trace_query` reads default
to excluding deadends; set `includeDeadends: true` when comparing to the viewer.
The `trace_query` action `export` copies the full JSONL and optional metadata as
`<trace>.trace.jsonl` and `<trace>.meta.json` to `dest` (it is not a filtered
visible-graph screenshot). The tool operates relative to its current workspace:
use this sample cwd, not a real vault. Export does not bundle external sessions
or referenced sources.

## External session format and selection

`sessions/--synthetic-nonportable-workspace--/` holds three JSONL templates in
the server-supported external format: session header plus entries with `type`,
`id`, `parentId`, `timestamp`, and `message` (`role`, `content`). Content exercises
strings and text/thinking/toolCall/nested-toolResult blocks. These are fictional
raw transcripts, not replayable commands or full reconstructed pi contexts.

The server chooses the most common nonempty `session` on the selected trace
(first encountered wins a tie). It searches the cwd-encoded directory
`--<absolute cwd with separators replaced by hyphens>--`, matching filenames
ending `_<sessionId>.jsonl`; sorted-last match wins. It selects the longest
parentId leaf chain, breaking equal lengths by newest timestamp, and excludes
system messages. Our newer but shorter abandoned branch must not appear;
thinking and tool calls flatten to plain text. Compaction/context edits are not
reconstructed, nor are individual records aligned to transcript messages.

The template directory and header cwd are intentionally fictional and
nonportable. `prepare-sessions.mjs` copies only these templates into a temporary
parent with the **current absolute sample cwd** encoded in the directory name.
It prints that parent for `--sessions-dir`; headers need not be rewritten for
the viewer's lookup. No real session directory is enumerated. Known-vault
discovery depends on actual filesystem paths; the prepared sample can be
recognized, while the original fictional template path cannot.

## Reproduce validation

```sh
node trace-viewer/examples/full-feature-workspace/validate.mjs
node --check trace-viewer/examples/full-feature-workspace/generate.mjs
node --check trace-viewer/examples/full-feature-workspace/prepare-sessions.mjs
node --check trace-viewer/examples/full-feature-workspace/validate.mjs
```

The validator checks schema/lengths/IDs/timestamps/refs, optional-field and
relationship coverage, and the sample-specific earlier-target invariant. It
starts the installed real tsx server on a dynamic port against a temporary copy,
with isolated config and remapped sessions. It checks list/graph/all 42 detail
responses, cross-trace patterns, both selected transcripts, and a review POST
only in that disposable copy. Cleanup runs in `finally`. No fixture is mutated.

Observed output:

```text
Schema/integrity OK: 42 records (40 + 2), 7 kinds, 4 confidence states, 6 ref types.
Server API smoke OK: isolated vault/list, graph, 42 record details, 8 cross-trace patterns, 2 active-branch sessions, temporary human review.
```

Existing extension/viewer test execution is deferred to **test-merit-gate** per
worker policy; no existing-suite output is claimed. Commands for that gate:

```sh
node extensions/traces/tests/traces.test.mjs
node trace-viewer/tests/server.test.mjs
```

## Version-control caveat

The repository ignores `.dev-vault`, including this fixture's trace data.
Do not change ignore rules. Inspect ignored paths with:

```sh
git status --short --untracked-files=all --ignored trace-viewer/examples/full-feature-workspace
```

When a maintainer chooses to stage it, stage ordinary example files normally
and force-add **only** the sample vault (not any real workspace vault):

```sh
git add trace-viewer/examples/full-feature-workspace/README.md \
  trace-viewer/examples/full-feature-workspace/*.mjs \
  trace-viewer/examples/full-feature-workspace/sessions
git add -f trace-viewer/examples/full-feature-workspace/.dev-vault/traces
```

No staging, ignore edits, commits, or application-code changes are part of this
sample implementation.
