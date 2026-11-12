# Test integrity reference

## Merit criteria

Require every test to satisfy all five checks:
1. **Bound:** Name a specific requirement, risk, or contract; reject orphan tests.
2. **Classed:** Designate a representative of a named equivalence class, not a Cartesian-product cell.
3. **Integrity-asserting:** Assert an exact outcome, state transition, side-effect absence, or input preservation.
   Reject "it ran without crashing" as an integrity assertion. Assert the contract's semantics, not surface
   shape: check object type and section where they matter, decode one record per line, and compare exact
   tuples rather than names or lookalike fields.
4. **Non-redundant:** Do not re-prove the existing suite or duplicate another test's path.
   Require costly tests to explain why a cheaper test cannot assert the same property.
   A structural assertion nested inside an existing test is part of that test's class and adds no new test or coverage.
5. **Realistic:** Map every injected fault, bad input, or failure mode to a plausible real failure.

Check intent presence, budget counts, and suite duplication before qualitative judgment.
Identify the first failing check; prefer merging duplicates when the underlying risk is real.

## Equivalence classes

Name each class and use one representative per class.
Group incidental input, state, and failure-timing variations that exercise the same path.
Keep the strongest representative; state which cases it subsumes.
Never emit Cartesian products; distinguish meaningful paths such as failure before or after commit.
For sequential behavior, prefer a small script with intermediate observations and conditional steps over redundant flat cases.

## Test plan schema

Establish the change manifest: changed interfaces and behaviors, risk surface, and preserved invariants.
Require a machine-checkable testability manifest: driveable inputs, observable outputs, preconditions, and blind spots.
State missing information or assumptions; do not invent coverage for unknown code.
Identify the known-good boundary; add tests only for new or plausibly newly-risked behavior.
Record these fields for every proposed test:

- **name:** Give the test a specific, auditable name.
- **intent:** State the requirement/risk plus integrity assertion in one line.
- **class:** Name the equivalence class this test represents.
- **asserts:** Specify the concrete check, such as an exact final state or no effects after failure.

Record relevant starting-state assumptions and each dropped or merged candidate's reason.
For harness-only changes, require the actual scoped diff, change intent, and affected existing coverage;
reuse approved, unchanged assertion intents rather than requiring a new semantic test-design cycle.
Changed assertion semantics or newly exposed risks still require adjudication.

## Coverage ledger

List covered behaviors, intentionally uncovered behaviors with reasons, and untestable-by-construction items.
Name the dimensions each assertion collapses — multiplicity, ordering, and cadence — and never claim a collapsed dimension as covered.
Never count uncovered items as passing; correct claims for properties the tests cannot observe.
Name mocked collaborators, disabled integrations, and quarantined tests; subtract these exclusions from claimed coverage.
Do not claim integration coverage from an isolated dependency test.
Update the ledger from what execution actually exercised; identify invalid tests and remaining gaps.
Count logical representatives separately from planned, attempted, and completed executions/configurations.
An omitted configuration (including Debug) remains uncovered unless equivalence is explicitly justified.

## Budgets

Use supplied read, build, test, and execution-time budgets; default to at most 12 new tests.
Require an explicit invocation budget upfront, allocating bring-up, planned execution, and any authorized
post-repair verification. A repair grants neither extra invocations nor authorization to verify it.
Choose the cheapest test that still asserts the integrity property.
Name expensive integration, timing-sensitive, and end-to-end tests; account for setup cost and runtime.
Batch file reads; do not re-read a file already read in the run.
Batch edits and builds; do not rebuild per test unless the test demands it.
Cut lowest-merit tests first when over budget; state what was cut and why.
Report proposed, surviving, and allowed counts plus time/build consumption where relevant.
Never silently exceed a budget or add cases mid-run to pad coverage.
Treat output bytes as a cost: prefer bounded digests and filtered artifact reads over ingesting full logs.

## Test output contract

Design every test runner to emit one JSONL record per case on stdout, one record per line, plus a per-target summary. Never send verbose logs to stdout.

- Per case: `{"case":"<name>","status":"pass"}`, or `"status":"fail"` with `"at":"<file>:<line>"` and `"assert":"<first assertion, one line, truncated>"`, or `"status":"invalid"` with `"reason":"<invalidity reason, one line>"`.
- Per target: `{"summary":{"target":"<target>","kind":"<ctest|binary|python|...>","pass":N,"fail":N,"invalid":N,"report":"<path>","log":"<path>"}}`.
- Cross-target: `{"rollup":{"pass":N,"fail":N,"invalid":N,"targets":N}}`.

Use a fixed key set and order per status/summary variant above; no optional keys within a variant.
Keep each record on one line; never pretty-print. Truncate display text only when full essential evidence
remains recoverable in artifacts; otherwise mark the affected evidence invalid, preserving genuine failures.

The report must reconcile the planned roster with observed cases, configurations, and nested outcomes;
account for missing, duplicate, or incomplete results. Summaries and rollups include invalid outcomes and
separate run completeness from case status; missing/untrustworthy evidence blocks acceptance even when
all observed cases pass. Do not overwrite an observed valid failure to represent incomplete execution.

