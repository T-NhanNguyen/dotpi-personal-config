# Test integrity reference

## Merit criteria

Require every test to satisfy all five checks:
1. **Bound:** Name a specific requirement, risk, or contract; reject orphan tests.
2. **Classed:** Designate a representative of a named equivalence class, not a Cartesian-product cell.
3. **Integrity-asserting:** Assert an exact outcome, state transition, side-effect absence, or input preservation.
   Reject "it ran without crashing" as an integrity assertion.
4. **Non-redundant:** Do not re-prove the existing suite or duplicate another test's path.
   Require costly tests to explain why a cheaper test cannot assert the same property.
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

## Coverage ledger

List covered behaviors, intentionally uncovered behaviors with reasons, and untestable-by-construction items.
Never count uncovered items as passing; correct claims for properties the tests cannot observe.
Name mocked collaborators, disabled integrations, and quarantined tests; subtract these exclusions from claimed coverage.
Do not claim integration coverage from an isolated dependency test.
Update the ledger from what execution actually exercised; identify invalid tests and remaining gaps.

## Budgets

Use supplied read, build, test, and execution-time budgets; default to at most 12 new tests.
Choose the cheapest test that still asserts the integrity property.
Name expensive integration, timing-sensitive, and end-to-end tests; account for setup cost and runtime.
Batch file reads; do not re-read a file already read in the run.
Batch edits and builds; do not rebuild per test unless the test demands it.
Cut lowest-merit tests first when over budget; state what was cut and why.
Report proposed, surviving, and allowed counts plus time/build consumption where relevant.
Never silently exceed a budget or add cases mid-run to pad coverage.

## Execution integrity

Require an unambiguous implementation target, explicit test list, and a workspace state that permits a valid run.
Run a bring-up check first: verify the runner works, fixtures are reachable, and the baseline is sane.
Start each test from a defined state: reset fixtures, assert preconditions, and clear leaked state.
Run the smallest sufficient sequence in the specified order; stop on infrastructure failure.
Report infrastructure failure as infrastructure, never as a product pass or fail; mark broken setup or fixtures invalid.
Record pass evidence or the exact failing assertion for each test.
Label flaky results with evidence; never silently retry into a pass or count flaky results as product coverage.
Control timing, ordering, and external-service dependencies or declare the affected checks integrity-limited.
Keep slow/static checks distinct from at-speed checks; distinguish cheap unit checks from expensive integration checks.
Attribute results and evidence to the correct target when tests span components, services, or environments.
