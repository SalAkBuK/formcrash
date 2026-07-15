# FormCrash control server

The Fastify server at `http://localhost:4100` is the sole owner of run
orchestration, Playwright, SQLite, and screenshot files.

## Sample run lifecycle

`POST /api/sample-runs` validates `{ "mode": "vulnerable" | "fixed" }`, acquires
the one-browser lock, persists the run and immutable snapshots, and returns HTTP
202 with `runId`, `detailUrl`, and `eventsUrl`. Managed asynchronous execution then
drives Chromium. Failures after persistence terminate the same run as
`runner_error`; the coordinator logs rejected work, releases its lock in `finally`,
and server shutdown waits for managed work.

`GET /api/runs/:runId/events` validates existence before opening SSE. It subscribes
before replaying persisted events, deduplicates by sequence, publishes new events
only after SQLite append succeeds, and sends standard frames using the sequence as
the SSE ID. `Last-Event-ID` resumes strictly after the acknowledged sequence.
Terminal replay/live events close the stream; disconnect and shutdown remove all
process-local subscriptions. SQLite remains the durable source of truth.

## Local CORS

`FORMCRASH_DASHBOARD_ORIGINS` is a comma-separated list of absolute dashboard
origins and defaults to `http://localhost:3000`. Wildcards are invalid. The server
allows only the GET, POST, and OPTIONS methods plus Content-Type and Last-Event-ID
headers needed by the dashboard and SSE reconnect path.

The current routes support only the bundled sample. There is no arbitrary target,
recording, comparison, authentication, queue, Redis, or WebSocket support.
