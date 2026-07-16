# FormCrash Lab product thesis

**Status:** Product direction for the next implementation slices  
**Scope:** Product definition and planning only  
**Repository baseline:** Current `main` behavior after server-owned request and assertion recommendation  
**Next implementation chunk:** Outcome Check capture and persistence for one recorded state-changing journey

## Status labels

- **Existing behavior** — available in the current repository and reachable through the current external-project workflow unless stated otherwise.
- **Missing behavior** — required by this thesis but not implemented.
- **Product decision** — a scope or design choice locked by this document.
- **Deferred behavior** — deliberately excluded from the first credible product.

## 1. One-sentence product definition

> FormCrash stress-tests state-changing browser journeys and proves whether the intended user-visible outcome remains correct under repeated actions and controlled failures.

**Product decision:** FormCrash is a focused resilience-testing product for consequential browser actions. It is not a general browser automation platform, a Playwright replacement, a generic no-code testing suite, an observability platform, or an AI testing agent.

The product should organize every experiment around one chain:

```text
Critical journey
→ critical action
→ intended business outcome
→ controlled failure
→ proof that the intended outcome remained correct or failed
```

Request scoring, assertion provenance, browser ownership, and architecture centralization support this chain. They are not the product a developer is buying or opening FormCrash to use.

## 2. Primary user

**Product decision:** The primary user is a frontend or full-stack developer responsible for a state-changing web workflow.

Typical journeys include creating a tenant, adding a visitor, submitting an order, booking an appointment, saving account settings, sending a payment, creating a support request, or confirming a destructive action.

This developer:

- Understands browser behavior, HTTP requests, frontend state, and basic automated testing.
- Can read a Playwright test and can usually debug a failed locator or request.
- May already use Playwright for happy-path regression tests, test important paths manually, or ask a coding agent to generate test code.
- Is responsible for deciding whether a workflow is safe to release, even when frontend and backend protections are owned by different people.

Their current process is frustrating because the hard part is not Playwright syntax. The hard parts are deciding which resilience case matters, reproducing timing-dependent behavior, choosing proof that represents the intended outcome, preserving evidence, and replaying the same failure after a fix.

They open FormCrash when a normal workflow works and they need a defensible answer to a narrower question:

> If a real user repeats this consequential action under uncertainty, does the application still produce the one intended visible result?

QA engineers and engineering leads may consume results, but they are not co-equal primary users in the MVP.

## 3. The exact painful moment

A developer has completed an Add Tenant form or another transactional workflow. The happy path works. They now want to know what happens when the user clicks **Submit Tenant** twice, the request is slow enough to invite another click, the connection becomes uncertain, or the user retries because the interface did not respond clearly.

A happy-path test proves only that one well-timed action can complete. It usually does not answer:

- Whether the browser can issue the action more than once.
- Whether multiple successful requests create multiple visible results.
- Whether server protection rejects or deduplicates a repeated action.
- Whether the interface shows a truthful final state.
- Whether the same failure can be reproduced after the application changes.
- Whether a failed and fixed run are comparable rather than merely similar.

The painful moment is therefore:

> The developer knows the journey succeeds once, but cannot quickly reproduce a realistic repeated-action failure and prove the final user-visible outcome.

FormCrash should remove the need to design that resilience test from scratch. It should not merely remove the need to type Playwright syntax.

## 4. Canonical end-to-end workflow

**Product decision:** The central acceptance story is an **Add Tenant** create-form journey. Equivalent create-form journeys are supported only when they follow the same product model.

```text
1. Record a successful Add Tenant journey.
2. Name the journey "Add Tenant".
3. Mark or confirm the critical action: Submit Tenant.
4. Define the intended visible outcome.
5. FormCrash identifies the request associated with Submit Tenant.
6. FormCrash recommends the Impatient User repeated-action experiment.
7. FormCrash generates supporting network and interface checks.
8. FormCrash runs the controlled repeated action.
9. FormCrash evaluates the intended outcome.
10. FormCrash explains what happened and what remains unknown.
11. The developer applies a fix.
12. FormCrash reruns the identical compatible experiment.
13. FormCrash compares the failed and fixed results.
```

The intended outcome for the canonical journey is:

```text
Exactly one tenant row containing the run's generated unique email appears.
```

This workflow is the product's primary acceptance story. Features that do not make this path more reliable, more understandable, or easier to repeat are secondary.

