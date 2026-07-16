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

## External project lifecycle

The server also owns persisted projects, recording sessions, user-recorded
journey versions, saved authentication state, runtime declarations, bounded
before/after hooks, request discovery, immutable external Impatient User
versions, external runs, assertions, events, and screenshots. External
execution is currently synchronous over REST and has no SSE or stop endpoint.

Request discovery returns a server-owned deterministic ranking with stable
candidate IDs, scores, classifications, confidence, reasons, and one of
`recommended`, `review`, `ambiguous`, or `no_candidate`. Similar plausible
mutations are never silently selected. Experiment versions persist bounded
selection provenance, including confirmed recommendations and manual overrides,
without request/response bodies, headers, cookies, auth state, or runtime
secrets. See
[`docs/architecture/request-recommendation.md`](../../docs/architecture/request-recommendation.md).

Runtime resolution carries a sensitivity taint and source set with every value.
Direct secrets, explicitly sensitive journey/assertion values, mixed templates,
and transitive variable dependencies remain sensitive. Only untainted resolved
values can enter `external_runs.resolved_values_json`; resolved hook headers and
bodies remain ephemeral and hook events contain only method, origin, path,
status, and generic failure text.

The seeded Sample Checkout definitions remain separate from generic
user-recorded journey reads. Sample execution uses the sample-run APIs and
runner; external journey APIs intentionally return only journeys with recording
metadata.

## Local CORS

`FORMCRASH_DASHBOARD_ORIGINS` is a comma-separated list of absolute dashboard
origins and defaults to `http://localhost:3000`. Wildcards are invalid. The server
allows only the GET, POST, and OPTIONS methods plus Content-Type and Last-Event-ID
headers needed by the dashboard and SSE reconnect path.

There is no failed-versus-fixed comparison, report export, Playwright export,
external SSE, queue, Redis, or WebSocket support. Automatic assertion
recommendation and result diagnosis remain dashboard-owned.
