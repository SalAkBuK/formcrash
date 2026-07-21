# FormCrash active bugs and verification inventory

**Status:** Active engineering inventory  
**Scope:** Known behavioral defects, partial fixes, and verification gaps that
must survive UI and information-architecture work.

> A UI restructure does not resolve a behavioral bug. Bugs remain active until
> their underlying behavior and regression coverage are verified.

## Outcome Check capture

- **Status:** Fixed but manually unverified
- **User impact:** Users cannot reliably approve intended outcomes represented by
  non-interactive content such as tenant names, rows, cells, badges, `div`
  elements, `span` elements, and other text containers.
- **Affected flow:** Outcome-baseline capture and element-based Outcome Check
  approval across full-page and SPA navigation.
- **Automated coverage:** Complete for this defect. Server-owned real-Chromium
  integration coverage proves semantic cell capture after full-page navigation
  and exact-text `span` capture after SPA navigation, including the visible
  in-browser selection cue. Dashboard and manager coverage prove that closing
  Chromium after a successful baseline is not reported as a runner failure, the
  captured final page remains approvable without replaying the mutation, and
  element approval still requires a live valid selection. The Chromium selection
  bridge now waits for server acceptance, visibly identifies the clicked element,
  reports a failed connection instead of discarding the error, and must prove that
  its visible selector UI was installed before the server reports that it is
  waiting. While selection is open, both the dashboard and the Chromium selector
  banner show the exact safe synthetic values created by that baseline, so the
  user can distinguish the new record from older rows; reusable Outcome Checks
  continue to persist only the generated template, never that one-off literal.
  Baseline replay also replaces safe business-code inputs such as a
  recorded parking-slot code with a run-specific generated identifier, and the
  saved Test snapshot now carries that same generated identity into every Run.
  Final Run evidence also centers the unique generated-identity match before
  capture so rows inside nested scrolling tables and lists are visible.
  Real-Chromium coverage now executes a `tsx`-serialized Outcome selector
  that requires the generated `__name` helper, matching the development runtime
  failure mode. Standard test-editor coverage also proves that the production confirmation
  is visible beside the baseline action, gates replay, and is submitted exactly
  once with the confirmed replay. Choosing the captured final page now opens the
  Outcome Check review instead of updating a hidden form. Generated-identity row
  locators are parameterized before persistence and resolved only in memory for
  each run, while unbound dynamic locators remain rejected. A rejected selection
  now offers another Chromium selection or captured-final-page recovery. Existing
  ambiguity and secret-derived-content tests continue to block invalid targets.
- **Manual verification:** Not completed. A visible-Chromium acceptance run remains
  required; the automated real-Chromium run was headless and is recorded
  separately rather than treated as manual verification.
- **Fix timing:** Before declaring Outcome Check capture generally usable; do not
  defer it as a consequence of UI restructuring.
- **Regression protection:** Add focused capture, navigation, locator-validity,
  approval-gating, and pathname-only tests plus a visible-browser acceptance run.

## Outcome Check description mismatch

- **Status:** Fixed but manually unverified
- **User impact:** A persisted final-pathname assertion can display `Exactly one
matching item should appear`, causing users to review the wrong expectation.
- **Affected flow:** Saved Outcome Check lists, detail views, baseline review, and
  Run result rendering.
- **Automated coverage:** Complete for this defect. Dashboard regressions reload
  all supported persisted assertion types, including a final-pathname check with
  incompatible exactly-once text, and verify baseline-review wording. Server
  presentation coverage verifies that Run results derive their approved
  expectation from the persisted technical semantics.
- **Manual verification:** Not completed. Persistence reload and Run result
  wording still require a visible-browser acceptance pass before this entry can
  be marked resolved.
- **Fix timing:** With the next Outcome Check correctness slice.
- **Regression protection:** Render saved checks from persisted technical
  assertion semantics and test every supported assertion type after reload.

## Request discovery

- **Status:** Fixed but manually unverified
- **User impact:** The standard test editor no longer replays the state-changing
  Critical Action to discover its mutation request. Recording-time evidence is
  preferred; legacy journeys may reuse only already persisted Run observations.
- **Affected flow:** Optional approved matcher selection and network-specific
  verification. It must not be reintroduced as a prerequisite for
  browser-visible Scenario tests.
- **Automated coverage:** Recording-time and legacy prior-run candidates use the
  same deterministic ranking, remain unselected until `Use this request`, and
  persist bounded source provenance in the next immutable test version. Failed,
  incomplete, and read-only candidates remain blocked. Every built-in approved
  network recipe is contract-enforced, while the no-matcher path remains
  browser-only. Strict Mode and rerenders do not execute discovery.
- **Manual verification:** Not completed for the visible production Towerdesk
  journey because verification would create another tenant. It still requires an
  explicitly authorized visible-browser run proving that a recorded cross-origin
  mutation can be approved without another state-changing replay.
- **Fix timing:** Automated implementation complete; retain until visible-browser
  acceptance can verify the recording candidate against an authorized target.
- **Regression protection:** Preserve bounded sanitization, explicit approval,
  recording/prior-run provenance, browser-only fallback, and recipe enforcement.
  Never reintroduce a state-changing discovery replay into the standard path.

## Test editor navigation

- **Status:** Fixed but manually unverified
- **User impact:** A regression can produce rapid identical route requests,
  disrupt replay, and destabilize wizard state.
- **Affected flow:** Test editor navigation, direct links, step changes,
  rerenders, and browser back/forward navigation.
- **Automated coverage:** Targeted regression coverage exists for explicit URL
  updates, idle/rerender stability, initialization deduplication, and React Strict
  Mode.
