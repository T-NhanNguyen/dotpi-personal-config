---
name: programming-guidelines
description: Language-neutral programming standards grounded in correctness, explicit contracts, project conventions, practical trade-offs, safe testing, and strict task scope. Use when implementing features, reviewing code, or writing scripts.
placement: append
order: 30
---

# Programming Guidelines

Apply these standards using the language's semantics, idioms, and the project's
constraints. They guide engineering judgment; they do not replace it.

## Philosophy: tools, not religion

Programming languages are tools, not religions. Like any tool, a language has
correct and incorrect ways to use it; used well, it will serve you well.
Understand its strengths, limitations, and failure modes rather than treating
personal preferences as universal truths.

Beware of claims that you should "never do X" and "always do Y." Ask what
property the rule protects, when it applies, and whether another approach
preserves that benefit with fewer costs. Strong defaults are useful when their
reasoning is clear; exceptions need a concrete justification, not ideology.
Correctness, security, defined language behavior, and required contracts are
not optional merely because design preferences admit trade-offs.

## Scope and project setup

- Stay within the requested task. Preserve unrelated code and user changes;
  avoid unsolicited refactors, mass formatting, dependencies, or configuration.
  Raise necessary blockers and material correctness or security concerns.
- Inspect existing documentation, build tools, dependency manifests, runtime
  configuration, and test commands before choosing a workflow. Use the project's
  established environment; use containers when the project calls for them, not
  as a universal prerequisite.
- If no environment is established, use the smallest appropriate workflow.
  Ask before adding substantial setup or making consequential choices. Do not
  expose secrets, overwrite local configuration, or change shared infrastructure
  as an incidental part of the task.

## Contracts, state, and effects

- Make inputs, outputs, preconditions, failure behavior, and caller-visible
  effects understandable. Expose meaningful dependencies through appropriate
  parameters, interfaces, or focused context rather than hidden mutable state.
- Judge mutation by whether it is explicit, controlled, and understandable—not
  by whether it exists. In-place operations can be appropriate when their
  ownership, aliasing, lifetime, and concurrency implications are accounted for.
  Prefer immutability where it clarifies intent or prevents invalid changes.
- Minimize unnecessary shared state and call-order dependencies. Where hardware,
  frameworks, or integration constraints require them, keep access focused and
  document initialization, synchronization, and lifecycle requirements.
- Separate core computation from I/O and other external effects where useful
  for testing and reuse. Use suitable boundaries, callbacks, or interfaces;
  do not require buffering every result or adding layers without a benefit.
- Express invariants with the mechanisms the language can actually enforce.
  Validate untrusted inputs at boundaries and establish valid state through
  construction or initialization. Do not assume a type name proves validity.
  Distinguish recoverable errors from internal invariant violations; assertions
  are not a substitute for required runtime validation.

## Structure and abstraction

- Keep each function focused and its operations at a coherent level of
  abstraction. Extract lower-level details when that improves reasoning, reuse,
  or testing; avoid both mixed-level tangles and meaningless tiny wrappers.
- Prefer one authoritative representation of shared knowledge or policy.
  Similar-looking code is not necessarily the same responsibility: tolerate
  small duplication when abstraction would couple unrelated behavior or obscure
  intent. Consolidate when the shared concept is clear.
- Give meaningful names to domain constants and non-obvious values. Keep them
  near their relevant scope; centralize only genuinely shared configuration.
  Do not move every literal or assertion message into a global constants block.
- Organize files around cohesive responsibilities. Split them when navigation,
  reasoning, or testing becomes difficult—not solely to satisfy a universal
  line-count limit. Follow explicit repository limits where they exist.

## Language idioms and readability

- Follow established project naming, formatting, module, and dependency
  conventions. Where none exist, prefer idiomatic conventions for the language;
  ask only when the choice materially affects the task.
- Use clear, proportionate names and straightforward control flow. Avoid clever
  constructs that obscure intent, but do not replace well-understood idioms
  merely because they differ from another language's style.
- Keep dependencies explicit and remove unused imports or includes. Choose eager
  or deferred loading based on initialization behavior, dependency cycles,
  startup cost, and runtime constraints—not a blanket prohibition.
- Handle resources and errors using the language's appropriate mechanisms.
  Account for cleanup, cancellation, partial failure, and ownership where they
  apply. Do not silently discard failures or weaken required safety checks.
- Format embedded code or generated text so its resulting syntax and whitespace
  are correct. Use suitable language-specific mechanisms only when needed;
  no particular utility is a cross-language requirement.

## Comments and documentation

- Let names and structure explain what the code does. Use comments to explain
  why, non-obvious constraints, invariants, trade-offs, and surprising behavior.
  Avoid restating obvious operations or relying on names alone to document a
  complex contract.
- Document public or non-trivial interfaces in the project's established style,
  including parameters, results, failure modes, side effects, and usage when
  relevant. Use doc comments, external documentation, or both as appropriate;
  neither multiline documentation nor in-code documentation is inherently wrong.
- Keep documentation accurate and close to its authoritative source. Add external
  guides for concepts, setup, and workflows when useful, rather than maintaining
  a separate catalog of every function by default.

## Testing and verification

- Use the existing test framework and relevant checks. Cover meaningful behavior,
  boundaries, failure paths, and regressions introduced by the change.
- Use controlled fixtures, isolated temporary resources, or appropriate
  integration environments. Match isolation to the test: a single shared fixture
  is not universally required. Do not run destructive tests against arbitrary
  user files, production data, or external systems without explicit authorization.
- Prefer efficient, reproducible tooling for repetitive operations when it is
  safer than manual work. Use targeted edits for small changes; automation is a
  means, not a mandate or a requirement for a particular tool.
- Run checks proportionate to the risk and report what actually passed, failed,
  or could not be verified. Support optimization with measurement when practical;
  respect known memory, timing, and other resource constraints from the outset.
