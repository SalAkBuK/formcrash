# FormCrash dashboard

The Next.js dashboard is the persistent operational application for FormCrash
Projects and their related Journeys, Scenarios, Experiments or Configurations,
Runs, and evidence. Its UI identity and information architecture are governed by
[`docs/product/ui-direction.md`](../../docs/product/ui-direction.md); active
behavioral defects and verification gaps are tracked in
[`docs/product/active-bugs.md`](../../docs/product/active-bugs.md).

The current technical entry points expose these capabilities:

- `http://localhost:3000` is the guaranteed bundled Sample Checkout path. It
  starts the existing seeded Impatient User experiment in vulnerable or fixed
  mode, displays persisted sample history, follows live SSE progress, and opens
  the authoritative result at `/runs/<run-id>`.
- `http://localhost:3000/projects` is the reusable external-project path. It
  creates controlled targets, records and replays journeys, captures
  authentication, runs Guided or Advanced repeated-action experiments, and
  displays persisted external results.

These capability paths do not define separate application identities, and their
product lifecycles do not prescribe mandatory page sequencing.

## Runtime boundary

Set `NEXT_PUBLIC_FORMCRASH_SERVER_URL` to the Fastify control-server origin
(`http://localhost:4100` by default). The server must include the dashboard origin
in `FORMCRASH_DASHBOARD_ORIGINS`. The dashboard uses shared Zod-derived types and
focused REST modules plus native `EventSource`; it does not import Playwright,
SQLite, server code, or filesystem paths.

## Live and persisted state

Starting a run waits for HTTP 202 and a durable run ID before navigating. The run
view renders replayed and incoming events by persisted sequence, deduplicates a
repeated sequence, tolerates unknown event types, and retains events during native
EventSource reconnection. After a terminal event it closes the client and reloads
`GET /api/runs/:runId`; SSE data is progress, not the authoritative final model.

Historical terminal routes do not open SSE. Screenshot `<img>` and open links use
the run-owned artifact API. A missing artifact or failed image load produces an
unavailable card while assertion and request/order evidence remain usable.

## Current model and limits

The sample runner and external journey workflow intentionally use different
server read models. The seeded sample is not exposed as a user-recorded journey
and no fake recording metadata is created for it.

Guided Test consumes server-ranked request candidates and preselects only a
high-confidence recommendation. Review and ambiguous outcomes require explicit
selection; no-candidate results do not fabricate a matcher. Advanced mode shows
server score, rank, classification, confidence, and reasons and can persist a
manual override. Guided and Advanced modes consume the same server-owned
assertion recommendation sets. High-confidence network checks are enabled by
default; review checks require approval. Users can disable recommendations,
edit supported values, and add manual Advanced assertions. The immutable
version records generated, modified, disabled, and manual provenance.
Deterministic result diagnosis remains dashboard-owned. There is no
generic business-record assertion, failed-versus-fixed
comparison, report export, Playwright export, external SSE, or failure injector
beyond repeated click/submit behavior.

Run dashboard checks with:

```sh
pnpm --filter @formcrash/dashboard typecheck
pnpm --filter @formcrash/dashboard test
pnpm --filter @formcrash/dashboard build
```
