# FormCrash Lab — Product Requirements Document

**Version:** 2.0
**Status:** MVP scope locked
**Hackathon track:** Developer Tools
**Primary platform:** Local web application controlling Chromium
**Runtime AI dependency:** None
**Development workflow:** Built with Codex and GPT-5.6
**Primary demonstration:** Duplicate checkout submission before and after a fix

**Authority:** This document owns product scope and behavior.
[`ui-direction.md`](ui-direction.md) owns application identity and information
architecture. [`active-bugs.md`](active-bugs.md) owns the current behavioral and
verification inventory. Canonical workflows below describe product lifecycle and
acceptance behavior, not mandatory page sequencing.

---

## 1. Product Statement

FormCrash Lab is a persistent pre-production operational application for managing
resilience-testing projects and their transactional web journeys.

It records a normal journey, lets the developer attach a controlled failure experiment to a precise step, and verifies whether the application:

* Preserves user data.
* Prevents duplicate operations.
* Displays an honest error state.
* Allows recovery.
* Reaches the correct final state.

The same experiment can be replayed after a fix to prove that the application now survives the failure.

---

## 2. One-Sentence Pitch

> FormCrash Lab breaks critical web journeys on purpose and proves whether they recover safely.

---

## 3. Product Positioning

FormCrash Lab is not primarily:

* Session replay.
* Production error monitoring.
* Form analytics.
* Conversion analytics.
* A general browser-testing framework.
* A Playwright replacement.
* An AI debugging assistant.

It is:

> **A visual chaos-testing tool for forms and transactional journeys before release.**

### Primary product question

> What happens when this exact journey is interrupted in this exact way?

### Questions answered by adjacent products

| Product category   | Primary question                                                          |
| ------------------ | ------------------------------------------------------------------------- |
| Error monitoring   | What caused this production error?                                        |
| Session replay     | What did this user do before the problem occurred?                        |
| Form analytics     | Where are users abandoning or hesitating?                                 |
| Browser automation | Can this scripted journey complete successfully?                          |
| **FormCrash Lab**  | **Does this journey recover correctly when a controlled failure occurs?** |

---

## 4. Problem

Critical forms are normally tested under ideal conditions:

* The network remains available.
* The user clicks only once.
* Requests complete quickly.
* The page is not refreshed.
* Browser navigation follows the intended sequence.

Real use is less predictable.

Users may:

* Double-click a submission button.
* Refresh after entering information.
* Lose their connection during submission.
* press Back after completing a transaction.
* Click again because a response is slow.
* Return to a stale form state.
* Accidentally repeat a completed action.

These situations can create:

* Duplicate orders.
* Duplicate accounts.
* Lost form data.
* False success screens.
* Irrecoverable loading states.
* Invalid navigation.
* Confusing retry behavior.
* Inconsistent server and interface states.

Developers can already reproduce some of these problems using browser automation and custom scripts. However, doing so usually requires:

* Writing failure-specific test code.
* Manually coordinating timing.
* Inspecting separate logs.
* Building custom assertions.
* Reconstructing the failure for another developer.

FormCrash Lab turns this into a focused product workflow.

---

## 5. Target Users

### Primary user

Frontend and full-stack developers building web applications with transactional journeys such as:

* Checkout.
* Registration.
* Booking.
* Job applications.
* Account onboarding.
* Profile creation.
* Multi-step questionnaires.
* Administrative approval forms.
* Insurance or financial forms.
* Autosave experiences.

### Secondary user

QA engineers who need to reproduce and document resilience failures without manually recreating timing conditions.

### Tertiary user

Engineering teams reviewing whether an important journey is safe to release.

---

## 6. Core User Promise

A developer should be able to:

1. Open a project.
2. Record or select a normal journey.
3. Choose a failure experiment.
4. Attach it to a specific journey step.
5. Define the expected recovery behavior.
6. Run the experiment.
7. Inspect evidence.
8. Apply a fix.
9. Replay the identical experiment.
10. Compare the failed and passed runs.

---

## 7. Primary Jobs to Be Done

### Job 1: Test duplicate protection

> When a user submits an important action repeatedly, I want to verify that only one operation is accepted.

### Job 2: Test data preservation

> When a journey is interrupted, I want to verify that the user does not lose completed work unexpectedly.

### Job 3: Test honest failure handling

> When a request fails, I want to verify that the interface does not display success or remain stuck indefinitely.