## 5. Central product object: Outcome Check

**Product decision:** The next central product object is `Outcome Check`.

An Outcome Check is the user-approved definition of what correct journey success looks like in the browser. It represents developer intent, not merely something FormCrash happened to observe.

### Initial Outcome Check types

The smallest useful initial set is:

1. **Visible element exists**

   ```text
   A tenant-created confirmation panel appears.
   ```

2. **Matching item appears exactly once**

   ```text
   Exactly one tenant row containing
   formcrash+abc123@example.test appears.
   ```

3. **Final pathname matches**

   ```text
   The journey ends at /tenants.
   ```

`Matching item appears exactly once` is mandatory for the canonical Add Tenant demonstration because it connects the repeated action to the visible business result. `Visible element exists` and `Final pathname matches` provide narrow confirmation and navigation outcomes without claiming backend knowledge.

**Deferred behavior:** The following browser-visible checks are valuable but are not required in the first Outcome Check slice:

- Visible element does not exist.
- Field value survives retry or reload.
- General text matching outside a selected bounded element.
- Ordered multi-element or multi-page outcome rules.
- Cross-origin or iframe outcomes.

Negative checks are especially easy to misread: an error alert may be absent because the whole result page failed to load. They should be added only after Outcome Checks can report evaluation confidence and compound evidence clearly.

### Outcome Checks versus technical assertions

Technical assertions and Outcome Checks are not interchangeable:

- Assertions are evaluation primitives such as request-count limits, response-status checks, locator visibility, field retention, and URL matching.
- Outcome Checks express what the developer cares about, such as exactly one tenant being visible after submission.
- FormCrash may compile one Outcome Check into several technical assertions and evidence queries.
- Assertion provenance explains how a technical check was recommended or selected. Outcome Check provenance explains which user-approved outcome the run was supposed to prove.

An Outcome Check must remain visible as the primary result even when its implementation uses existing assertion primitives. The UI must not force the developer to reason from assertion IDs or matcher internals back to the intended outcome.

**Product boundary:** FormCrash must not translate a browser-visible row count into an unqualified database-record claim.

## 6. Outcome capture workflow

**Product decision:** The MVP captures Outcome Checks during a **separate successful baseline replay** after the journey has been recorded and saved.

This is preferable to capturing during the original recording because the current recorder closes its browser session when recording stops, recorded steps do not necessarily include the final result element, and a baseline replay can use the same generated runtime values that later identify the experiment result.

The MVP workflow is:

```text
Save successful Add Tenant journey
→ choose "Define expected outcome"
→ FormCrash performs one normal baseline replay with generated unique data
→ FormCrash keeps that replay browser open in outcome-selection mode
→ developer clicks "Mark expected outcome"
→ developer selects the tenant row or confirmation element
→ FormCrash captures a stable locator and bounded non-sensitive fingerprint
→ FormCrash recognizes the generated unique identity value used by this run
→ developer confirms "Exactly one matching item should appear"
→ FormCrash saves the approved Outcome Check
```

The user must approve the Outcome Check type, selected target, readable description, and any dynamic value binding before it is saved.

FormCrash must not silently infer that:

- A selected row represents a tenant rather than another list item.
- A destructive action is safe.
- One successful request equals one created record.
- A visible message represents confirmed backend success.

### Capture safety rules

- Persist the stable locator strategy and a bounded structural fingerprint, not raw page HTML.
- Bind dynamic identity to an approved safe generated-value template where possible, not to one literal run value.
- Do not persist password values, secrets, authentication data, request bodies, or arbitrary surrounding page text.
- Treat text derived from secret variables as sensitive and exclude it from fingerprints, descriptions, events, screenshots metadata, and persisted resolved values.
- Reject or warn on unstable targets that only have obviously dynamic CSS paths, ambiguous matches, cross-origin frames, or content that cannot be safely bounded.
- Explain failure plainly: for example, “FormCrash cannot capture this row reliably because the selector matches multiple dynamic elements.”
- Warn that the baseline replay performs the real state-changing action and may create test data. Existing production confirmation and cleanup warnings remain in force.

Selecting an existing recorded step or locator is insufficient for the canonical workflow because the resulting tenant row normally appears after the critical action and may never have been a recorded action target.

## 7. Evidence hierarchy

