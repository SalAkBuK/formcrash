# FormCrash dashboard

The Next.js dashboard at `http://localhost:3000` is the sample-only user workflow
for Chunk 4. It can start the seeded Impatient User experiment in vulnerable or
fixed mode, display bounded persisted history, follow a nonterminal run over SSE,
and inspect one authoritative terminal result at `/runs/<run-id>`.

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

## Current limits

This dashboard supports only the bundled Sample Checkout and one saved experiment
version. It does not create projects, record or edit journeys, target arbitrary
applications, compare failed/fixed runs, or export reports.

Run dashboard checks with:

```sh
pnpm --filter @formcrash/dashboard typecheck
pnpm --filter @formcrash/dashboard test
pnpm --filter @formcrash/dashboard build
```