### Job 4: Test recovery

> When the failure ends, I want to verify that the user can retry or continue safely.

### Job 5: Prove a fix

> After changing the application, I want to replay the same failure and compare the result with the original run.

---

## 8. Product Goals

### Goal 1: Make failure testing repeatable

A saved failure experiment should occur at the same selected point each time it runs.

### Goal 2: Focus on user-visible recovery

The product should evaluate outcomes such as preserved data, retries, error states and duplicate prevention—not only JavaScript exceptions.

### Goal 3: Make evidence understandable

The result should show the sequence of actions, requests, disruption and checks in one place.

### Goal 4: Reduce test-writing effort

A developer should be able to create a useful resilience scenario through the interface without first writing browser automation code.

### Goal 5: Demonstrate before-and-after proof

The product’s signature workflow is comparing a failed vulnerable run with a successful fixed run using the identical saved experiment.

---

## 9. Non-Goals

The MVP will not include:

* Runtime GPT-5.6 or OpenAI API calls.
* A chatbot.
* Generated bug explanations.
* Automatic code fixes.
* Production user monitoring.
* Real-user session recording.
* Heatmaps.
* Form conversion funnels.
* Marketing analytics.
* Stack-trace monitoring.
* Load testing.
* Security scanning.
* Native mobile testing.
* Safari or Firefox support.
* Cloud test execution.
* Multi-user workspaces.
* CI/CD integration.
* Arbitrary combinations of multiple failures.
* Full compatibility with every website.
* Real payment processing.
* Testing applications the user does not own or control.

---

## 10. Product Principles

### 10.1 Experiments, not recordings

The main product object is a saved failure experiment, not a captured user session.

### 10.2 Recovery, not merely errors

A run can fail even when no exception occurs.

Examples:

* Two orders were created.
* Form data disappeared.
* A retry action was unavailable.
* The interface displayed success after a failed request.

### 10.3 One failure per run

The MVP applies one disruption at a time so the cause and result remain understandable.

### 10.4 Evidence before interpretation

The product should show:

* Recorded actions.
* Requests.
* Responses.
* Screenshots.
* State checks.
* Disruption timing.

It should not rely on vague conclusions.

### 10.5 Exact replay matters

A scenario is valuable only when the same failure can be applied again after the application changes.

### 10.6 The bundled demonstration must always work

Support for external applications is useful, but the sample checkout is the guaranteed judge-testing path.

---

## 11. MVP Definition

The MVP is a locally run dashboard that controls a visible Chromium browser.

The developer can:

* Open the bundled checkout project.
* Use a saved journey or record a new journey.
* Select one of five failure experiments.
* Attach the failure to a specific step.
* Define recovery assertions.
* Run the scenario.
* View a chronological result.
* Replay the same scenario.
* Compare a vulnerable run with a fixed run.
* Export a human-readable report.
* Export a Playwright-style regression-test starting point.

---

## 12. Core Product Loop

This loop defines the lifecycle and relationship among product records. It is not
a required application navigation sequence or an application-wide wizard.

```text
Select or record a normal journey
                ↓
Choose a failure experiment
                ↓
Attach it to a precise step
                ↓
Define recovery expectations
                ↓
Run against the application
                ↓
Inspect evidence and failed checks
                ↓
Apply an application fix
                ↓
Replay the identical experiment
                ↓
Compare failed and passed runs
```

---

## 13. Main Product Areas

FormCrash Lab contains six primary areas:

These are product capability areas, not a mandatory global-navigation or page
sequence specification.

1. Projects.
2. Journeys.
3. Failure Experiments.
4. Recovery Assertions.
5. Test Runner.
6. Results and Comparisons.

---

# 14. Failure Experiments

The MVP includes five named experiments.

---

## 14.1 Impatient User

**Technical behavior:** Trigger the selected action multiple times within a short interval.

### Purpose

Detect whether repeated user actions create:

* Duplicate requests.
* Duplicate orders.
* Duplicate accounts.
* Duplicate records.
* Conflicting interface states.

### Configurable values

* Number of triggers: 2 or 3.
* Interval: immediate, 100 ms or 300 ms.

### Typical target

* Submit Order.
* Create Account.
* Confirm Booking.
* Save Application.

### Expected safe behavior

* Only one operation is accepted.
* The action becomes unavailable after the first valid trigger.
* Only one confirmation result appears.
* Repeated requests are rejected or ignored safely.