FormCrash should use an explicit evidence hierarchy:

| Level | Evidence                        | Example                                                |
| ----- | ------------------------------- | ------------------------------------------------------ |
| 1     | Browser action evidence         | The Submit Tenant action was triggered twice.          |
| 2     | Network evidence                | Two matching `POST` requests succeeded.                |
| 3     | User-visible outcome evidence   | Two matching tenant rows appeared.                     |
| 4     | Explicit backend-state evidence | A configured state probe confirmed two tenant records. |

**Product decision:** The MVP supports Levels 1 through 3 by default.

- Level 1 is already supported by recorded target selection, trigger counts, and ordered events.
- Level 2 is already supported by server-owned request recommendation, network matching, request observations, and network assertions.
- Level 3 is the missing product-defining layer supplied by Outcome Checks.
- Level 4 is deferred and must require an explicit target-specific integration. It is never inferred from HTTP success or visible UI alone.

Every result must separate:

```text
Observed:
- FormCrash triggered Submit Tenant twice.
- Two matching POST requests returned success statuses.
- Two rows matching the generated tenant email were visible.

Conclusion:
- The user-visible Add Tenant operation occurred twice.

Unknown:
- FormCrash did not inspect the database directly.
- FormCrash did not prove whether any hidden duplicate records exist.
```

Conclusions must be traceable to observations. Unknowns must remain visible when the available evidence cannot support a stronger statement.

## 8. Canonical result

The ideal result page leads with the intended outcome, not the runner's internal evaluation structure.

### Outcome

```text
Failed: Add Tenant occurred twice.
```

### What happened

```text
FormCrash repeated the Submit Tenant action.
Two matching POST requests succeeded and two tenant rows matching the
generated email appeared.
```

### Why it matters

```text
A user could accidentally create duplicate tenant records or see duplicate
tenant results after one intended action.
```

The wording must remain evidence-bounded. If only duplicate rows were observed, the result should say “duplicate tenant rows appeared,” not “two database records were created.”

### Suggested checks

```text
Frontend:
Lock the submit action synchronously when submission begins.

Backend:
Use idempotency or an appropriate uniqueness rule for the business operation.
```

Suggested checks are defensive guidance, not a claim that FormCrash found the exact root cause.

### Evidence

The primary evidence section shows:

- Critical action and trigger count.
- Matching network attempts and statuses.
- Outcome Check result and observed match count.
- Relevant before, after, and final screenshots.
- Explicit observed, concluded, and unknown statements.

The technical timeline, assertion IDs, recommendation scores, provenance, matcher configuration, and raw event details belong in a secondary expandable section.

**Existing behavior:** The bundled sample result already demonstrates strong outcome-first language because it has an explicit target-specific created-order probe. The external `ExternalRunResult` remains assertion-first, and Guided diagnosis is derived primarily from network evidence.

**Missing behavior:** External results do not have a persisted Outcome Check result or a general outcome-centered result model.

## 9. Failed-versus-fixed proof

**Product decision:** Before-versus-after comparison is part of the primary product story, not optional reporting polish.

The canonical comparison is:

```text
Before fix:
- 2 successful matching requests
- 2 matching tenant rows
- Outcome Check failed

After fix:
- 1 successful matching request
- 1 matching tenant row
- Outcome Check passed

Result:
Duplicate-submission protection verified
```

### Comparison compatibility

A comparison is valid only when:

- Both runs belong to the same project.
- Both use the same journey, or a compatible journey version whose differences are disclosed.
- Both target the same Critical Action.
- Both use the same failure recipe, trigger count, interval, and continuation behavior.
- Both evaluate the same version of the Outcome Check.
- Both use the same generated-value strategy, even though literal generated values differ by run.
- Any request matcher, assertion, journey, locator, environment, or runtime-configuration difference is disclosed before a conclusion is shown.

An exact journey version match is preferred. A later journey version may be compatible only when the critical action and Outcome Check identities remain stable and the product can enumerate the changed steps or configuration. FormCrash must not label materially different experiments as proof of a fix.

Comparison should prioritize changed outcome evidence, then supporting network evidence, then configuration differences and technical detail.

## 10. Difference from Playwright plus Codex or Claude

Playwright plus a coding agent can:

