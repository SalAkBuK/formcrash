# Implementation roadmap

Each chunk is a verifiable vertical slice. Priority 0 work stays ordered; later
experiments cannot displace the duplicate-submission proof.

## Chunk 0: Architecture bootstrap

**User-visible outcome:** Three minimal applications start on documented ports;
the dashboard and checkout identify themselves and the server answers health.

**Backend work:** Fastify bootstrap, validated configuration, structured errors,
graceful shutdown, module boundaries, runner contract, and state definitions.

**Frontend work:** Minimal dashboard and sample-checkout Next.js shells plus a
typed dashboard API-client boundary.

**Tests:** Contract acceptance/rejection, server health injection, strict
type-checking, lint, formatting, and production builds.

**Demo checkpoint:** Run all applications and open both pages plus `/health`.

**Explicit non-goals:** Every product workflow, Playwright, SQLite, checkout
behavior, SSE, evidence, assertions, reports, and comparison.

**Exit criteria:** `pnpm verify` passes; dependency and application boundaries
match the architecture documents; no product feature is claimed as implemented.

## Chunk 1: Sample checkout vulnerable and fixed modes

**Status:** Complete. Verified by store and route concurrency tests, strict
workspace checks, production builds, and direct runtime API smoke tests.

**User-visible outcome:** A developer can complete the fake bundled checkout in
either mode, inspect created fake orders, and reset them. Rapid submission creates
duplicates only in vulnerable mode.

**Backend work:** Implement checkout-owned local order endpoints/state, explicit
mode selection, deterministic reset, vulnerable creation, and fixed server-side
idempotency. This remains inside the sample-checkout application.

**Frontend work:** Cart, contact, shipping, review, submission, confirmation,
mode, order inspection, and reset UI with stable `data-formcrash` selectors.

**Tests:** Domain tests for duplicate acceptance/prevention, route tests, selector
contract tests, and a manual or browser smoke path for both modes.

**Demo checkpoint:** Manually submit rapidly; show two records in vulnerable mode,
reset, and show one record in fixed mode using the same fake input.

**Explicit non-goals:** Control-server integration, Playwright, saved runs,
assertions, recording, or dashboard product screens.

**Exit criteria:** No account, external API, real payment, or control server is
needed; vulnerable behavior fails deterministically and fixed behavior protects at
both UI and server boundaries.

## Chunk 2: Hardcoded Priority 0 journey and Impatient User runner

**Status:** Complete. Unit tests and real headless-Chromium integration prove the
vulnerable failure, fixed pass, event ordering, failure classification, and
single-active-run boundary.

**User-visible outcome:** A control-server command opens visible Chromium and
replays the seeded checkout through repeated Submit Order actions.

**Backend work:** Add Playwright ownership, one-active-run enforcement, seeded
journey/experiment configuration, action execution, Impatient User injector, stop
handling, and live in-memory event publication.

**Frontend work:** No product workflow beyond any minimal diagnostic trigger
needed to exercise the server contract.

**Tests:** State transitions, exclusivity conflict, deterministic injector count
and interval, step failure, stop cleanup, and browser integration against the
sample checkout.

**Demo checkpoint:** One command visibly drives Chromium through the vulnerable
checkout and produces the configured repeated submit requests.

**Explicit non-goals:** General recording, other experiments, durable run history,
comparison, report export, or arbitrary external applications.

**Exit criteria:** The same seeded run reaches the same submit step repeatedly,
browser resources always close, and runner errors remain distinct from tested-app
behavior.

## Chunk 3: Assertion evaluation, persistence, and evidence

**Status:** Complete. Migrations, stable seeded definitions, immutable run
snapshots, append-only events, assertion results, restart persistence, and three
filesystem PNG captures are covered by real SQLite and Chromium tests.

**User-visible outcome:** The vulnerable run ends failed because more than one
matching order exists, with chronological request/order evidence.

**Backend work:** Add SQLite metadata, migrations, immutable snapshots,
append-only events, duplicate request/record evidence, one recovery assertion,
assertion results, and artifact metadata/filesystem discipline.
The current implementation also captures the three PRD screenshot points required
by the expanded Chunk 3 scope.

**Frontend work:** Only diagnostic rendering required to inspect raw completed
run data; no polished results workflow.