---

## 14.2 Tunnel Drop

**Technical behavior:** Disable the browser network immediately before or after a selected action.

### Purpose

Verify whether the application:

* Preserves entered information.
* Displays a meaningful error.
* Avoids showing false success.
* Provides a retry path.
* Recovers when the connection returns.

### Configurable values

* Disconnect before action.
* Disconnect immediately after action.
* Restore automatically after 3, 8 or 15 seconds.
* Keep offline until the run ends.

### Expected safe behavior

* The user sees a clear failure state.
* Entered data remains available where expected.
* No false confirmation appears.
* Retry becomes available.
* No duplicate record is created after reconnection.

---

## 14.3 Slow Server

**Technical behavior:** Delay a selected request.

### Purpose

Verify whether the application:

* Displays progress.
* Prevents repeated submission.
* Handles timeouts.
* Avoids stale results.
* Remains recoverable.

### Delay options

* 3 seconds.
* 8 seconds.
* 15 seconds.

### Expected safe behavior

* A visible processing state appears.
* Duplicate actions are prevented.
* The final response is handled once.
* A timeout produces a clear recoverable state.

---

## 14.4 Accidental Refresh

**Technical behavior:** Refresh the page at a selected journey point.

### Purpose

Verify whether:

* Completed fields are retained.
* The correct step is restored.
* The journey restarts safely.
* Uploaded or entered information disappears unexpectedly.
* The application returns to an invalid state.

### Expected behavior options

The scenario author selects one:

* Restore the current step.
* Preserve selected field values.
* Restart safely.
* Warn before discarding information.
* Return to a defined recovery page.

---

## 14.5 Back-Button Trap

**Technical behavior:** Activate browser Back at a selected point.

### Purpose

Verify whether:

* The visible step matches browser history.
* Previously entered data remains consistent.
* A completed transaction can be repeated.
* Confirmation pages can incorrectly return to submission.
* Forward navigation creates duplicate actions.

### Expected safe behavior

* The browser and application states remain consistent.
* Completed transactions cannot be resubmitted.
* The user is not shown contradictory steps.
* Data remains preserved according to the journey’s rules.

---

# 15. Recovery Assertions

Assertions are the core difference between a generic replay and a FormCrash experiment.

The developer must define at least one expected outcome before a scenario can run.

## 15.1 Duplicate-protection assertions

* No more than one matching request occurred.
* No more than one resulting record exists.
* Only one confirmation message appeared.
* The final action became disabled.

## 15.2 Data-preservation assertions

* A selected field retained its value.
* A selected field was cleared.
* The journey returned to the expected step.
* Previously completed steps remained complete.

## 15.3 Error-state assertions

* A selected error message appeared.
* A success message did not appear.
* A loading state ended.
* A retry control became available.

## 15.4 Navigation assertions

* The final URL contains an expected value.
* The final URL does not contain an invalid value.
* The browser returned to the expected step.
* The journey did not return to the submission screen after completion.

## 15.5 Completion assertions

* The journey reached its final step.
* The journey did not reach its final step.
* The expected confirmation appeared.
* The expected server response occurred.

---

# 16. Epic A — Project Management

## User story A1

**As a developer, I want to create a FormCrash project so that I can organize a target application and its resilience scenarios.**

### Project fields

* Project name.
* Target URL.
* Optional description.

### Acceptance criteria

* The dashboard provides a visible “New Project” action.
* A project requires a name and valid URL.
* Invalid URLs produce a clear message.
* Created projects appear on the dashboard.
* Project data remains available after restarting FormCrash.
* Opening a project shows its journeys and failure experiments.

---

## User story A2

**As a first-time user, I want a complete sample project so that I can understand FormCrash without connecting another application.**

### Acceptance criteria

* A “Sample Checkout” project appears on first launch.
* The sample can run without an external account.
* The project includes a saved checkout journey.
* The project includes a configured Impatient User experiment.
* The sample supports vulnerable and fixed modes.
* Sample order data can be reset.

---

# 17. Epic B — Journey Recording

## User story B1

**As a developer, I want to record a normal journey so that it can be replayed under failure conditions.**

### Supported actions

* Page navigation.
* Click.
* Text entry.
* Checkbox change.
* Radio-button change.
* Dropdown selection.
* Form submission.

### Acceptance criteria

