# FormCrash Stitch route and component mapping

Project: **FormCrash Dashboard Redesign** (`4677329075423301517`)

This mapping treats Stitch as a visual reference, not as an executable product specification. The generated screens contain security-scanner vocabulary, account UI, fake data, and routes that FormCrash does not support. Those elements must not enter production.

## Current dashboard architecture

- `/` renders `SampleRunDashboard`, which owns the bundled sample experiment and embeds `RunHistoryList`.
- `/projects` renders the stateful `ProjectJourneyDashboard`. Project selection, recording, replay, Critical Action and Outcome Check capture, Guided/Advanced experiment setup, external results, and comparisons are component state within this route.
- `/runs/[runId]` renders `RunDetailRoute` and then `RunDetailView` for bundled sample-run evidence.
- `RootLayout` wraps every route in the shared `ApplicationShell` established in Chunk 1.
- No current route exists for a standalone journey detail, experiment wizard step, external-run detail, comparison detail, or runs list.

## Screen mapping

### 1. Design System

- **Stitch screen ID:** `asset-stub-assets_733fe26b6cc44c11bcc9ecfbfd1dcfd0`
- **Intended FormCrash route:** none; global foundation
- **Current route:** all dashboard routes through `RootLayout`
- **Primary component:** `ApplicationShell`
- **Related components:** `Button`, `StatusBadge`, `StateMessage`, `DisclosurePanel`, `CopyButton`; `globals.css`
- **Existing functionality represented:** global surfaces, typography, controls, navigation, status semantics, evidence categories, focus, and responsive behavior
- **Stitch-only decorative or mocked elements:** none in the metadata itself
- **Unsupported Stitch elements:** the design-system asset has no normal screen preview or generated-code resource
- **Existing functionality absent from Stitch that must remain:** all runtime and backend behavior; the token system cannot change product contracts
- **Planned implementation chunk:** **Chunk 1**

### 2. Project Overview

- **Stitch screen ID:** `e1304076942b4efdafdba6cdfa113560`
- **Intended FormCrash route:** `/projects`
- **Current route:** `/projects`
- **Primary component:** `ProjectJourneyDashboard`
- **Related child components:** `OutcomeDefinitionPanel`, `ExternalExperimentPanel`, `GuidedTestPanel`, `ExternalRunResult`, `ExternalRunComparison`
- **Existing functionality represented:** selected project context, journeys, test setup, run history, environment and readiness information
- **Stitch-only decorative or mocked elements:** fixed KPI cards, “Critical Finding,” “Needs Attention,” fake recent-run rows, avatar, notification/search controls, and project switcher
- **Unsupported Stitch elements:** dashboard analytics, alert aggregation, separate Settings/Test Data pages, user account, global search, and scanner-style vulnerability counts
- **Existing functionality absent from Stitch that must remain:** project creation/deletion, Bundled Sample Checkout protection, external target URLs, recording, replay modes and pacing, authentication restoration, runtime variables, production confirmation, generated values, Critical Action/Outcome Check capture, Guided/Advanced modes, and comparisons
- **Planned implementation chunk:** **Chunk 2**

### 3. Journey Detail: Register Visitor

- **Stitch screen ID:** `01d398ffe94e4410b9e5ea49aa026695`
- **Intended FormCrash route:** `/projects` with a selected journey (no new route is authorized yet)
- **Current route:** `/projects`
- **Primary component:** journey sections inside `ProjectJourneyDashboard`
- **Related child components:** `OutcomeDefinitionPanel`, replay controls, runtime-value controls, recording/review cards
- **Existing functionality represented:** recorded sequence, Critical Action, replay readiness, outcome setup, DOM/locator evidence, and replay action
- **Stitch-only decorative or mocked elements:** fixed “Register Visitor” data, readiness sidebar values, generated DOM snapshot, avatar/search/notification chrome
- **Unsupported Stitch elements:** standalone `/journeys` navigation, fake artifact payloads, and a dedicated journey-detail URL that does not exist
- **Existing functionality absent from Stitch that must remain:** hybrid-v2/semantic replay compatibility, ranked locator strategies, pointer fallback, replay pacing, viewport/environment restoration, authentication capture, runtime variables, sensitive-value handling, recording warnings, delete behavior, and explicit unsupported boundaries
- **Planned implementation chunk:** **Chunk 3**