- Write arbitrary browser tests.
- Inspect application source code.
- Add API or database assertions.
- Build target-specific setup and cleanup.
- Implement precise network interception and failure timing.
- Cover unsupported browser behavior.
- Put tests directly into CI and the application's repository.

FormCrash should not claim broader capability. It should win on a narrower repeated product workflow:

- A persistent catalog of critical state-changing journeys.
- Guided confirmation of the Critical Action.
- Opinionated resilience recipes instead of a blank scripting surface.
- User-approved Outcome Checks.
- Deterministic repeated execution.
- Standardized, durable evidence.
- Failed-versus-fixed proof with compatibility enforcement.
- No requirement to design every resilience test from scratch.

The durable value is the saved relationship between journey intent, action, failure recipe, expected outcome, evidence, and comparison—not the fact that Playwright runs underneath it.

> Without Outcome Checks and before-versus-after proof, FormCrash risks remaining a visual wrapper around Playwright.

## 11. Product boundaries

The MVP will not:

- Replace Playwright.
- Understand arbitrary business semantics automatically.
- Inspect databases without an explicit integration.
- Generate every possible resilience test.
- Test native mobile applications.
- Support arbitrary browser scripting.
- Handle every iframe, popup, payment provider, CAPTCHA, file upload, Shadow DOM target, or multi-tab flow.
- Run against production without warnings and explicit confirmation.
- Use runtime AI or an LLM.
- Guarantee that a suggested fix is the exact root-cause fix.
- Automatically discover safe target-specific cleanup.
- Prove hidden backend state from network or browser evidence alone.
- Support failure recipes beyond repeated submission in the core MVP.

Production execution remains technically possible only behind the current explicit confirmation, but the product should continue to position controlled test environments as the normal and recommended target.

## 12. Core product objects

**Product decision:** The focused object model is:

```text
Project
└── Journey
    ├── Critical Action
    ├── Outcome Checks
    ├── Failure Experiments
    └── Runs
        └── Comparison
```

Object responsibilities:

- **Project:** Controlled target, environment classification, authentication, runtime values, and hooks.
- **Journey:** Versioned successful path through one state-changing workflow.
- **Critical Action:** User-confirmed click or submit whose resilience is being tested.
- **Outcome Check:** User-approved browser-visible proof of correct success.
- **Failure Experiment:** Immutable controlled-failure recipe attached to the Critical Action.
- **Run:** Immutable execution snapshot plus action, network, outcome, event, and screenshot evidence.
- **Comparison:** Compatibility-checked proof across a failed and fixed run.

**Deferred behavior:** Journey Collections are not necessary for the MVP. Named and versioned journeys already exist, and folder organization does not solve the missing outcome proof. Collections should be reconsidered only when real projects have enough critical journeys that retrieval and ownership become a demonstrated problem.

## 13. Smallest credible MVP

The MVP is:

- Record one external state-changing browser journey.
- Save and name the journey.
- Confirm one Critical Action.
- Perform one normal baseline replay.
- Capture one or more user-approved browser-visible Outcome Checks.
- Automatically recommend the associated request.
- Automatically recommend supporting technical assertions.
- Run the Impatient User repeated-submission experiment.
- Evaluate and persist Outcome Check evidence separately from low-level assertion results.
- Explain the result in plain language with observed, concluded, and unknown facts.
- Rerun after a fix.
- Compare compatible failed and fixed runs.
- Preserve screenshots, network observations, events, and immutable experiment evidence.
- Demonstrate the same product story with the bundled Sample Checkout.

**Exact failure boundary:** Repeated submission is the only required failure family. The default recipe is two immediate triggers of the selected critical action. Triple-click and server-duplicate-handling variants may remain available because they already use the same injector, but they are not required to prove the MVP.

**Deferred behavior:** Slow Server, Tunnel Drop, Accidental Refresh, Back-Button Trap, timeout recipes, duplicate tabs, and additional failure families are outside the core MVP.

## 14. Product acceptance criteria

The product thesis is satisfied when:

1. A developer can record an Add Tenant journey.
2. A developer can identify Submit Tenant as the Critical Action.
3. A developer can run a successful baseline replay and select the resulting tenant row as an Outcome Check.
4. The Outcome Check can bind its match to a protected generated unique identity value.
5. FormCrash automatically identifies the most likely associated request.
6. FormCrash creates the repeated-action experiment without manual matcher configuration when recommendation confidence is sufficient.
7. A vulnerable application produces a failed Outcome Check.
8. A fixed application produces a passed Outcome Check.
9. The result distinguishes action evidence, request evidence, visible outcome evidence, conclusions, and unknown backend state.
10. The comparison clearly proves improvement using compatible runs.
11. The complete workflow requires no Playwright code.
12. FormCrash does not claim database facts it did not observe.
13. Sensitive generated and recorded values remain protected through capture, execution, persistence, diagnostics, and screenshots.
14. An unreliable Outcome Check target is rejected or clearly marked as requiring recapture.
15. Runner errors remain distinct from failed application outcomes.

## 15. Implementation implications from the current repository

### Existing behavior retained

- **Existing behavior:** Journey recording and versioned persistence support navigation, click, fill, checkbox, radio, select, and submit actions for supported top-frame same-tab journeys.
- **Existing behavior:** Saved authentication capture and restoration support signed-in journeys.
- **Existing behavior:** Runtime variables, generated templates, guided value overrides, secret redaction, and screenshot masking provide the basis for unique outcome identity.
- **Existing behavior:** Guided mode recommends a compatible click or submit target, though the selection is not persisted as a standalone Critical Action object.
- **Existing behavior:** Server-owned request discovery returns deterministic ranked candidates, confidence, reasons, ambiguity handling, and bounded immutable selection provenance.
- **Existing behavior:** Server-owned assertion recommendation produces network and supported interface checks with persisted selection provenance.
- **Existing behavior:** The external runner replays prior steps, repeats the selected target, observes matching requests, evaluates technical assertions, captures screenshots, persists ordered events, and separates runner errors from failed checks.
- **Existing behavior:** Immutable experiment versions and run snapshots provide most prerequisites for compatibility checking and comparison.
- **Existing behavior:** The bundled Sample Checkout has explicit target-specific backend-state evidence and strong outcome-first result language. It should remain the guaranteed demonstration, not be rebuilt as a generic external journey.

### Existing functionality that becomes secondary

- **Product decision:** Request recommendation scores, reasons, classifications, and selection provenance remain available as technical evidence but do not lead the main workflow.
- **Product decision:** Assertion recommendation and matcher editing remain supporting configuration, primarily in Advanced mode.
- **Product decision:** Raw event timelines, assertion IDs, and screenshot checksums remain inspectable secondary evidence.
- **Product decision:** Guided diagnosis should be rewritten around Outcome Check results rather than expanded as a separate diagnosis product.
- **Product decision:** Advanced arbitrary assertion configuration remains useful but is not the canonical first-run path.

### Missing behavior required by the canonical workflow

- **Missing behavior:** Persistent Critical Action identity and user confirmation associated with a Journey.
- **Missing behavior:** Persistent Outcome Check model with versioning or immutable snapshot semantics.
- **Missing behavior:** A successful baseline replay that can pause in browser element-selection mode after the final state settles.
- **Missing behavior:** Safe browser element selection, stable locator capture, bounded fingerprinting, generated-value binding, and reliability feedback.
- **Missing behavior:** `Matching item appears exactly once` evaluation.
- **Missing behavior:** Outcome Check results persisted separately from low-level assertion results.
- **Missing behavior:** Outcome-centered result contracts and rendering for external runs.
- **Missing behavior:** Explicit observed, concluded, and unknown evidence fields.
- **Missing behavior:** Failed-versus-fixed comparison selection, compatibility validation, persistence/read model, and result UI.

### Deferred functionality

- **Deferred behavior:** Journey Collections, folders, coverage dashboards, and journey-health resources.
- **Deferred behavior:** Additional controlled-failure injectors.
- **Deferred behavior:** Database or API state probes beyond explicit future integrations.
- **Deferred behavior:** Report and Playwright export.
- **Deferred behavior:** External-run SSE, stop control, CI orchestration, cloud execution, and team collaboration.
- **Deferred behavior:** Automatic cleanup discovery.
- **Deferred behavior:** Runtime AI, chat, automated code fixes, or semantic business inference.

### Functionality that should not be rebuilt

- Do not rebuild request scoring or move it back into the dashboard.
- Do not rebuild assertion recommendation as a parallel Outcome Check system.
- Do not replace the current journey recorder, auth restoration, runtime template engine, repeated-action runner, network collector, screenshot store, or immutable run persistence.
- Do not generalize the Sample Checkout's explicit order-state probe into a claim that arbitrary external apps expose equivalent backend evidence.
- Do not create a new diagnosis-centralization chunk unless the work is directly required to render Outcome Check results.