* The user can start and stop recording.
* Recording status is always visible.
* Captured actions appear chronologically.
* The user can name the journey.
* The journey remains available after restart.
* Replaying the journey follows the original action order.
* A failed replay identifies the exact broken step.

---

## User story B2

**As a developer, I want to review recorded actions so that I can confirm that the correct journey was captured.**

### Each recorded step displays

* Step number.
* Action type.
* Target-element description.
* Entered value when safe.
* Page URL.
* Screenshot when available.

### Acceptance criteria

* The user can rename a step.
* The user can remove an unnecessary step.
* The user can replay the entire journey.
* A failed step is not skipped silently.
* The interface clearly identifies unsupported recorded actions.

---

## User story B3

**As a developer, I want sensitive information protected so that recorded test journeys do not expose credentials.**

### Acceptance criteria

* Password values are masked.
* Fields manually marked sensitive are masked.
* Sensitive values do not appear in exported reports.
* The application warns against using real payment or personal data.
* The bundled sample uses fake information only.

---

# 18. Epic C — Failure Experiment Builder

## User story C1

**As a developer, I want to choose a named failure experiment so that I do not need to write custom interception code.**

### Acceptance criteria

* The five supported experiments appear as cards.
* Each card explains the user behavior being simulated.
* Selecting a card reveals only relevant settings.
* Only one failure experiment can be active in an MVP scenario.
* The selected experiment appears in the scenario summary.

---

## User story C2

**As a developer, I want to attach the failure to a specific journey step so that the interruption occurs at a meaningful moment.**

### Examples

* Duplicate the final Submit Order action.
* Disconnect before the order request.
* Refresh after shipping information is entered.
* Delay the final request.
* Navigate Back from confirmation.

### Acceptance criteria

* Recorded steps can be selected from the journey timeline.
* Unsupported experiment-step combinations are disabled.
* The selected disruption point appears in plain language.
* The result timeline later marks the same point.
* Updating the step updates the saved experiment.

---

## User story C3

**As a developer, I want to configure experiment timing so that the failure is reproducible.**

### Acceptance criteria

* Timing settings use predefined MVP values.
* The saved scenario retains the chosen timing.
* Replays use the same timing configuration.
* The result records the timing values used.
* The runner does not randomly alter experiment timing.

---

# 19. Epic D — Recovery Assertion Builder

## User story D1

**As a developer, I want to define expected recovery behavior so that the result is more meaningful than a generic error log.**

### Acceptance criteria

* At least one assertion is required.
* Assertions appear in plain language.
* The developer can add, edit and remove assertions.
* Unsupported assertion types are not shown.
* The run evaluates every configured assertion separately.
* Failed assertions show both the expected and observed outcomes.

---

## User story D2

**As a developer, I want form-specific assertion templates so that I can configure common checks quickly.**

### Templates

* Only one request should occur.
* This field should retain its value.
* This message should appear.
* This success message should not appear.
* The journey should reach this step.
* A retry action should become visible.

### Acceptance criteria

* Templates are selectable without technical syntax.
* The developer can select the relevant page element or request.
* The configured assertion is shown as a readable sentence.
* The assertion remains associated with the saved experiment.

---

# 20. Epic E — Test Runner

## User story E1

**As a developer, I want FormCrash to replay the journey automatically so that I do not need to complete the form manually during every test.**

### Run sequence

1. Launch controlled Chromium.
2. Load the target application.
3. Replay the normal journey.
4. Apply the configured failure.
5. Evaluate recovery assertions.
6. Capture evidence.
7. Save the result.

### Acceptance criteria

* The controlled browser is visible.
* The dashboard shows the current journey step.
* The user can stop the run.
* A stopped run is marked incomplete.
* Runner errors are distinguished from application failures.
* The same experiment can run again without rerecording.

---

## User story E2

**As a developer, I want to see the disruption occur so that the tool does not feel like a hidden test script.**

### During the run, display

* Current journey step.
* Upcoming experiment.
* Active disruption.
* Network status.
* Important request activity.
* Assertion results as they become available.

### Acceptance criteria

* The disruption receives a clear marker.
* Offline status is visible.
* Request delay is visible.
* Duplicate actions are counted.
* The run does not finish before all assertions are evaluated.

---

## User story E3

**As a developer, I want deterministic replay so that I can prove whether a fix worked.**

### Acceptance criteria