### 4. Test Wizard: Expected Outcome

- **Stitch screen ID:** `5831dbcc32e2466bac122f15f54737d4`
- **Intended FormCrash route:** `/projects`, Guided mode, expected-outcome stage
- **Current route:** `/projects`; component-state step, not a route
- **Primary component:** `GuidedTestPanel`
- **Related child components:** `OutcomeDefinitionPanel` and its existing baseline-capture, approval, list, and delete controls
- **Existing functionality represented:** persisted Critical Action, every saved Outcome Check, baseline capture, the three existing Outcome Check types, and all-check runner semantics
- **Stitch-only decorative or mocked elements:** “Step 2 of 4,” fake selector values, fixed card choices, profile/search controls, and draft navigation
- **Unsupported Stitch elements:** a separate wizard URL, hardcoded CSS selectors or outcome values, recommendation confidence/provenance, generated/manual badges, enable/disable, editing, and per-experiment check subsets
- **Existing functionality absent from Stitch that must remain:** exactly-once generated bindings, visible-element and final-pathname checks, baseline capture reconciliation, existing delete behavior, redaction, all-saved-check evaluation, and Advanced access
- **Planned implementation chunk:** **Chunk 4**

### 5. Test Wizard: Safety & Data

- **Stitch screen ID:** `b263c97c6f3b485caf3be853a89c3fa9`
- **Intended FormCrash route:** `/projects`, Guided mode, safety/data stage
- **Current route:** `/projects`; component-state step, not a route
- **Primary component:** `GuidedTestPanel`
- **Related child components:** project settings and runtime inputs in `ExternalExperimentPanel`
- **Existing functionality represented:** real target/environment review, authentication availability, runtime readiness, safe generated templates, hooks, cleanup residue, replay pacing, recorded-environment summary, browser boundaries, and production safety confirmation
- **Stitch-only decorative or mocked elements:** fixed environment, fake data preview, profile/search controls, and a fixed numbered wizard
- **Unsupported Stitch elements:** separate Test Data page, fabricated secrets/test identities, secret previews, persisted authentication requirements, and any implication that production execution is safe by default
- **Existing functionality absent from Stitch that must remain:** explicit production confirmation, truthful configured/available authentication state, an unknown authentication requirement until replay, before/after hooks, redaction, generated values, cleanup requirements, pacing, and unsupported boundary handling
- **Planned implementation chunk:** **Chunk 4**

### 6. Test Wizard: Review & Run

- **Stitch screen ID:** `b8e1bc2e406240a09939489acbe0c708`
- **Intended FormCrash route:** `/projects`, Guided mode, review/run stage
- **Current route:** `/projects`; component-state step, not a route
- **Primary component:** `GuidedTestPanel`
- **Related child components:** `ExternalExperimentPanel`, readiness summary, experiment plan, and the existing `ExternalRunResult`
- **Existing functionality represented:** repeated-action configuration, selected Critical Action, every saved Outcome Check, generated templates, run readiness, duplicate-submit protection, and existing run initiation
- **Stitch-only decorative or mocked elements:** fixed plan content, account chrome, a four-step route model, and hardcoded run values
- **Unsupported Stitch elements:** a separate wizard URL, a new live-progress architecture, Outcome Check recommendation/provenance controls, and generated data not obtained from current contracts
- **Existing functionality absent from Stitch that must remain:** repeat count/interval contracts, false continuation, request discovery used internally by Guided, technical matcher/assertion configuration only in Advanced, authentication availability, cleanup, production safety, Guided/Advanced switching, persisted immutable experiment versions, and the existing result surface
- **Planned implementation chunk:** **Chunk 4**

### 7. Run Result: Vulnerability Reproduced