Current repository evidence for these judgments includes:

- [`current-state-audit.md`](current-state-audit.md)
- [`prd.md`](prd.md)
- [`request-recommendation.md`](../architecture/request-recommendation.md)
- [`assertion-recommendation.md`](../architecture/assertion-recommendation.md)
- `apps/server/src/runner/recording`
- `apps/server/src/runner/external`
- `apps/server/src/persistence/external-experiment-repository.ts`
- `apps/dashboard/src/features/projects/components/external-run-result.tsx`
- `apps/dashboard/src/features/run-result/components`
- `packages/contracts/src/schemas.ts`

## 16. Recommended implementation sequence

The next product work should contain no more than four chunks.

### Chunk A — Outcome Check capture and persistence

- Persist one user-confirmed Critical Action for one recorded state-changing journey.
- Add the separate successful baseline replay and outcome-selection mode.
- Capture and save the three initial Outcome Check types.
- Bind safe generated unique values without persisting sensitive text.
- Explain and reject unreliable capture targets.

**Exit condition:** A developer can save “Exactly one tenant row matching the generated email should appear” for Add Tenant.

### Chunk B — Outcome Check execution

- Evaluate Outcome Checks after the repeated-action experiment settles.
- Add exact matching-item count evaluation.
- Persist outcome observations and results separately from technical assertion results.
- Record observed, concluded, and unknown evidence without database overclaiming.

**Exit condition:** Vulnerable and fixed Add Tenant targets produce different persisted Outcome Check results under the same repeated-action recipe.

### Chunk C — Outcome-centered result and diagnosis

- Lead with what happened to the intended outcome.
- Use action and network evidence as supporting proof.
- Present why it matters and bounded frontend/backend checks.
- Move assertion internals, provenance, matchers, and event timelines into secondary detail.

**Exit condition:** A developer can understand the duplicate outcome without interpreting raw assertion or network tables.

### Chunk D — Failed-versus-fixed comparison

- Select two runs.
- Enforce and disclose comparison compatibility.
- Compare Outcome Check, request, screenshot, and relevant configuration evidence.
- Produce a concise proof of improvement.

**Exit condition:** FormCrash can show that the vulnerable Add Tenant run failed and the compatible fixed rerun passed.

Request scoring and assertion recommendation are already implemented and must not reappear as new roadmap chunks. Journey Collections and new failure injectors remain deferred until this four-chunk product loop is complete.

## 17. Final decisions

| Decision                        | Locked choice                                                                                                                                                                                                 |
| ------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Primary user                    | Frontend or full-stack developer responsible for a state-changing web workflow.                                                                                                                               |
| Core problem                    | Proving the final user-visible result when a critical action is repeated or disrupted, not writing browser-test syntax.                                                                                       |
| Canonical journey               | Add Tenant create-form journey.                                                                                                                                                                               |
| Critical action                 | Submit Tenant.                                                                                                                                                                                                |
| Central product object          | User-approved Outcome Check.                                                                                                                                                                                  |
| Outcome capture approach        | Separate successful baseline replay with browser element selection.                                                                                                                                           |
| Initial Outcome Check types     | Visible element exists; matching item appears exactly once; final pathname matches.                                                                                                                           |
| Initial failure recipe          | Impatient User repeated submission, defaulting to two immediate triggers.                                                                                                                                     |
| Default evidence levels         | Level 1 browser action, Level 2 network, and Level 3 user-visible outcome.                                                                                                                                    |
| Explicitly unsupported evidence | Generic database state without a configured integration.                                                                                                                                                      |
| Comparison role                 | Required primary proof, with strict compatibility checks and disclosed differences.                                                                                                                           |
| Journey Collections             | Deferred.                                                                                                                                                                                                     |
| Runtime AI or LLM               | Not used.                                                                                                                                                                                                     |
| Non-goals                       | Playwright replacement, arbitrary scripting, automatic business understanding, native mobile, broad browser edge-case support, production execution without explicit confirmation, and root-cause guarantees. |
| Exact next implementation chunk | **Outcome Check capture and persistence for one recorded state-changing journey.**                                                                                                                            |