* A saved experiment can be replayed without modification.
* The same failure occurs at the same selected step.
* The result identifies the experiment version.
* The result includes the execution date and duration.
* The bundled vulnerable scenario fails consistently.
* The bundled fixed scenario passes consistently.

---

# 21. Epic F — Results and Evidence

## User story F1

**As a developer, I want a clear result so that I immediately know whether the application recovered correctly.**

### Result states

* Passed.
* Failed.
* Incomplete.
* Runner error.

### Acceptance criteria

* The result state appears prominently.
* The result explains which assertions determined the state.
* Each assertion has its own result.
* A runner error is not presented as an application failure.
* The earliest failed journey step or assertion is identified.

---

## User story F2

**As a developer, I want a chronological event timeline so that I can understand how the disruption caused the result.**

### Timeline events

* Page loaded.
* Field completed.
* Button clicked.
* Request started.
* Failure injected.
* Network disconnected.
* Network restored.
* Page refreshed.
* Browser Back activated.
* Request completed.
* Assertion passed.
* Assertion failed.
* Journey ended.

### Acceptance criteria

* Events appear chronologically.
* The disruption is visually distinct.
* Every event has a relative timestamp.
* Requests show method, path and status when available.
* Selecting an event reveals more detail.
* Screenshots are linked to relevant events.

---

## User story F3

**As a developer, I want screenshots around the failure so that I can see the user-visible effect.**

### Required capture points

* Immediately before disruption.
* Immediately after disruption.
* At the final result.

### Acceptance criteria

* Available screenshots appear in the result.
* Each screenshot is labeled.
* Missing screenshots do not break the page.
* Screenshots can be enlarged.
* Sensitive values are avoided or masked when practical.

---

# 22. Epic G — Failed-versus-Fixed Comparison

This is the signature FormCrash workflow.

## User story G1

**As a developer, I want to compare a failed run and a passed run so that I can demonstrate that the application fix survived the same experiment.**

### Comparison displays

* Experiment configuration.
* Disruption point.
* Assertion results.
* Request counts.
* Final application state.
* Relevant screenshots.
* Run duration.

### Acceptance criteria

* Previous runs are listed newest first.
* The user can select two runs of the same saved experiment.
* The comparison identifies configuration differences.
* Changed assertion results are highlighted.
* Request-count differences are visible.
* The sample project can compare a vulnerable failure with a fixed pass.

---

# 23. Epic H — Export

## User story H1

**As a developer, I want to export a resilience report so that I can attach the evidence to an issue or pull request.**

### Report contents

* Project.
* Journey.
* Failure experiment.
* Experiment settings.
* Disruption point.
* Recovery assertions.
* Overall result.
* Failed assertions.
* Event timeline.
* Screenshots.
* Replay instructions.
* Run date.

### Acceptance criteria

* Reports can be exported from completed runs.
* Sensitive values are excluded.
* Reports use plain language.
* Replay instructions reference the saved experiment.
* Export failures show an error.

---

## User story H2

**As a developer, I want a Playwright-style regression-test export so that the experiment can move into the normal test suite.**

### Acceptance criteria

* Recorded actions appear in order.
* Supported failure behavior is represented.
* Recovery assertions become test assertions where possible.
* Unsupported portions are clearly marked.
* The export does not claim to be fully runnable when manual adjustment is required.

The export is a supporting feature, not the core product innovation.

---

# 24. Bundled Sample Checkout

The repository must include a sample checkout designed to demonstrate FormCrash Lab reliably.

## 24.1 Journey

1. View cart.
2. Enter contact information.
3. Enter shipping information.
4. Review order.
5. Submit order.
6. View confirmation.

## 24.2 Vulnerable mode

The vulnerable implementation intentionally allows:

* Multiple rapid submissions.
* Multiple accepted order requests.
* Multiple order records.
* No effective duplicate protection.

## 24.3 Fixed mode

The fixed implementation prevents duplicates through both:

* Clear interface behavior.
* Server-side duplicate protection.

## 24.4 Sample data

* Two products.
* Fake customer.
* Fake address.
* No real payment provider.
* No real payment details.
* Local or in-memory order records.

## Acceptance criteria

* The checkout requires no external account.
* The vulnerable version consistently fails the saved Impatient User experiment.
* The fixed version consistently passes it.
* Created order records are visible.
* Data can be reset.
* Setup instructions are included.
* Judges can test the entire workflow locally.

---

# 25. First-Run Experience

