# Review deletion — proposed gate manifest (not executed)

Implementation-only candidate. No new test code or test execution is authorized
by this document. Test-merit-gate must approve representatives and invocation
allocation first. Existing regression runs remain separate.

## Fixture / commit policy

Every writable fixture is an isolated temporary project; set TRACE_VIEWER_CONFIG
and sessions directory inside it, never point destructive requests at private
vaults. Each record below has `trace:"t"`, `title:id`, `body:"body "+id`,
`refs:[]`, `ts:"2026-01-01T00:00:00Z"`; `f` denotes finding, `r` review.
An omitted target list means omitted supports. Write records in stated order
with JSON.stringify(record)+LF unless exact bytes are supplied. Snapshot means
the exact full original record object. Compare complete JSONL and sidecar state,
not only HTTP success. Precommit failure injection belongs at the internal
filesystem boundary in the isolated process, not in a production HTTP knob.
Only rename is the JSONL commit point; reservations may grow on a failed commit.
Chrome absence is an invalid/unexecuted browser representative, not a pass.

## Proposed logical representatives (12 total)

1. **promotion-order-multiplicity** — pure graph equivalence for chains, shared
   parents, unrelated target multiplicity and non-review preservation. Input file
   order: `f1,f2,f3,r1->[f2,f1,f2],r2->[r1,f3],r3->[f3,r2,f3,r1],r4->[f1,f1]`;
   select r1,r2. Assert no conflicts; exactly one change r3 with before
   `[f3,r2,f3,r1]`, after `[f3,f2,f1]`; r3 identity/body unchanged; r4 supports
   remain `[f1,f1]`; all non-review objects unchanged; committed order
   `f1,f2,f3,r3,r4` with no selected records.
2. **promotion-cycle-self-and-trace-level** — termination and empty closure.
   Input `f1,r1->[r2,r3,f1],r2->[r1],r3->[r1,r3],r4->[r5],r5->[r4],r6->[r4]`;
   select r1,r2,r4,r5. Assert r3 after `[f1,r3]` (existing self retained, no new
   self inherited), r6 after `[]` and persisted without supports, selected records
   absent, surviving order `f1,r3,r6`. Pure planner must finish without recursion
   loop; unchanged bodies match byte-for-byte strings.
3. **protected-conflicts-individual-resolution** — direct non-review boundary.
   Input `f1->[r1,r1],r1,r2,r3->[r2]`; select r1,r2. Assert only r1 has Protected
   conflict; commit returns 409 with original JSONL unchanged. Preview with only
   r2 keeps r2's original snapshot, removes r1 conflict, changes r3 to trace-level;
   confirm deletes only r2 and retains f1's two raw supports and r1.
4. **selected-snapshot-conflicts** — distinguish selected changes from unrelated
   revisions. Stage snapshots r1,r2 in `f1,r1,r2,r3->[r1]`. Separate isolated
   variants: change r1 body to `edited`; remove r1; replace r1 kind with finding.
   Assert refreshed preview identifies only r1 respectively as changed,
   disappeared, non-review; r2 remains selected with original text. Commit never
   skips r1. Removing just r1 from selection permits r2 deletion, preserves the
   current r1 variant exactly, and recalculates effects to none.
5. **raw-revision-authorization-scope** — exact-preview binding. Two loaded vaults
   A/B each contain traces t/u with identical `f1,r1,r2`. Preview A/t selecting
   r1. Assert revision equals SHA256 of exact bytes. Change only whitespace in
   A/t's f1 line: old commit returns 409, bytes unchanged, new revision/token,
   no item conflicts; reconfirm new token deletes r1. In independent fixtures
   use old token against B/t, A/u, selection r2, and reversed `[r2,r1]` after
   previewing `[r1,r2]`: each returns 409, no JSONL effects. Restart server:
   pre-restart token cannot commit and returns refreshed preview.
6. **byte-preservation-and-malformed-fail-closed** — rewrite safety equivalence.
   Exact input first line ` {"id":"f1","trace":"t","kind":"finding","supports":["r9","r9",null],"title":"odd","body":"x"} \r\n`,
   blank `\n`, canonical r1+LF, canonical r2 with no final newline. Delete r1:
   assert output equals original first-line bytes + blank + exact r2 bytes,
   no final newline added. Independent malformed variants append `{bad` after
   r2 or insert `{bad\n` before r1: preview and commit both fail, every original
   byte unchanged, no temp remains; tolerant display reader is not rewrite input.
