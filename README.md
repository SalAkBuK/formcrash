# FormCrash Lab

FormCrash Lab is a local pre-production resilience-testing workbench for
transactional web journeys. It is designed to replay a controlled journey,
introduce one deliberate failure, evaluate explicit recovery expectations, and
compare behavior before and after an application fix.

The locked product requirements are in [`docs/product/prd.md`](docs/product/prd.md).
Priority 0 is the duplicate checkout-submission demonstration described there.

## Repository boundaries

- `apps/dashboard` — Next.js interface whose homepage starts the guaranteed
  bundled experiment and whose `/projects` route records and tests controlled
  external applications. It communicates with the control server over REST/SSE
  and never launches browsers or reads the FormCrash database.
- `apps/server` — Fastify modular monolith that owns health, the hardcoded
  sample-run API, Playwright execution, assertions, SQLite metadata, and
  filesystem screenshot evidence, and persisted SSE replay/live publication.
- `apps/sample-checkout` — independent Next.js target application implementing
  the bundled vulnerable-versus-fixed checkout demonstration.
- `packages/contracts` — runtime-validated cross-boundary schemas and inferred
  TypeScript types.
- `packages/test-kit` — builders and fixtures for tests only.
- `packages/config` — shared strict TypeScript configuration.

There is no runtime OpenAI or other AI dependency.

## Prerequisites

- Node.js 24 LTS (the repository pins `24.11.0`)
- pnpm `11.13.0` through Corepack

```sh
corepack enable
corepack prepare pnpm@11.13.0 --activate
pnpm install
```

Install the server-owned Chromium binary explicitly after dependencies:

```sh
pnpm --filter @formcrash/server exec playwright install chromium
```

Normal application startup never downloads browsers. Playwright Library belongs
only to the control server; the dashboard and sample checkout do not own it.

## Development

```sh
pnpm dev
```

This starts all three applications together:

| Application     | Default URL             | Environment variable   |
| --------------- | ----------------------- | ---------------------- |
| Dashboard       | `http://localhost:3000` | `DASHBOARD_PORT`       |
| Control server  | `http://localhost:4100` | `SERVER_PORT`          |
| Sample checkout | `http://localhost:4200` | `SAMPLE_CHECKOUT_PORT` |

The server bind address is configurable with `SERVER_HOST`. Copy `.env.example`
values into your shell or local environment tooling as needed. The root launcher
reads environment variables; it does not load `.env` files implicitly.

The dashboard's browser-visible server URL is configured separately with
`NEXT_PUBLIC_FORMCRASH_SERVER_URL`.

The control server permits only configured dashboard origins. Set
`FORMCRASH_DASHBOARD_ORIGINS` to a comma-separated list of absolute origins; the
default is `http://localhost:3000`. Wildcard CORS is rejected. When changing the
dashboard port, update this setting too.

Runner configuration:

| Variable                       | Default                       | Purpose                                                    |
| ------------------------------ | ----------------------------- | ---------------------------------------------------------- |
| `FORMCRASH_BROWSER_HEADLESS`   | `false`                       | Use visible Chromium by default; set `true` in automation. |
| `FORMCRASH_BROWSER_TIMEOUT_MS` | `10000`                       | Bounded target, action, and evidence timeout.              |
| `SAMPLE_CHECKOUT_BASE_URL`     | `http://localhost:4200`       | Already-running bundled checkout target.                   |
| `FORMCRASH_DATABASE_PATH`      | `./var/database/formcrash.db` | SQLite metadata path, resolved from the repository root.   |
| `FORMCRASH_ARTIFACT_ROOT`      | `./var`                       | Root for server-owned relative artifact paths.             |
| `FORMCRASH_DASHBOARD_ORIGINS`  | `http://localhost:3000`       | Dashboard origins allowed to call REST and SSE endpoints.  |

Project runtime variables use `FORMCRASH_VAR_<NAME>` environment keys. For
example, a declaration named `API_TOKEN` reads `FORMCRASH_VAR_API_TOKEN`.
Values may instead be supplied ephemerally when replaying or running an external
experiment. Only variables referenced by the selected journey, hooks, or
assertions are required; unused declarations do not block execution. Secret
values and every value transitively derived from them are resolved in memory
only. Sensitivity follows variable dependencies and mixed templates, so derived
values are excluded from API responses, events, persisted safe snapshots,
errors, and screenshot metadata. Browser fields populated from
sensitive-derived values are added to the existing locator-based screenshot
mask list; masking still depends on the target locator remaining available.