Write full verbose output to artifacts, never to stdout. Support `--human` to print the readable log for a person, and `--failures-only` to print non-pass records plus the summary for large suites; the complete roster stays in the report artifact.

Store artifacts at `.dev-vault/tests/runs/<timestamp>-<target>/run.log` and `report.jsonl`. Retain the last 5 runs per target and prune older. Never commit them. Keep durable conclusions in `.dev-vault/tests/toc.md`.

Ingest the digest, not the log. Filter artifacts in the shell before reading: `jq 'select(.status!="pass")' report.jsonl`, falling back to `grep` or `python3` when `jq` is absent.

## Invocation rules

Use one runner entry point per target; select cases with `--case <name>` (repeatable) or `--all`. Never poll with sleep or tail, and never read status mid-run.

Use blocking invocations within the explicit allocation; honor the caller's budget, with no fixed default
timeout. If exhausted or aborted, emit the partial digest and artifact paths, retaining historical results.

Isolate cases so one crash cannot suppress the rest, and record each case as it completes. No automatic
reruns or flaky-product retries. Post-repair verification is a distinct, explicitly authorized invocation,
not a flaky-product retry; disclose its scope and retain the original outcomes. If no authorized budget
remains, report the corrected runner as unverified. Never silently retry or assume extra authorization.

## Execution integrity

Require an unambiguous implemented diff and target, explicit test list, and a workspace state that permits a valid run.
Run a bring-up check first: verify the runner works, fixtures are reachable, and the baseline is sane.
Start each test from a defined state: reset fixtures, assert preconditions, and clear leaked state.
Run the smallest sufficient sequence in the specified order; stop on infrastructure failure.
A fail is an observed contract violation under valid preconditions; invalid means untrustworthy or incomplete
evidence. Both block acceptance. Infrastructure failure alone is invalid, not a product pass or fail.
Preserve valid failures if infrastructure breaks later; report run completeness separately.
Record pass evidence, the exact failing assertion, or the invalidity reason for each test.
Label flaky results with evidence; never silently retry into a pass or count flaky results as product coverage.
Control timing, ordering, and external-service dependencies or declare the affected checks integrity-limited.
Keep slow/static checks distinct from at-speed checks; distinguish cheap unit checks from expensive integration checks.
Attribute results and evidence to the correct target when tests span components, services, or environments.

## Oracle and evidence integrity

A failing result is a claim from a tool, not a verdict on the product. Validate the evidence-producing layer before blaming production.

- **Oracle validation:** For any check that parses output, disassembly, symbols, logs, or measurement files, prove the parser on a tiny captured-format sample and assert the exact expected tuples before trusting the real check. A parser self-check supports the product test; it is not itself one.
- **Triage order:** On an unexpected failure, confirm the oracle and parser, then fixture storage and environment, then the test intent and expectations, then production. When the oracle is wrong, fix the oracle, not production or the expected values.
- **Fixture and environment limits:** Treat aggregate storage as part of the test contract. Individually scoped fixtures can still aggregate into one instrumented frame; sanitizer instrumentation, stack/heap limits, and launch hooks can produce failures unrelated to the product. Declare these assumptions, and do not relabel an environment failure as a product bug or a proven hard limit.
- **Evidence preservation:** Keep the original raw failure and its classification. Mark untrustworthy results `invalid` with the reason instead of deleting or rewriting them; never convert a historical failure into a pass because the oracle changed. After a repair, require a fresh run on the affected target; unchanged passing results elsewhere do not substitute.
- **Remove superseded workarounds:** Delete obsolete launch hooks and harness workarounds rather than retaining unverified ones that can mask failures.

## Observation surface

An assertion observes only what its comparison preserves. Name the dimensions an oracle collapses, and treat each collapsed dimension as uncovered rather than passing.

- **Multiplicity.** Set and dict-keyed comparisons absorb duplicates silently. Where duplicate emission is plausible, assert counts or compare a multiset; membership cannot distinguish one record from five.
- **Ordering.** Unordered comparison cannot detect reordering. Where order is part of the contract, assert the exact sequence with intermediate observations rather than sorted or set-valued equality.
- **Cadence.** Content equality cannot observe inter-arrival time, jitter, batching, or deadline adherence; a burst delivered in one window and a steady stream are identical to a content oracle. Assert at-speed behavior from a recorded timestamp series, or declare the check integrity-limited.
- **Recovery paths.** A generator that can only emit valid input leaves rejection and resync logic unexercised, and that logic is usually the most intricate in the component. Require injected malformed, truncated, interleaved, and boundary-split input, and assert the post-recovery state rather than the absence of a crash.
- **Unreachable-branch audit.** Before accepting a suite, ask which branch the generator can never reach. Unreachable branches are uncovered by construction, not covered because the suite is green.
- **Harness self-harm.** A harness that does not drain its own channel can manufacture the losses it reports. Confirm the harness cannot produce the failure it attributes to the product before accepting that finding.
