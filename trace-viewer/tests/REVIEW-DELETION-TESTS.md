# Review deletion test intent and verification references

The writing/audit descriptions below are historical, not the current execution
status. Authorized postrepair verification passed **61 viewer + 30 extension +
1 support** rows, including all 12 new representatives and real writable Chrome.
Private evidence: `.dev-vault/tests/dev/2026-11-17-review-delete-postrepair-verification.md`.
No tests were rerun for the subsequent documentation/storage cleanup.

Trace: `trace-review-delete-design`. Binding source:
`.dev-vault/tests/dev/2026-11-17-review-delete-readjudication.md`.
Exactly **12 new logical representatives**, one configuration. No production
changes, dependencies, user-vault writes, or acceptance claims.

## Roster and assertion mapping

`review-deletion.test.mjs` uses the numbered `run(N, ...)` declarations below;
`review-deletion-browser.test.mjs` declares the two named browser representatives.
All variants within a representative are fixed sequential observations, not
additional generated tests.

| # | Representative | Requirement / independent oracle |
|---|---|---|
| 1 | promotion-order-multiplicity | R1: bounded real planner/helper child; exact change tuples, complete survivor objects/order/bytes, unchanged duplicate supports |
| 2 | promotion-cycle-self-and-trace-level | R1: bounded planner/helper child; ordered cyclic closure, existing self preserved, absent supports on rootless survivor |
| 3 | protected-conflicts-individual-resolution | R1/R3: real HTTP 409, exact conflict, retained original r2 snapshot, protected non-review bytes never rewritten |
| 4 | selected-snapshot-conflicts | R3: changed/disappeared/non-review resets; old and refreshed tokens refuse batch, unstage only r1, preserve dangling r3 |
| 5 | raw-revision-authorization-scope | R3: independent SHA256; whitespace, vault, trace, ordered selection, fresh-process secret and post-success replay |
| 6 | byte-preservation-and-malformed-fail-closed | R2: independent Buffer/JSONL oracle; CRLF, blank line, irregular supports, no final LF; separately delimited malformed middle/tail, preview AND prior-token commit fail closed |
| 7 | atomic-precommit-failure | R2/R4: isolated fs temp-write and pre-rename faults; original bytes, cleanup, planned fresh-preview recovery, exact directory inventory |
| 8 | durable-id-restart-and-failed-reservation | R4: real registered extension append and fresh server processes; exact ledger `[r1,r2,r3,f1,r4,r5]`, output `[r1,r3,f1,r5]`, append fault after reservation fsync, seeded meta, truncated-ledger refusal |
| 9 | cooperating-writer-barriers | R4: initialized real extension/viewer child processes; fs IPC acknowledgments plus blocking release pipe, no ordering sleeps; both serializations and unstealable existing-lock timeout |
| 10 | writable-browser-staging-navigation | R5: real writable built server/Chromium/CDP trusted input; graph/timeline marking, individual unstage, dialog and batch cancel, trace/vault guards, native beforeunload, patterns r1/r3 -> r3, restart, protected r2 |
| 11 | stale-browser-reconfirmation | R3/R5: actual cooperating append; real intercepted request barrier, one in-flight request, 409 then explicit second click; changed-selected conflict leaves r2 staged |
| 12 | mutation-boundary-no-effects | R5: four disjoint guard rows, valid commit token, four invalid bodies, >65536-byte body, complete raw/config/ledger/inventory and loaded-roster comparisons, positive controls, actual socket bind |

Declaration map: `review-deletion.test.mjs:15,26,39,52,76,107,125,138,160,199`
correspond respectively to cases **1,2,3,4,5,6,7,8,9,12**;
`review-deletion-browser.test.mjs:16,70` correspond to **10,11**.

## Support and isolation

- `review-deletion-child.mjs` patches filesystem operations only in an isolated
  child before importing real production modules. There are no production fault
  knobs or fake append/HTTP implementations. Synchronous barriers are released
  through stdin, while lock/wait/held/pre-rename events travel over IPC. Writers
  initialize before the lock is acquired so Jiti startup does not consume the
  production two-second contention deadline.
- `review-deletion-support.mjs` owns fresh OS-temp A/B vaults, t/u traces, explicit
  config/sessions/meta, independent raw JSONL decoding, and reverse-order cleanup
  before fixture removal. No environment fallback selects a private trace root.
- `review-deletion-browser-support.mjs` uses installed `CHROME_BIN` (or macOS
  Chrome), native WebSocket and CDP. Required Chromium absence fails locally and
  is classified invalid by the evidence collector, not a passing skip. Polling
  is only endpoint/DOM readiness, never cooperating-writer ordering.
- `review-deletion-evidence.mjs` provides deferred support-only parser/oracle
  self-checks. Literal exact tuples cover nested parent/leaf failures, legacy
  custom failures, diagnostics vs TAP, skips, missing/duplicate/incomplete
  output, fixed JSONL key order/types and summary/rollup reconciliation. These
  self-checks are not run at import and are not a 13th feature representative.