Startup creates the configured directories, applies ordered migrations, and
idempotently seeds the bundled Sample Checkout project, journey, Impatient User
experiment version 1, and duplicate-protection assertion. Migrations can also be
run explicitly. Applied migration SHA-256 checksums prevent an edited historical
migration from being accepted silently:

```sh
pnpm --filter @formcrash/server db:migrate
```

## Verification

```sh
pnpm format:check
pnpm lint
pnpm typecheck
pnpm test
pnpm build
pnpm verify
```

`pnpm verify` runs all non-destructive checks and production builds. Tests cover
shared contracts, control-server health, sample-checkout validation, route
behavior, reset behavior, and sequential/concurrent duplicate handling.
Persistence tests always use temporary directories and never write into `var/`.

## Bundled sample checkout

Open one explicit target mode after starting the workspace:

- Vulnerable: `http://localhost:4200/?mode=vulnerable`
- Fixed: `http://localhost:4200/?mode=fixed`

The sample uses two deterministic fictional products and fake local customer
information. It has no payment fields, account, external service, or dependency
on the FormCrash control server. The process-local store resets when the sample
checkout process restarts or when the UI/API reset action is used.

Local endpoints:

- `POST /api/orders` — validate and submit a server-priced fake order.
- `GET /api/test-support/state` — inspect request attempts and created orders.
- `POST /api/test-support/reset` — clear sample state and idempotency records.

See
[`apps/sample-checkout/src/checkout/README.md`](apps/sample-checkout/src/checkout/README.md)
for the selector contract and repeatable vulnerable/fixed verification steps.

## Dashboard-driven Priority 0 browser run

Open `http://localhost:3000`, select **Vulnerable** or **Fixed**, and choose
**Run Sample Experiment**. The dashboard navigates only after the server returns
a durable run ID, follows persisted and live SSE events, then reloads the
authoritative result. Recent runs survive server/dashboard restarts and open at
stable URLs such as `http://localhost:3000/runs/<run-id>`.

The bundled sample is the guaranteed judge/demo path. **Test Your Application**
opens `http://localhost:3000/projects`, the reusable external-project workflow
for recording, Guided Test, Advanced configuration, and persisted external
results. The sample seed and recorded external journeys intentionally use
different current read models; the sample is not disguised as a recorded
journey.

The result separates request attempts from created order records, shows the
recovery assertion, presents the ordered timeline, and loads screenshot bytes
through run-owned artifact API URLs. Missing screenshots degrade to explicit
unavailable cards without hiding the remaining evidence.

### Control-server API

`POST /api/sample-runs` accepts one predefined mode and returns `202 Accepted`
after the run and immutable snapshots exist, before Chromium execution finishes:

```powershell
$vulnerable = Invoke-RestMethod -Method Post `
  -Uri http://localhost:4100/api/sample-runs `
  -ContentType 'application/json' `
  -Body '{"mode":"vulnerable"}'
$vulnerable | ConvertTo-Json
```

The response contains `runId`, status `created`, `detailUrl`, and `eventsUrl`.
Browser execution continues asynchronously. Vulnerable mode ultimately persists
`failed` with two orders; fixed mode persists `passed` with one. Assertion failure
is a run result, not an HTTP error.

The current runner allows one browser run at a time. A concurrent request receives
HTTP 409 and is not queued. The hardcoded experiment triggers Submit Order twice,
100 ms apart, and checks exactly one assertion: no more than one order should be
created.

Persisted inspection endpoints:

- `GET /api/runs?limit=20&offset=0` — newest-first bounded history.
- `GET /api/runs/:runId` — immutable snapshots, ordered events, assertion
  results, observed evidence, warnings, and artifact metadata.
- `GET /api/runs/:runId/events` — `text/event-stream` replay plus live events.
  Frames use persisted sequence as `id`, `event: run-event`, and validated JSON
  data. Native EventSource reconnection sends `Last-Event-ID`; replay resumes
  after that sequence without inventing transient history.
- `GET /api/runs/:runId/artifacts/:artifactId` — PNG content located through
  run-owned database metadata, never a client filesystem path.

External target and journey endpoints:

- `POST /api/projects`, `GET /api/projects`, and `GET /api/projects/:projectId`
  — create and inspect controlled HTTP/HTTPS targets with an explicit `local`,
  `staging`, or `production` environment classification.
- `DELETE /api/projects/:projectId?force=true` — remove a project and all of its
  recordings, journeys, experiments, runs, screenshots, settings, and saved
  authentication. The bundled sample remains protected.
- `POST /api/projects/:projectId/recordings` — acquire exclusive Chromium
  ownership, open a fresh visible context, and start a server-owned recording.
- `GET /api/projects/:projectId/recordings/:sessionId` and
  `POST .../stop` — inspect lifecycle state and stop with validated ordered steps.
- `POST /api/projects/:projectId/recordings/:sessionId/journeys` — save an
  reviewed recording as a new immutable journey version.
- `GET /api/projects/:projectId/journeys` and `GET /api/journeys/:journeyId`
  — list and read saved generic journeys.
- `DELETE /api/journeys/:journeyId` — remove a journey and its associated
  experiment versions, runs, and screenshots.
- `POST /api/journeys/:journeyId/replay` — replay persisted steps in a fresh
  context and return the failed step, locator, browser URL, and bounded browser
  diagnostic. The request body accepts ephemeral `variables` and
  `confirmProduction`.
- `GET` and `PUT /api/projects/:projectId/settings` — read public execution
  metadata and configure variable declarations plus bounded before/after hooks.
- `POST /api/projects/:projectId/auth-captures` and `POST
.../:captureId/confirm` — open visible Chromium for a developer-managed login
  and persist its browser storage state. `DELETE
/api/projects/:projectId/authentication` clears it.
- `POST /api/projects/:projectId/authentication/test` — load saved state and
  report an obvious login redirect or target-loading failure.
- `POST /api/journeys/:journeyId/request-discovery` — replay through one saved
  click or submit and return sanitized method/path/status candidates caused by
  that target. Discovery executes the real action once and requires production
  confirmation for production projects.
- `POST` and `GET /api/journeys/:journeyId/experiments` — create immutable
  Impatient User versions and list them.
- `GET` or `DELETE /api/external-experiments/:experimentVersionId` — inspect or
  remove a version and its associated run evidence.
- `POST /api/external-experiments/:experimentVersionId/runs` — execute a
  version; production projects require explicit confirmation.
- `GET /api/external-runs?projectId=...&limit=20&offset=0`,
  `GET /api/external-runs/:runId`, and `DELETE /api/external-runs/:runId` —
  list, reload, or remove persisted assertions, request/status evidence, events,
  warnings, and screenshot metadata.

Recording intentionally supports only top-frame navigation, click, text input,
checkbox/radio change, dropdown selection, and form submission. New tabs,
iframes, file uploads, CAPTCHA, third-party payment pages, drag and drop,
contenteditable editors, and unsupported Shadow DOM targets produce explicit
warnings and are not silently recorded. Consecutive input events for one locator
are coalesced; a top-frame navigation immediately caused by a recorded click or
submit is omitted to avoid replaying the same transition twice.

External Impatient User execution replays every step before the selected target,
replaces that target with exactly two or three recorded trigger attempts, and
does not blindly replay the original target afterward. Later steps run only when
the immutable experiment version explicitly enables continuation; otherwise the
runner settles and evaluates final-state assertions immediately after injection.
The optional request matcher compares method and pathname (query parameters are
ignored) and may also constrain the host. Discovery filters obvious static
assets and ranks mutating requests first. Network assertions support maximum and
exact request/success counts, allowed-status checks, and explicit HTTP 5xx
rejection; multiple assertions may be combined in one version.

Before-run and cleanup hooks accept only bounded `POST` or `DELETE` requests and
should exist only in controlled test environments. A failed before-run hook is a
runner error and prevents Chromium launch. A failed cleanup hook is preserved as
a warning because it occurs after experiment evidence is evaluated.

Each successful browser run attempts three full-page PNG captures: immediately
before disruption, immediately after both triggers, and after settled final-state
evidence is read. Artifact metadata includes byte size and a SHA-256 checksum. A
screenshot failure is recorded as an evidence warning and does not change a valid
business assertion into an application failure.

### Manual judge workflow

