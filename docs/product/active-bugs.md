# FormCrash active bugs and verification inventory

**Status:** Active engineering inventory  
**Scope:** Known behavioral defects, partial fixes, and verification gaps that
must survive UI and information-architecture work.

> A UI restructure does not resolve a behavioral bug. Bugs remain active until
> their underlying behavior and regression coverage are verified.

## Outcome Check capture

- **Status:** Open
- **User impact:** Users cannot reliably approve intended outcomes represented by
  non-interactive content such as tenant names, rows, cells, badges, `div`
  elements, `span` elements, and other text containers.
- **Affected flow:** Outcome-baseline capture and element-based Outcome Check
  approval across full-page and SPA navigation.
- **Automated coverage:** Partial. Existing coverage does not prove reliable
  capture for all passive result elements across both navigation models.
- **Manual verification:** Required with visible Chromium. Element-based approval
  must remain blocked until a valid locator is captured. Final-pathname checks
  must succeed without element capture.
- **Fix timing:** Before declaring Outcome Check capture generally usable; do not
  defer it as a consequence of UI restructuring.
- **Regression protection:** Add focused capture, navigation, locator-validity,
  approval-gating, and pathname-only tests plus a visible-browser acceptance run.

## Outcome Check description mismatch

- **Status:** Open
- **User impact:** A persisted final-pathname assertion can display `Exactly one
matching item should appear`, causing users to review the wrong expectation.
- **Affected flow:** Saved Outcome Check lists, detail views, baseline review, and
  Run result rendering.
- **Automated coverage:** Missing a regression that reloads a persisted
  final-pathname assertion independently of stale form state or incompatible
  readable text.
- **Manual verification:** Required after persistence reload and on the result
  surface.
- **Fix timing:** With the next Outcome Check correctness slice.
- **Regression protection:** Render saved checks from persisted technical
  assertion semantics and test every supported assertion type after reload.

## Request discovery

- **Status:** Open
- **User impact:** Guided discovery may replay the state-changing Critical Action
  and still fail to identify its mutation request, creating target data without
  producing a usable candidate.
- **Affected flow:** Configure Tests, request discovery, approved matcher
  selection, and baseline verification.
- **Automated coverage:** Server ranking and ambiguity behavior are covered, but
  recording-time network evidence is not covered as the initial candidate source.
- **Manual verification:** Required on a journey whose mutation is observed while
  recording and then absent during verification.
- **Fix timing:** Before discovery is treated as reliable for state-changing
  Guided flows.
- **Regression protection:** Persist bounded recording-time candidates, display
  them before replay, use baseline replay to verify an approved matcher, and keep
  a recording-versus-verification discrepancy visible.

## Configure Tests navigation

- **Status:** Fixed but manually unverified
- **User impact:** A regression can produce rapid identical route requests,
  disrupt replay, and destabilize wizard state.
- **Affected flow:** Configure Tests navigation, direct links, step changes,
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
