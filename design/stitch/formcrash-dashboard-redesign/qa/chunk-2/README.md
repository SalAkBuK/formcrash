# Chunk 2 automated visual QA

> **QA provenance notice:** This document is retained as historical verification
> evidence. It is not current UI authority; `docs/product/ui-direction.md`
> governs current information architecture. Verified behavior and regression
> evidence recorded here must still be preserved.

Date: 2026-07-18

## Scope and environment

- Branch: `feat/run-comparison`
- Baseline commit: `c1763ebb1e227ed970c6603751b635cc40c3e46b`
- Chunk 1 baseline: `faa729e`
- Routes: `/projects` and `/#history-title`
- Playwright: 1.61.1
- Chromium: 149.0.7827.55
- Dashboard, server, and Sample Checkout were already running on ports 3000,
  4100, and 4200. The QA harness connected to those services and did not stop
  them.

The root development command is `corepack pnpm dev`. It launches the dashboard,
server, and bundled Sample Checkout through `scripts/dev.mjs`.

## Real data inspected

- Projects: TOWERDESK, Outcome Walkthrough Fixture, and Sample Checkout.
- TOWERDESK had a persisted production target, saved authentication, one saved
  journey, and one persisted external runner-error result.
- Outcome Walkthrough Fixture supplied a real authentication-not-configured
  state without changing persisted data.
- The bundled history returned 12 real runs: failed vulnerable runs and passed
  fixed runs, each with three persisted screenshots.

The harness reads this data from the live APIs and asserts that the rendered
project names, run count, first run ID, statuses, and result href match the API
responses. It does not inject test rows or production mock values.

## Captures

- `project-overview-1440.png`
- `project-overview-1366.png`
- `project-overview-1024.png`
- `project-overview-incomplete-1440.png`
- `project-overview-latest-result-1440.png`
- `runs-list-1440.png`
- `runs-list-1366.png`
- `runs-list-1024.png`
- `runs-list-390.png`

The small circular `N` visible in some captures is the Next.js development
toolbar, not FormCrash UI.

## Findings

Project Overview follows the Stitch direction through its stable dark shell,
clear page title, numbered target stages, selected-project treatment, restrained
cards, amber primary action, semantic environment badges, and real readiness
facts. The production page intentionally omits Stitch's fake KPI counts,
security findings, notifications, account UI, search, and unsupported routes.

Runs List follows the dense table direction while replacing scanner taxonomy
with real FormCrash mode, outcome, evidence, and persisted run identity. Run IDs
remain secondary and monospace. At 1024px the table remains contained in its
horizontal scroller. At 390px the header collapses and every row becomes a
readable key-value card. No tested viewport produced page-level horizontal
overflow.

One concrete defect was found: navigating to `/#history-title` left Sample
Checkout marked current instead of Runs. `ApplicationShell` is now hash-aware,
updates immediately for same-page Next.js navigation, and handles browser
back/forward. A regression test covers this behavior.

## Automated checks

The Playwright harness verifies:

- all required viewports and the real persisted external result;
- one current navigation item after every primary shell navigation action;
- one `main`, no nested `main`, a valid skip-link target, coherent heading
  order, named visible buttons/links, scoped table headers, visible keyboard
  focus, and reduced-motion CSS;
- WCAG AA contrast for representative page titles, supporting copy, primary
  action, environment status, table headers, outcome text, and passed/failed
  statuses;
- real result routing, Guided and Advanced workflow access, URL containment,
  status text, mobile card styles, and absence of fake Stitch scanner content;
- no console errors or uncaught page errors.

Loading, error, and Runs List empty states were not manufactured because real
persisted data was present. Existing component tests remain authoritative for
those states.

Structured machine-readable results are stored in `qa-results.json`. The
reproducible harness is `capture-qa.mjs`.

No commit or push was performed during this QA pass.
