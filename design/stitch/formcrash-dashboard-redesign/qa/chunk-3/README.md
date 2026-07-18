# Chunk 3 automated Journey Detail QA

This directory contains the Playwright 1.61.1 visual and functional QA harness
for the real `/projects` Journey Detail state.

Run from the repository root while the existing dashboard, server, and Sample
Checkout services are available on ports 3000, 4100, and 4200:

```powershell
node design/stitch/formcrash-dashboard-redesign/qa/chunk-3/capture-qa.mjs
```

The harness is read-only. It reads persisted projects, journeys, settings,
Critical Actions, and Outcome Checks from the live API; it does not create,
delete, replay, record, or save data. Project selection, disclosure expansion,
and replay mode/pacing changes are local browser state only.

Required captures:

- `journey-detail-1440.png`
- `journey-detail-1366.png`
- `journey-detail-1024.png`
- `journey-detail-390.png`

Optional captures are emitted only when matching real persisted states exist.
Machine-readable results, real-data provenance, skipped optional states,
accessibility checks, overflow measurements, browser versions, and console/page
errors are recorded in `qa-results.json`.

## Verified run — 2026-07-18

- Playwright: 1.61.1
- Chromium: 149.0.7827.55
- Required viewports: 1440 × 1000, 1366 × 900, 1024 × 768, and
  390 × 844
- Primary real state: TOWERDESK → ADD Parking Slot v1, hybrid-v2, 10
  steps, trace and video available, saved authentication available, no Critical
  Action, and no Outcome Check
- Historical compatibility state: Outcome Walkthrough Fixture → Create profile
  v1, semantic-v1, 3 steps, Critical Action configured, and 3 Outcome Checks
- Optional complete-hybrid and missing-runtime screenshots were skipped because
  no current persisted journey matches those states

All required captures passed page-level overflow checks. The 390px layout
collapsed to one column. The harness found exactly one `main`, one Journey
Detail primary action, no unnamed interactive controls, a keyboard-reachable
visible focus ring, working technical disclosures, working replay mode/pacing
controls, and accessible Guided/Advanced entry points. It observed no console or
page errors.

The production result follows Stitch through its dominant sequence timeline,
compact readiness summary, amber controlled-action semantics, and secondary
technical rail. It deliberately keeps the real FormCrash shell and omits fake
DOM snapshots, log artifacts, account chrome, and hardcoded example data.