- **Manual verification:** Still required for one-click navigation, idle behavior,
  step changes, replay stability, and back/forward navigation in the running
  dashboard.
- **Fix timing:** Preserve continuously; do not declare `Resolved` until the
  targeted regression suite and manual flow both pass on the current UI.
- **Regression protection:** Keep URL changes tied to explicit actions and retain
  idempotence and exactly-once initialization tests through any restructure.

## Duplicate test workspaces and unstable test links

- **Status:** Fixed automatically; visible-browser verification remains open.
- **User impact:** The former hidden Advanced branch duplicated settings,
  request discovery, assertions, saved versions, run history, and destructive
  controls. Test-detail URLs also named their stable route parameter as a version
  identity, obscuring the actual record model.
- **Affected flow:** Project -> Journey -> Tests -> Test detail -> Run.
- **Automated coverage:** The dashboard renders one test editor, saves without
  running, atomically creates Double-click, Triple-click, and Delayed repeat as
  three sibling Tests from one approved Journey and Outcome snapshot, resolves
  historical version links to the stable Test route, lists multiple Tests per
  Journey, preserves immutable version history, and links a Run back to its
  owning Project, Journey, and Test. Automatically generated network assertions
  are not mislabeled as custom Technical checks.
- **Manual verification:** Current layout and browser back/forward behavior still
  require a visible dashboard pass.
- **Regression protection:** Keep reusable browser checks in the standalone
  Technical checks editor and never restore a mode switch or parallel workspace.

## Authentication

- **Status:** Partially fixed
- **Current state:** Authentication inference was recently changed from
  target-accessibility inference to explicit user choice.
- **User impact:** Incorrect inference or incomplete recovery can block protected
  journeys, start an operation before sign-in, or lose the user's interrupted
  action.
- **Affected flow:** Project authentication choice, visible-Chromium capture,
  recording, baseline, replay, discovery, experiment execution, and pending
  operation recovery.
- **Automated coverage:** Authentication inference, gating, persistence,
  sanitization, and recovery have focused coverage, with recent working-tree
  changes still in progress.
- **Manual verification:** Protected visible-Chromium login capture remains
  unverified where the fixture or visible browser was unavailable.
- **Fix timing:** Complete and verify before claiming the protected-project
  prerequisite workflow is resolved.
- **Regression protection:** Keep authentication choice explicit, keep capture
  server-owned, never record credential steps, and require explicit retry for
  recording, baseline, replay, discovery, and mutating experiment operations.

## Brief disabled-control states

- **Status:** Open
- **User impact:** Short-lived disabled or pending states may be missed, weakening
  interface-based recovery evidence.
- **Affected flow:** Recording, baseline capture, and assertion recommendation for
  transient form controls.
- **Automated coverage:** Incomplete for brief state transitions.
- **Manual verification:** Required against a deterministic transient-state
  fixture.
- **Fix timing:** When interface-evidence capture is expanded.
- **Regression protection:** Add deterministic timing fixtures and assertions that
  observe both the transition and the settled state.

## Generic business-record Outcome Checks

- **Status:** Open
- **User impact:** Network success or repeated requests do not generically prove
  whether one or multiple business records were created.
- **Affected flow:** Outcome Check authoring, result diagnosis, and duplicate-record
  proof.
- **Automated coverage:** Fixture-specific and browser-visible checks exist; no
  generic business-record contract is complete.
- **Manual verification:** Required for each supported browser-visible proof until
  a generic integration contract exists.
- **Fix timing:** After reliable Outcome Check capture; do not overclaim in the
  interim.
- **Regression protection:** Keep unknown evidence explicit and prevent request
  counts from being rendered as business-record counts.

## Before-and-after comparison proof

- **Status:** Open
- **User impact:** Users may not be able to produce a complete compatibility-checked
  proof that the same experiment failed before a fix and passed afterward.
- **Affected flow:** Run selection, comparison compatibility, and result proof.
- **Automated coverage:** Immutable snapshots provide prerequisites; complete
  external comparison acceptance remains incomplete.
- **Manual verification:** Required with one failed and one fixed compatible Run.
- **Fix timing:** After Outcome Check execution and result semantics are reliable.
- **Regression protection:** Require identical compatible configuration lineage
  and disclose every meaningful difference.

## Visible-browser and screenshot acceptance

- **Status:** Open
- **User impact:** Browser-owned flows and visual evidence may remain manually
  unverified when visible Chromium or an attached browser is unavailable.
- **Affected flow:** Authentication, recording, replay, baseline, execution,
  screenshots, and visual QA.
- **Automated coverage:** Headless and component coverage is substantial but does
  not replace visible-browser acceptance.
- **Manual verification:** Required whenever the environment provides the owned
  visible browser and relevant fixture.
- **Fix timing:** At each browser-sensitive release checkpoint.
- **Regression protection:** Record skipped acceptance honestly; never substitute
  static screenshots or mock success for an unavailable browser.

## Repository formatting baseline

- **Status:** Open
- **User impact:** Full-repository formatting checks can fail for unrelated
  pre-existing files, obscuring whether a focused change is correctly formatted.
- **Affected flow:** Contributor verification and CI triage.
- **Automated coverage:** Focused Prettier checks can verify touched files; the
  repository-wide baseline still includes unrelated failures.
- **Manual verification:** Compare focused results with the known full-check
  baseline when necessary.
- **Fix timing:** Separate maintenance task; do not mass-format during focused
  product work.
- **Regression protection:** Run focused checks on touched files and report
  unrelated repository-wide failures separately.