7. **atomic-precommit-failure** — isolated filesystem failure boundary. Input
   `f1,r1,r2->[r1],r3`; select r1,r3. Force same-directory temp write failure,
   then independently force rename failure immediately before replacement.
   Assert failure response, original JSONL byte equality, both r1/r3 still
   present, r2 original supports/body, no `.trace-*.tmp` or mutation-lock left.
   Reservations may increase. Release fault, obtain a fresh preview, commit:
   exactly r1/r3 gone together and r2 becomes trace-level; no archive copy exists.
8. **durable-id-restart-and-failed-reservation** — allocator state, not live count.
   Seed `r1,r2`; delete r2, restart viewer, append review -> r3, then invoke real
   extension trace_append finding -> f1. Separately fail an append after r4
   reservation, restart, append review -> r5. Assert ledger retains r2/r4, no
   reused identity, counts equal parsed live records, meta.created unchanged.
   Truncate ledger's final LF: next append fails with JSONL unchanged (no reuse).
9. **cooperating-writer-barriers** — two actual processes, not Promise-only queue.
   Seed f1,r1 and obtain r1 deletion preview. Barrier A holds filesystem lock;
   barrier B launches actual extension append and viewer append, both wait.
   Release A: assert both records appear once with distinct IDs and original
   f1/r1 retained; old deletion authorization returns refreshed 409, never drops
   either append. Reconfirm then assert both appends survive deletion. Separate
   barrier holds commit lock while append waits: append's read sees post-rename
   state and allocates a non-reused ID. An old existing lock must time out without
   theft or any JSONL/reservation changes; remove it only after child exit.
10. **writable-browser-staging-navigation** — real Chromium CDP and real writable
    server, not mocked fetch/API. Seed two vaults with t/u and `f1,r1,r2,r3->[r1]`.
    Detail-stage r1/r2: both remain graph-visible, marked staged; JSONL hash stays
    fixed. Preview shows IDs/titles/full text and r3 effects. Unstage r1 in dialog:
    r2 remains selected, r3 effect disappears, bytes unchanged. Cancel dialog;
    cancel navigation preserves batch, accept discard changes trace/vault without
    write. Stage again then reload: unload warning observed, batch absent after
    reload. Confirm r1 deletion: on-disk r1 absent, r3 trace-level, counts/patterns
    reflect JSONL; reopening viewer does not restore r1. Include protected r2
    variant to assert disabled confirm and individual conflict cancellation.
11. **stale-browser-reconfirmation** — same real-server browser fixture, stage r1
    with r3->[r1], open confirmation, then external cooperating append r4->[r1].
    Click confirm: 409 keeps r1 staged and visible, shows r3/r4 changed survivors,
    file unchanged by deletion, requires a second user click. Second click
    deletes only r1, keeps r3/r4 identity/body with trace-level supports. Changed
    selected r1 body variant instead shows individual conflict and no enabled
    confirm until r1 is unstaged; remaining r2 selection stays intact.
12. **mutation-boundary-no-effects** — real HTTP, temp config/vault. For each
    mutation route (vault load, review append, deletion preview, deletion commit),
    use valid body but vary: Host `evil.example:<port>`; Origin
    `https://evil.example`; Origin `null`; content-type `text/plain`. Assert
    respectively 403/403/403/415 and byte-identical JSONL/config/ledger plus no
    new loaded vault/temp/lock. Trusted `127.0.0.1:<port>` without Origin and JSON
    is accepted; same-origin localhost JSON accepted. Commit missing token,
    duplicate selection, empty selection and mismatched snapshot id return 400
    without effects. Assert listen address is 127.0.0.1, not unspecified/public.

## Candidate non-test checks

`cd trace-viewer && npx tsc --noEmit`, JS `node --check` for changed public
sources, `npm run build`, and `git diff --check`. These validate compilation and
asset packaging only, not any behavioral assertion above.