**Tests:** Migration and repository integration, snapshot immutability, event
ordering, restart persistence, vulnerable failure, fixed pass, three PNG artifacts,
artifact access control, and missing evidence/error distinctions.

**Demo checkpoint:** Execute both target modes and inspect persisted events and
independent assertion results after a server restart.

**Explicit non-goals:** Full assertion builder, other assertion types, report
export, generalized evidence ingestion, or dashboard workflows.

**Exit criteria:** Actual order/request evidence determines the assertion; history
survives restart; no screenshot blob or sensitive raw input enters SQLite.

## Chunk 4: Dashboard run workflow and live progress

**Status:** Complete. Async durable run acceptance, replayable SSE, narrow CORS,
sample controls, direct history/detail routes, evidence rendering, and dashboard
state tests are implemented. Full-stack verification covers both target modes.

**User-visible outcome:** The dashboard opens the seeded experiment, starts or
stops a run, and displays live steps, disruption, evidence, and final assertion.

**Backend work:** Stabilize REST run resources, conflict/error responses, SSE
stream with event IDs and reconnect behavior, and read models for the seeded flow.

**Frontend work:** Priority 0 experiment summary, run controls, one-active-run
feedback, live timeline, assertion result, and distinct runner-error/incomplete
states.

**Tests:** API contract tests, SSE ordering/reconnect, UI state tests, accessibility
checks, and end-to-end vulnerable workflow.

**Demo checkpoint:** From the dashboard, run vulnerable mode and see two accepted
operations plus a failed duplicate-protection assertion in real time.

**Explicit non-goals:** Project creation, recorder, other experiments, generic
builders, report export, or broad visual polish.

**Exit criteria:** A judge can reach and run the seeded scenario without technical
commands; refresh/reconnect does not invent or reorder events.

## Chunk 5: External target and journey capture

**User-visible outcome:** A developer creates a persisted local project, opens its
controlled URL in visible Chromium, manually records a supported same-tab journey,
reviews the normalized steps and ranked replay locators, saves a versioned journey,
and replays it with an exact failed-step result.

**Backend work:** Focused project/recording/journey APIs, shared browser ownership,
recording lifecycle persistence, pre-application event injection, validated and
privacy-aware event normalization, immutable journey versions, and generic replay.

**Frontend work:** Project creation/list, controlled-environment warning, recording
status and stop control, unsupported-action warnings, step review/editing, locator
inspection, journey saving/listing, and replay result presentation.

**Tests:** URL schemes, browser exclusion and release, selector priority, input
coalescing, sensitive masking, unsupported events, top-frame navigation, durable
steps and versions, exact replay failures, and real Chromium verification against
both a separate external fixture and the bundled checkout.

**Explicit non-goals:** Failure experiments on recorded journeys, comparison,
reports, CI, selector healing, cross-browser support, authentication, or cloud
execution.

**Exit criteria:** The same generic recorder captures and successfully replays a
non-sample controlled local application and the bundled checkout.

## Chunk 6: Attach Impatient User to a recorded journey

**User-visible outcome:** A developer attaches Impatient User to a saved click or
submit step, configures matching browser/network assertions, and runs the failure
experiment against their own saved local journey.

**Explicit non-goals:** Other failure injectors, comparison, reports, CI, cloud
execution, authentication, or production monitoring.

## Later: Remaining experiments and report hardening

**User-visible outcome:** Developers configure Tunnel Drop, Slow Server,
Accidental Refresh, and Back-Button Trap on already-recorded journeys with
applicable assertions, then export qualified evidence.

**Backend work:** Experiment-specific injectors, additional assertion evaluators,
screenshots, generic run history, and a Playwright-style export starting point.

**Frontend work:** Experiment cards/settings, assertion builder, richer results,
report actions, and the related empty/error states from the PRD.

**Tests:** Per-experiment deterministic integration tests, recorder privacy and
unsupported-action tests, assertion matrices, screenshot failure handling, and
export qualification tests.

**Demo checkpoint:** Each added experiment has one controlled sample scenario that
reliably demonstrates its intended recovery question.

**Explicit non-goals:** Later features in PRD section 33, arbitrary experiment
composition, production monitoring, or universal website compatibility.

**Exit criteria:** Each feature meets its PRD acceptance criteria without reducing
the reliability or clarity of the Priority 0 duplicate-submission path.
