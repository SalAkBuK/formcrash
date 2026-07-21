# Multi-test local-fixture acceptance

**Status:** Automated acceptance complete for Chunks 1-6  
**Safety boundary:** Local fixtures and headless browser fixtures only. No
Towerdesk or other production target is executed by this acceptance gate.

This matrix is the durable acceptance map for the consolidated Project ->
Journey -> Test -> Run workflow. A green full suite is required in addition to
the focused specifications listed here.

| Capability                                                            | Acceptance evidence                                                                         |
| --------------------------------------------------------------------- | ------------------------------------------------------------------------------------------- |
| Multiple Tests share one Journey and run independently                | `saved-journey-workspace.test.tsx`; `external-routes.test.ts`                               |
| One Test has multiple immutable versions                              | `test-detail-versioning.test.tsx`; `external-persistence-and-auth.test.ts`                  |
| Double-click, triple-click, and server duplicate-handling recipes     | `network-evidence.test.ts`; `external-experiment-panel.test.tsx`                            |
| Visible element, exactly-once item, and final-pathname Outcome Checks | `outcome-check-persistence.test.ts`; `outcome-evaluator.test.ts`; `journey-detail.test.tsx` |
| Every bounded custom browser check                                    | `technical-checks-editor.test.tsx`; `external-runtime-and-assertions.test.ts`               |
| Approved bounded custom network checks                                | `network-evidence.test.ts`; `external-experiments.integration.test.ts`                      |
| Passed and failed canonical verdicts                                  | `schemas.test.ts`; `external-run-result.test.tsx`; `outcome-execution-persistence.test.ts`  |
| Could not verify                                                      | `external-runner.test.ts`; `outcome-evaluator.test.ts`; `external-run-result.test.tsx`      |
| Runner error                                                          | `external-runner.test.ts`; `external-run-result.test.tsx`                                   |
| Historical version URL resolves to stable Test detail                 | `test-detail-versioning.test.tsx`; `external-routes.test.ts`                                |
| One editor, save first, no discovery replay                           | `external-experiment-panel.test.tsx`; `test-builder-navigation.test.tsx`                    |
| Run links back to Project, Journey, and stable Test                   | `external-run-detail-route.test.tsx`                                                        |

## Required commands

Run from the repository root:

```text
corepack pnpm --filter @formcrash/contracts test
corepack pnpm --filter @formcrash/dashboard test
corepack pnpm --filter @formcrash/server test
corepack pnpm typecheck
corepack pnpm lint
corepack pnpm format:check
```

The checklist records the observed counts and any repository-wide baseline
failures for the implementation turn that closes Chunk 6.
