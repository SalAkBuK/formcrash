# Chunk 4 automated Guided Test wizard QA

> **QA provenance notice:** This document is retained as historical verification
> evidence. It is not current UI authority; `docs/product/ui-direction.md`
> governs current information architecture. Verified behavior and regression
> evidence recorded here must still be preserved.

This directory contains the Playwright 1.61.1 visual and functional QA harness
for the three-step Guided Test wizard on `/projects`.

Run from the repository root while the dashboard, API server, and Sample
Checkout services are available on ports 3000, 4100, and 4200:

```powershell
node design/stitch/formcrash-dashboard-redesign/qa/chunk-4/capture-qa.mjs
```

The harness reads a persisted local project, journey, Critical Action, and all
saved Outcome Checks from the real API. If port 4300 is unavailable, it starts
the repository's deterministic `fixtures/external-target/index.html` target on
that port and stops it before exiting. It performs one real Guided discovery
and one real repeated-submission experiment against that local fixture. That
creates an immutable experiment version and run in the existing local FormCrash
store; it never targets the persisted production project.

The harness captures Expected Outcome, Safety & Data, and Review & Run at
1440×1000, 1366×900, 1024×768, and 390×844. Machine-readable results record
real-data provenance, navigation and mode checks, overflow measurements,
keyboard focus, landmark structure, duplicate-click protection, the safe local
run, browser versions, and console/page errors in `qa-results.json`.

## Verified run — 2026-07-19

- Playwright 1.61.1 and Chromium 149.0.7827.55
- Persisted state: Outcome Walkthrough Fixture → Create profile v1,
  semantic-v1, Critical Action “Save profile,” no saved authentication, and
  three Outcome Checks covering every supported type
- All 12 required captures created with no page-level horizontal overflow
- Exactly one `main`, one current step, and a keyboard-reachable run action with
  a visible 3px focus outline and focus ring
- Expected Outcome, Safety & Data, Review & Run, backward/forward navigation,
  and Guided/Advanced access verified
- Forced duplicate click observed one experiment-creation request and one run
  request; the real local run was accepted
- No console or page errors; the temporary port-4300 fixture was stopped

The production design follows Stitch's progress hierarchy, cards, amber current
step, green completion state, compact summaries, and responsive stacking. It
deliberately retains the real FormCrash shell and existing outcome/run surfaces,
and omits unsupported recommendation, provenance, enable/edit, persisted-auth
requirement, secret-preview, and live-progress controls.
