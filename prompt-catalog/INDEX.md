# Prompt catalog inventory

One entry point per output; each default export lists its named Markdown sections in delivery order. The entry points are collected in [`agentCatalog`](agents/catalog.ts), [`snippetCatalog`](snippets/catalog.ts), and [`referenceCatalog`](references/catalog.ts).

Originals from this migration are retained locally in `.texts.old/`; that directory is ignored. Generated Markdown remains at the existing delivery and reference paths.

Snippet mirrors carry the reserved `prompt-catalog-generated: "snippet-mirror-v1"` frontmatter line. Runtime loads catalog snippets directly and ignores marked Markdown, even after the catalog entry is renamed or removed. `npm run check:prompts` reports leftover mirrors; `npm run build:prompts` removes them. Unmarked Markdown is not pruned or overwritten; an unmarked file occupying a catalog output path must be moved before building.

## Entry points and section exports

### Agents

| Entry point | Section module | Exports (in delivery order) |
| --- | --- | --- |
| [`code-auditor.agent.ts`](agents/code-auditor.agent.ts) | [`code-auditor.ts`](sections/code-auditor.ts) | `auditorRole`, `auditScope`, `auditResponsibilities`, `auditHandoff` |
| [`documentation-reviewer.agent.ts`](agents/documentation-reviewer.agent.ts) | [`documentation-reviewer.ts`](sections/documentation-reviewer.ts) | `documentationReviewerRole`, `documentationReviewResponsibilities`, `documentationReviewHandoff` |
| [`explore.agent.ts`](agents/explore.agent.ts) | [`explore.ts`](sections/explore.ts) | `exploreRole`, `investigationDepth`, `investigationStrategy`, `repositoryReadOnly`, `exploreTracePolicy`, `exploreHandoff` |
| [`test-merit-gate.agent.ts`](agents/test-merit-gate.agent.ts) | [`test-merit-gate.ts`](sections/test-merit-gate.ts) | `testGateRole`, `testGateContext`, `testGatePlanReview`, `testGateExecution`, `testGateOutput` |
| [`test-writer.agent.ts`](agents/test-writer.agent.ts) | [`test-writer.ts`](sections/test-writer.ts) | `testWriterRole`, `testWriterScope`, `testWriterWorkflow`, `testWriterOutput` |
| [`transcript-review.agent.ts`](agents/transcript-review.agent.ts) | [`transcript-review.ts`](sections/transcript-review.ts) | `transcriptReviewInstructions` |
| [`worker.agent.ts`](agents/worker.agent.ts) | [`worker.ts`](sections/worker.ts) | `workerRole`, `workerResponsibilities`, `workerHandoff` |
| [`worker-alt.agent.ts`](agents/worker-alt.agent.ts) | [`worker-alt.ts`](sections/worker-alt.ts) | `alternateWorkerRole`, `alternateWorkerResponsibilities`, `alternateWorkerHandoff` |

### Snippets