- **Stitch screen ID:** `c4f276ca822b4b1895bfdd17aa673511`
- **Intended FormCrash route:** `/runs/[runId]` for bundled runs; `/projects` inline for current external runs until routing is deliberately unified
- **Current route:** `/runs/[runId]` (`RunDetailView`) and `/projects` (`ExternalRunResult`)
- **Primary component:** `RunDetailView` or `ExternalRunResult`, depending on run type
- **Related child components:** `AssertionAndEvidence`, `ScreenshotGallery`, `EventTimeline`, `ExternalRunComparison`
- **Existing functionality represented:** outcome-first result, expected versus observed state, request/browser evidence, screenshots, technical assertions, event history, and comparison eligibility
- **Stitch-only decorative or mocked elements:** fixed endpoint/data, “Export Payload,” “Mark as False Positive,” recommended automated actions, database evidence, a reproducibility score, account chrome, and security-scanner labels
- **Unsupported Stitch elements:** database inspection, AI root-cause/actions, false-positive workflow, security finding export, and claims not backed by existing evidence
- **Existing functionality absent from Stitch that must remain:** passed/could-not-verify/runner-error states, historical terminal reconciliation, live SSE progress, immutable snapshots, evidence boundaries, redaction, CAPTCHA/unsupported boundaries, and failed-versus-fixed compatibility
- **Planned implementation chunk:** **Chunk 5**

### 8. Run Result: Not Configured

- **Stitch screen ID:** `1caafc56960440edb94ed2a2039965b6`
- **Intended FormCrash route:** same result surfaces as the vulnerability screen
- **Current route:** `/projects` for `ExternalRunResult`; bundled `/runs/[runId]` has its own incomplete/runner state handling
- **Primary component:** `ExternalRunResult`
- **Related child components:** `ExternalExperimentPanel`, `ExternalRunComparison`, technical evidence disclosure
- **Existing functionality represented:** not-configured/could-not-verify result semantics, observed evidence, screenshots, and next-step guidance
- **Stitch-only decorative or mocked elements:** avatar, fixed checkout log and screenshot, unsupported action buttons, and fake evidence
- **Unsupported Stitch elements:** presenting unverified as failure, fabricated browser/network evidence, and account/global-search controls
- **Existing functionality absent from Stitch that must remain:** distinction among not configured, could not verify, runner error, CAPTCHA, unsupported replay, and persisted historical outcomes
- **Planned implementation chunk:** **Chunk 5**

### 9. Runs List

- **Stitch screen ID:** `a59c1460dfff41988baa3eef37cb172e`
- **Intended FormCrash route:** current `/#history-title`; a dedicated `/runs` route may only be introduced in Chunk 2 if it preserves current links and behavior
- **Current route:** `/` via `SampleRunDashboard` → `RunHistoryList`; external history also appears inside `/projects`
- **Primary component:** `RunHistoryList`
- **Related child components:** `SampleRunDashboard`; external-run list in `ExternalExperimentPanel`; links to `RunDetailRoute`
- **Existing functionality represented:** persisted status, mode, start time, duration, outcome/assertion summary, evidence count, and result links
- **Stitch-only decorative or mocked elements:** filters and tabs without current backing contracts, fixed security test rows, pagination, scheduled/archive views, avatar/search/notification controls, and “Trigger Run”
- **Unsupported Stitch elements:** security-scanner taxonomy, scheduled runs, archive workflow, server pagination UI not backed by current page behavior, and fake filter values
- **Existing functionality absent from Stitch that must remain:** bundled vulnerable/fixed mode, persisted interrupted runs, external project/journey context, comparison eligibility, and all existing result links
- **Planned implementation chunk:** **Chunk 2**

## Cross-screen constraints

- Stitch navigation labels such as Tests, Test Data, and Settings are not routes in this repository and must not be rendered as functional navigation.
- Generated avatars, notification controls, project switcher data, global search, KPI counts, security findings, scheduled runs, AI recommendations, database observations, and reproducibility scores are decorative mocks only.
- The shell must continue exposing the bundled sample, external projects, run history/results, recording, and the existing Guided/Advanced switch without changing APIs or persistence.
