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

**User-visible outcome:** The vulnerable run ends failed because more than one
matching order exists, with chronological request/order evidence.

**Backend work:** Add SQLite metadata, migrations, immutable snapshots,
append-only events, duplicate request/record evidence, one recovery assertion,
assertion results, and artifact metadata/filesystem discipline.

**Frontend work:** Only diagnostic rendering required to inspect raw completed
run data; no polished results workflow.

**Tests:** Migration and repository integration, snapshot immutability, event
ordering, restart persistence, vulnerable failure, fixed pass, and missing
evidence/error distinctions.

**Demo checkpoint:** Execute both target modes and inspect persisted events and
independent assertion results after a server restart.

**Explicit non-goals:** Screenshots, full assertion builder, other assertion
types, report export, or generalized evidence ingestion.

**Exit criteria:** Actual order/request evidence determines the assertion; history
survives restart; no screenshot blob or sensitive raw input enters SQLite.

## Chunk 4: Dashboard run workflow and live progress

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
builders, screenshots, report export, or broad visual polish.

**Exit criteria:** A judge can reach and run the seeded scenario without technical
commands; refresh/reconnect does not invent or reorder events.

## Chunk 5: Failed-versus-fixed comparison

**User-visible outcome:** A developer replays the identical experiment against
fixed mode and compares the failed and passed runs side by side.

**Backend work:** Comparable-run query rules, experiment-version validation, and
comparison read model for configuration, assertion, request/order count, final
state, and duration.

**Frontend work:** Fixed replay action, run selection, prominent failed-versus-
passed comparison, configuration-difference warnings, and changed-result emphasis.

**Tests:** Same-version eligibility, incompatible comparison rejection, result
diffing, fixed-mode end-to-end pass, and full vulnerable-versus-fixed workflow.

**Demo checkpoint:** Complete the signature before-and-after proof using one saved
experiment and show two orders versus one.

**Explicit non-goals:** Arbitrary cross-experiment diffs, other experiments,
advanced visualizations, or external target support.

**Exit criteria:** Both runs retain identical experiment snapshots except the
explicit target mode; evidence and assertion changes are unambiguous.

## Chunk 6: Report export and demo hardening

**User-visible outcome:** A completed Priority 0 run exports a human-readable,
sanitized report and the full judge workflow reliably completes within three
minutes.

**Backend work:** Deterministic report generation, safe artifact access, export
failure handling, cleanup limits, setup/reset hardening, and demo diagnostics.

**Frontend work:** Export action, clear error state, first-run sample path, safety
warning, and targeted Priority 0 presentation polish.

**Tests:** Report content and redaction, missing-artifact behavior, clean-install
instructions, repeated demo soak runs, and timing measurement.

**Demo checkpoint:** Run the entire saved vulnerable/fixed comparison and export
its report from a clean setup in under three minutes.

**Explicit non-goals:** Full Playwright-style export, other experiments, recorder,
cloud execution, authentication, teams, or CI integration.

**Exit criteria:** Clean setup is reproducible, repeated demo runs are stable,
export never leaks masked input, and all claims in README match tested behavior.

## Post-Priority-0: Recorder and remaining experiments

**User-visible outcome:** Developers can record supported journeys and configure
Tunnel Drop, Slow Server, Accidental Refresh, and Back-Button Trap with applicable
assertions.

**Backend work:** Recorder protocol, selector strategy, versioned editing,
experiment-specific injectors, additional assertion evaluators, screenshots, run
history, and Playwright-style export starting point.

**Frontend work:** Project/journey management, recording controls and review,
experiment cards/settings, assertion builder, richer results, and empty/error
states from the PRD.

**Tests:** Per-experiment deterministic integration tests, recorder privacy and
unsupported-action tests, assertion matrices, screenshot failure handling, and
export qualification tests.

**Demo checkpoint:** Each added experiment has one controlled sample scenario that
reliably demonstrates its intended recovery question.

**Explicit non-goals:** Later features in PRD section 33, arbitrary experiment
composition, production monitoring, or universal website compatibility.

**Exit criteria:** Each feature meets its PRD acceptance criteria without reducing
the reliability or clarity of the Priority 0 duplicate-submission path.