Within the persistent application shell, the first-run state should show:

* A concise explanation of controlled resilience testing.
* A primary “Run Sample Experiment” action.
* A secondary “Create Project” action.
* The five supported experiments.
* A warning to use test environments and fake data only.

The judge should reach the sample experiment with minimal setup.

---

# 26. Empty States

## No projects

Show:

* Product explanation.
* Run Sample Experiment.
* Create Project.

## Project with no journeys

Show:

* Record Journey.
* Explanation of supported actions.
* Link to recording limitations.

## Journey with no experiments

Show:

* Experiment cards.
* Recommended Impatient User experiment.

## Experiment with no assertions

Show:

* Recovery assertion templates.
* Explanation that at least one expectation is required.

## Experiment with no runs

Show:

* Experiment summary.
* Run Experiment.
* Explanation of evidence that will be captured.

## Result without screenshots

Show the timeline and assertion results normally with a screenshot-unavailable message.

---

# 27. Error States

FormCrash must distinguish between:

### Application failure

Example:

* Two order requests were accepted.

### Assertion failure

Example:

* Shipping information was not retained.

### Journey replay failure

Example:

* A recorded button could not be located.

### Runner error

Example:

* Chromium failed to launch.

### Experiment configuration error

Example:

* A request delay was attached to a step without a matching request.

### Acceptance criteria

* Every error has a plain-language summary.
* Technical details can be expanded.
* The next useful action is suggested.
* Failed runs remain inspectable.
* A failed run does not corrupt the journey or experiment.

---

# 28. Important Edge Cases

## Dynamic element changed

Identify the replay step that could not locate its target.

## Slow page before disruption

Wait for the configured condition or fail with a timeout explanation.

## New tab opens

New-tab journeys are unsupported in the MVP.

## File upload

File-upload recording is unsupported in the MVP.

## CAPTCHA

CAPTCHA-protected journeys are unsupported.

## External payment provider

Third-party payment pages are unsupported.

## Real production application

Warn that destructive scenarios must only run against controlled environments with test data.

## Browser closes

Save the run as incomplete.

## Network unavailable before run

Report that the target application could not be reached before beginning the experiment.

## Application changes after recording

Show which recorded step or assertion requires updating.

---

# 29. Competitive Differentiation Requirements

The product must visually and functionally emphasize the following.

## 29.1 Scenario library

The project should appear as:

```text
Sample Checkout
├── Impatient User on Submit Order
├── Tunnel Drop before order creation
├── Slow Server on POST /orders
├── Accidental Refresh after shipping
└── Back-Button Trap from confirmation
```

It should not resemble a list of captured user sessions.

## 29.2 Named destructive experiments

Users choose controlled experiments rather than manually configuring low-level browser interception.

## 29.3 Recovery assertions

The product evaluates user and business outcomes, not only exceptions.

## 29.4 Pre-production language

The interface should consistently use terms such as:

* Test environment.
* Before release.
* Controlled failure.
* Recovery check.
* Replay after fix.

It should not use production-monitoring language.

## 29.5 Failed-versus-fixed proof

The before-and-after comparison must be one of the most prominent product actions.

---

# 30. Hackathon Success Metrics

The MVP succeeds when:

1. A judge can open the sample project without creating an account.
2. The saved checkout journey can be inspected.
3. The Impatient User experiment is already configured.
4. The vulnerable checkout creates duplicate submissions consistently.
5. FormCrash records the duplicate requests or records.
6. The result clearly fails the duplicate-protection assertion.
7. The fixed checkout passes the identical saved experiment.
8. Failed and passed runs can be compared.
9. The result includes a visible timeline and evidence.
10. A report can be exported.
11. The complete demonstration fits within three minutes.

---

# 31. Primary Hackathon Demo

## 0:00–0:20 — Explain the problem

> Important forms are normally tested when users behave perfectly. FormCrash tests what happens when they do not.

## 0:20–0:40 — Show the saved experiment

Open:

> Sample Checkout → Impatient User on Submit Order

Show:

* Normal journey.
* Duplicate trigger setting.
* “Only one order should be created” assertion.

## 0:40–1:20 — Run vulnerable mode

Show:

* Automated checkout.
* Repeated final action.
* Two accepted requests.
* Two orders.
* Failed assertion.

## 1:20–1:50 — Inspect evidence

Show:

* Disruption marker.
* Request count.
* Screenshots.
* Failed result.