1. Run `pnpm dev` and open `http://localhost:3000`.
2. Start Vulnerable mode and watch the visible Chromium run plus live timeline.
3. Confirm a failed assertion, two created orders, and all three screenshot cards.
4. Return to history, reopen the run, and refresh its direct URL.
5. Start Fixed mode with the identical saved experiment.
6. Confirm a passed assertion, one created order, the observed request/attempt
   counts, and three screenshots; refresh its direct URL.
7. While a run is active, attempt another `POST /api/sample-runs` and confirm the
   documented `409` response.
8. Stop `pnpm dev` and confirm ports 3000, 4100, and 4200 plus runner Chromium are
   released.

## Runtime storage

Local generated state belongs under `var/`:

- `var/database` for the active SQLite metadata database and SQLite sidecar files.
- `var/runs` reserved for later structured evidence files.
- `var/screenshots/<run-id>` for ordered PNG screenshot evidence.
- `var/auth/<project-id>/storage-state.json` for server-owned authentication
  state; only relative metadata and availability are exposed publicly.
- `var/exports` for generated reports and test starting points.

Generated contents are ignored by Git. The control server is the only owner of
the FormCrash database and artifact layout; screenshot bytes are never stored in
SQLite.

To reset FormCrash metadata during development, stop the server and remove the
generated database files under `var/database/` plus generated run directories
under `var/screenshots/`. Keep the committed `.gitkeep` markers. The next startup
recreates the schema and sample definitions. This deletes FormCrash run history;
it is separate from `POST /api/test-support/reset`, which clears only the sample
checkout's process-local order attempts, orders, and idempotency state.

## Current implementation status

Chunks 0 through 6 are implemented. The bundled checkout supports the complete
fake cart-to-confirmation journey, intentional vulnerable duplicate creation,
fixed client locking, fixed server idempotency, visible local evidence, and reset.
The control server now runs the one hardcoded checkout journey in Chromium,
injects the first Impatient User experiment, persists immutable run snapshots,
ordered events and assertion results, captures three filesystem screenshots, and
publishes replayable live progress. The dashboard now creates persisted projects,
records supported manual same-tab journeys in visible Chromium, reviews safe or
masked steps and their ranked locators, saves immutable journey versions, and
replays them with exact failed-step reporting. Project settings now capture and
restore authenticated browser state, declare safe runtime inputs and repeatable
data hooks, test saved state for obvious login redirects, and reject only
unresolved variables used by the execution before browser launch. Saved click
or submit steps accept immutable external Impatient User versions with request
discovery plus multiple network, UI, field-retention, and final-URL assertions.
Guided Test is the default external-testing workflow: it recommends the last
recorded submit or click, replays it once to rank the resulting browser
requests, prefers a related state-changing request, generates unique common
field values, normalizes adjacent recorded fills, creates four duplicate-safety
network assertions, saves an immutable experiment version, runs it, and explains
the outcome in plain language. Before opening a browser it now scores journey
readiness, blocks unresolved runtime values or missing replay targets, and warns
about brittle locators, authentication, cleanup, recorder warnings, and
production side effects. Users can choose an accidental double-click, impatient
triple-click, or server duplicate-handling recipe without configuring trigger
counts or assertion types. Failed results include concrete client, server,
authentication, locator, or request-discovery actions. The full settings,
matcher, and assertion builder remains available in Advanced mode.
Production targets require explicit confirmation before replay, discovery, or
repeated triggers. External runs persist ordered sanitized events, assertion
outcomes, matched network evidence, warnings, and screenshots; the dashboard
lists prior runs, displays request statuses and screenshot previews, and exposes
deliberate cleanup controls. The recorder and runner are verified against both the
separate `fixtures/external-target` application and the bundled sample checkout.
Request ranking and recommendation are currently dashboard-owned heuristics, not
a server-owned recommendation contract with persisted confidence or provenance.
It does **not** implement failed-versus-fixed comparison, reports, exports, other
failure injectors, CI orchestration, or cloud execution.

Priority 0 must be built in this order:

1. Bundled vulnerable and fixed sample checkout.
2. Hardcoded checkout journey and Impatient User browser runner.
3. Duplicate assertion, persistence, and evidence.
4. Dashboard run control and live progress.
5. External target and journey capture.
6. External Impatient User experiments with authentication, runtime variables,
   repeatable test data, discovery, and browser/network/UI assertions.

See [`docs/implementation/roadmap.md`](docs/implementation/roadmap.md) for chunk
boundaries and objective exit criteria.