| Entry point | Section module | Exports (in delivery order) |
| --- | --- | --- |
| [`ask-questions.ts`](snippets/ask-questions.ts) | [`ask-questions.ts`](sections/ask-questions.ts) | `verifyBeforeActing` |
| [`c-audit.ts`](snippets/c-audit.ts) | [`c-audit.ts`](sections/c-audit.ts) | `strictIncludeAudit`, `c99HeadersAndNames`, `c99ScopeAndTypes`, `c99MacrosAndFormatting`, `c99Comments` |
| [`dev-journaling.ts`](snippets/dev-journaling.ts) | [`dev-journaling.ts`](sections/dev-journaling.ts) | `vaultSetup`, `vaultLayout`, `vaultIndexAndHandoff`, `vaultEvidenceAndNotes`, `vaultMaintenance` |
| [`diagnose-report.ts`](snippets/diagnose-report.ts) | [`diagnose-report.ts`](sections/diagnose-report.ts) | `diagnoseWithoutEditing` |
| [`embedSys-worker.ts`](snippets/embedSys-worker.ts) | [`embedSys-worker.ts`](sections/embedSys-worker.ts) | `requireTargetDetails`, `justifyEmbeddedDesign`, `embeddedImplementationChecklist` |
| [`embedded-debug-swo-itm.ts`](snippets/embedded-debug-swo-itm.ts) | [`embedded-debug-swo-itm.ts`](sections/embedded-debug-swo-itm.ts) | `embeddedDebuggingProcedure` |
| [`files-writing-style.ts`](snippets/files-writing-style.ts) | [`files-writing-style.ts`](sections/files-writing-style.ts) | `humanWritingPrinciple`, `humanWritingRules`, `humanWritingModes` |
| [`make-update-to-dotpi.ts`](snippets/make-update-to-dotpi.ts) | [`make-update-to-dotpi.ts`](sections/make-update-to-dotpi.ts) | `updateDotpiWorkflow` |
| [`orchestrator-mode.ts`](snippets/orchestrator-mode.ts) | [`orchestration.ts`](sections/orchestration.ts) | `verifyCriticalFacts`, `delegateSelectively`, `stopOnSubagentError`, `traceHandoff` |
| [`programming-guideline.ts`](snippets/programming-guideline.ts) | [`programming-guideline.ts`](sections/programming-guideline.ts) | `engineeringPhilosophy`, `projectScope`, `contractsAndEffects`, `structureAndIdioms`, `commentsAndDocumentation`, `testingAndVerification` |
| [`response-instruction.ts`](snippets/response-instruction.ts) | [`response-instruction.ts`](sections/response-instruction.ts) | `explainMissingLink`, `responseVoice`, `terminologyAndCorrection` |
| [`seed-before-implementing.ts`](snippets/seed-before-implementing.ts) | [`seed-before-implementing.ts`](sections/seed-before-implementing.ts) | `seedPurpose`, `seedLoop`, `seedReportShape`, `seedConstraints` |
| [`session-kickoff.ts`](snippets/session-kickoff.ts) | [`session-kickoff.ts`](sections/session-kickoff.ts) | `sessionKickoffChecklist` |

### Preloaded references

| Entry point | Section module | Exports (in delivery order) |
| --- | --- | --- |
| [`test-integrity.ts`](references/test-integrity.ts) | [`test-integrity.ts`](sections/test-integrity.ts) | `testMeritCriteria`, `testPlanning`, `testBudgetsAndOutput`, `testInvocationAndExecution`, `testEvidenceIntegrity` |

## Shared sections

| Section module | Export | Placement |
| --- | --- | --- |
| [`trace-record-policy.ts`](sections/trace-record-policy.ts) | `traceTriggersAndEvidence` | Embedded in `auditHandoff` and `workerHandoff` after the role's handoff instructions, and at the start of `exploreTracePolicy` before `exploreHandoff`. |

The trace triggers and evidence paragraphs are identical across those three agents and form one policy. The following trace attribution, routing, and reporting paragraphs differ by role and stay local, as do test-writer and test-merit-gate's trace instructions. Worker and worker-alt keep their distinct handoffs intact rather than sharing bare headings or individual bullets.

## Profile gating at prompt delivery

[`traceOnly()`](compose.ts) marks catalog text that depends on `trace_append`. Writing, reading, and handoff guidance share that one gate: `trace_query` by itself does not enable trace text. The static build still writes the complete Markdown so it is independent of whichever profile is active during the build. Masking is about catalog text; it does not change tool registration or permissions.

- [User snippets](../extensions/prompt-snippets/index.ts) check the session's profile-filtered active tools when the menu loads and again just before send. Orchestrator mode and Seed before implementing keep their non-trace sections when tracing is off.
- [Subagents](../extensions/subagent/index.ts) start with the masked catalog body and intact references. The [child adapter](../extensions/subagent/catalog-child.ts) restores trace text only if the child's tool selection includes `trace_append` after applying its loaded profile mask. Neither the parent tool list nor a newer profile selection on disk is used. Handwritten agent bodies are not rewritten.