## 1:50–2:25 — Replay fixed mode

Run the identical experiment against the fixed checkout.

Show:

* One accepted operation.
* One order.
* Passed assertion.

## 2:25–2:45 — Compare runs

Show failed and passed runs side by side.

## 2:45–3:00 — Explain development process

State that Codex with GPT-5.6 was used for product planning, implementation, browser automation, testing and refinement, while the finished application remains deterministic and requires no runtime model.

---

# 32. Implementation Priorities

## Priority 0 — Submission-critical path

Build only these first:

* Sample checkout.
* Vulnerable mode.
* Fixed mode.
* Saved checkout journey.
* Impatient User experiment.
* Controlled Chromium replay.
* Duplicate request or record detection.
* Recovery assertion evaluation.
* Result timeline.
* Failed-versus-fixed comparison.

Nothing should delay this path.

## Priority 1 — Complete MVP

After Priority 0 is reliable:

* Tunnel Drop.
* Slow Server.
* Accidental Refresh.
* Back-Button Trap.
* Screenshots.
* Run history.
* Report export.
* Basic Playwright-style export.

## Priority 2 — Polish

Only after stability:

* Journey editing improvements.
* Better selector recovery.
* More assertion templates.
* Improved onboarding.
* Richer comparison visuals.
* External target application support.

---

# 33. Later Features

Not included in the hackathon MVP:

* Firefox and Safari.
* Cloud execution.
* Team workspaces.
* CI checks.
* GitHub pull-request integration.
* Session-expiry experiments.
* Cookie corruption.
* File-upload interruption.
* Multi-tab journeys.
* Mobile-browser simulation.
* Scheduled testing.
* Combined failure experiments.
* Custom experiment scripting.
* Framework-specific integrations.
* Production incident imports.
* Scenario marketplace.

---

# 34. Product Risks

## Risk 1: It appears to be session replay

### Mitigation

Make experiments and assertions the center of the interface. Recorded actions are only source material for an experiment.

## Risk 2: It appears to be Playwright with a dashboard

### Mitigation

Emphasize the opinionated resilience workflow:

* Named failure experiments.
* Precise disruption placement.
* Form-specific recovery assertions.
* Failed-versus-fixed comparison.

## Risk 3: Recorder reliability

### Mitigation

Guarantee the full experience on the bundled checkout. Treat external applications as secondary.

## Risk 4: Excessive scope

### Mitigation

Complete the Impatient User scenario before implementing any other failure.

## Risk 5: Artificial demonstration

### Mitigation

Show actual browser behavior, requests, resulting order records and deterministic replay.

## Risk 6: Runner failures resemble product failures

### Mitigation

Use separate result states and clearly identify runner errors.

## Risk 7: No runtime GPT-5.6 integration

### Mitigation

Preserve:

* Codex session history.
* `/feedback` session ID.
* Dated commits.
* README development narrative.
* Clear examples of where GPT-5.6 influenced implementation and decisions.

Do not claim that GPT-5.6 runs inside FormCrash Lab.

---

# 35. Definition of Done

FormCrash Lab is ready for submission when:

* Installation instructions work from a clean environment.
* The dashboard launches.
* The sample checkout launches.
* No account or API key is required.
* Sample data can be reset.
* The vulnerable Impatient User experiment fails consistently.
* The fixed version passes the identical experiment consistently.
* Duplicate requests or records are visible.
* Recovery assertions produce accurate results.
* The event timeline reflects the actual run.
* Failed and passed runs can be compared.
* Relevant screenshots are available.
* A report can be exported.
* Runner errors are distinguished from assertion failures.
* The README explains setup and judge testing.
* The README explains how Codex and GPT-5.6 were used.
* Supported platforms and limitations are documented.
* A public license is present if the repository is public.
* The demo can be completed in under three minutes.
* The `/feedback` session ID has been retrieved.
* The submitted build works exactly as shown in the video.

---

# 36. Locked MVP Statement

FormCrash Lab is not a production-monitoring platform, session-replay service, analytics product or general browser-testing framework.

The locked MVP is:

> A local operational resilience-testing application that replays a recorded transactional web journey, injects one controlled failure at a precise step, evaluates explicit recovery expectations, collects deterministic evidence and compares the failed run with the same experiment after a fix.

The submission-critical experience is the duplicate checkout experiment. Every development decision must protect the reliability, clarity and visual strength of that workflow.
