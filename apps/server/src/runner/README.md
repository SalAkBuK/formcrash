# Priority 0 sample runner

The control server owns the first executable FormCrash slice. It uses Playwright
Library directly—never Playwright Test in production—to launch a fresh Chromium
browser and context for each run.

## Current execution contract

- Endpoint: `POST /api/sample-runs` with `{ "mode": "vulnerable" }` or
  `{ "mode": "fixed" }`.
- Latest in-memory result: `GET /api/sample-runs/latest`.
- Journey: one structured, hardcoded sample checkout journey using only the
  documented `data-formcrash` selector contract.
- Experiment: `impatient_user`, two Submit Order triggers, 100 ms apart.
- Assertion: no more than one created order.
- Concurrency: one active run; additional requests receive HTTP 409 and are not
  queued.

Completed assertion failures return HTTP 200 with run status `failed`. Target,
browser, journey, evidence, and cleanup failures produce a structured
`runner_error` result without a public stack trace.

## Browser and target configuration

```text
FORMCRASH_BROWSER_HEADLESS=false
FORMCRASH_BROWSER_TIMEOUT_MS=10000
SAMPLE_CHECKOUT_BASE_URL=http://localhost:4200
```

Visible Chromium is the default. Automated integration tests override it to
headless mode. Install Chromium explicitly:

```sh
pnpm --filter @formcrash/server exec playwright install chromium
```

The runner checks target readiness with a bounded timeout but does not start the
sample checkout. Both applications must already be running for manual API use.

## Execution flow

The runner resets sample state, opens the selected mode, fills deterministic fake
contact/shipping data, injects the experiment at Submit Order, waits on explicit
UI and application-state conditions, reads test-support state, and evaluates the
assertion. Browser-observed order requests exclude request bodies and unrelated
endpoints.

Every journey step emits started/completed events. Request callbacks append to the
same synchronous event log, so event sequences remain monotonic even when network
callbacks overlap. Context and browser cleanup run before the terminal run event.

## In-memory limitation

Only the latest completed result is retained, and restarting the server loses it.
There is no SQLite, run history, SSE, screenshot, artifact, comparison, report, or
dashboard integration in Chunk 2.
