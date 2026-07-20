# Chunk 1 visual QA status

> **QA provenance notice:** This document is retained as historical verification
> evidence. It is not current UI authority; `docs/product/ui-direction.md`
> governs current information architecture. Verified behavior and regression
> evidence recorded here must still be preserved.

Date: 2026-07-18

The local FormCrash services were already running and responded successfully:

- Dashboard `/`: HTTP 200
- Dashboard `/projects`: HTTP 200
- Dashboard `/runs/nonexistent-qa-run`: HTTP 200 (loading/not-found route shell)
- Control server `/health`: HTTP 200
- Bundled Sample Checkout `/`: HTTP 200

The required in-app browser was not attached to this Codex session. Browser runtime setup succeeded, but `agent.browsers.list()` returned an empty list and selecting `iab` returned `Browser is not available: iab`. Per the browser-control workflow, no unrelated browser backend was used.

Consequently, the following screenshots could not be captured and have not been fabricated:

- `shell-project-overview.png`
- `shell-journey-detail.png`
- `shell-wizard.png`
- `shell-result.png`
- `shell-runs-list.png`

Automated coverage still verifies shell rendering, real route links, a single active route, route context, semantic primitives, focusable disclosure, labeled controls, copy control naming, and error/loading roles. Responsive CSS was reviewed at desktop, 980px, and 560px breakpoints, but visual viewport verification remains outstanding until the in-app browser is available.