## Command integration (gate owns all execution)

The existing `trace-viewer/package.json` script already discovers both new
`*.test.mjs` files with `node --test tests/*.test.mjs`; no script change or new
per-file build hook is needed. Existing server tests retain their build-at-import
behavior. All existing assertion intents are untouched.

The normal viewer test command is `cd trace-viewer && npm test`, with explicit
compatible `PI_TEST_HOST` and installed real Chrome (`CHROME_BIN` if needed).
This document does not authorize another invocation.

The former ignored runner, fingerprint and postrepair manifest are preserved
byte-exactly as fenced source in
`.dev-vault/tests/review-deletion-private-archive.md`, with SHA256s and a
relocation map. Their original `.mjs`/`.json` copies were removed to keep the
private vault Markdown-only outside `tests/runs`. The archived runner is
historical reproducibility support, not a replacement for `npm test`;
restoration/execution would require separate authorization and its original
path/environment/pins. Do not invoke the removed runner path or refresh frozen
pins merely to bypass a mismatch.

Historical gate protocol: sequential stop on infrastructure/target failure;
no automatic retry or post-repair permission. Bringup had an external <=120s bound;
viewer and extension have internal <=180s child bounds; overall external <=600s.
Bringup verifies the pinned implementation/test/runner hashes, ignored vault,
explicit host/Jiti/exports, installed browser, writable temp config/sessions,
parser/oracle self-checks, local typecheck, one build and JS syntax/whitespace.
It neither installs nor downloads anything. No `--case` selection is offered;
`--all` is mandatory. `--human` writes presentation to stderr only.

Artifacts are ignored `.dev-vault/tests/runs/<timestamp>-review-delete-<target>/`:
`run.log`, full `report.jsonl`, and suite `roster.jsonl` (native results and logical
representatives separately). Task-created run metadata moved losslessly from
`.json` to one-object-per-line `.jsonl`; the archive maps all original paths.
Raw logs, original reports and failed-run evidence remain unchanged.
Only non-pass records and summaries need be sent
to the gate; filtered presentation never removes the full digest. The runner
retains the last five of its own directories per target. Aborted output retains
observed failures and marks missing/unreached results invalid.

Frozen roster: `review-deletion-roster.mjs`. Viewer expects **39 native results**
(12 new + 27 existing, including the nested browser child and server-file result)
and **22 existing legacy server checks**: 61 reporting rows, not 61 feature
representatives. Extension expects **30 existing legacy checks** in the current
source, not the historical 26 from the earlier vault report. Missing nested
browser results/skips block completeness. Existing optional private-dataset
browser omission remains excluded and is not new deletion coverage.

## Historical pre-execution implementation audit

The following records the earlier blocked state. The selector adaptations,
pin refresh and harness-only repairs subsequently landed and passed the linked
postrepair verification; these paragraphs are not outstanding instructions.

The audit corrected counted final labels (`Permanently delete 1 review` /
`Permanently delete 2 reviews`), explicit conflict ID/title/reason text,
single-flight preview/dialog ownership, trusted confirmation, stale callback
scope guards, and review-write/navigation interlocks. Loading a vault now asks
before persisting configuration; same-vault reload cannot carry a batch to a
different default trace. These are implementation changes, not passing tests.

Before execution, the gate/test owner must adapt **existing representatives
10/11 only**: `confirmDisabled` must take and find the exact counted label, and
all `b.button('Permanently delete')` calls must use the exact label for the
current batch. Protected two-item / changed-selected two-item previews expect
`Permanently delete 2 reviews`; after individual unstage and in all one-item
flows expect `Permanently delete 1 review`. Preserve explicit disabled true/false
assertions and trusted CDP clicks; do not use a prefix/regex that ignores count.
Within those representatives, conflict alerts should assert the selected
ID/title as well as the original reason; preserve all existing byte/staging and
409/second-click assertions. No new representatives or runtime allocation.
The browser test selectors have **not** been edited by this scoped audit.

After those test-only edits, refresh the ignored fingerprint from final bytes
(including both changed public files and the browser representative file).
Do not bypass the runner's mismatch guard. Bringup must rebuild `dist` before
the real browser run. Runtime verification remains blocked on those edits and
a separately authorized gate budget; this audit executes no tests/self-checks.

## Historical writing-stage validation and exclusions

Current passing evidence is linked at the top; the following describes only
the original test-writing worker, before execution authorization.

Written only. `node --check` is the only runtime check authorized for this
writing task. No feature test, parser self-check, TypeScript check, build,
server/browser launch, host probe or suite has been executed by this worker.
Execution and observed coverage remain deferred to test-merit-gate.

Exclusions remain those in the binding handoff: power loss/post-rename crash,
noncooperating editors, symlink aliases, alternate browsers/OS/runtime,
unsupported abandoned-lock recovery, general stress/fairness/latency, inherited
dangling pruning and corrupt-ledger deletion. Required browser failures are not
silently replaced by mocked/read-only API evidence.
