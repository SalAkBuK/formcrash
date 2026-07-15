# Priority 0 technical checklist

This checklist translates the locked submission-critical path into objective
evidence. An item is complete only when its stated verification can be repeated.

## Bundled sample checkout

- [ ] A clean install starts the checkout on its documented configurable port
      without an account, API key, external service, or control server.
- [ ] The journey exposes cart, contact, shipping, review, submit, and confirmation
      states using only fake product, customer, address, and payment-free data.
- [ ] Every saved-journey target has a documented stable `data-formcrash` selector
      covered by an automated selector-contract test.
- [ ] An order-inspection surface returns the exact records created in the current
      local sample session/store.
- [ ] Reset removes all sample orders and restores deterministic initial state in
      an automated integration test.
- [ ] Two or three rapid submissions create the same number of accepted order
      records in vulnerable mode in repeated integration runs.
- [ ] The identical rapid submissions create exactly one accepted order record in
      fixed mode, with both a disabled/in-progress UI and server-side idempotency
      independently tested.

## Saved journey and experiment

- [ ] First launch exposes a seeded Sample Checkout project, saved checkout
      journey, and Impatient User experiment without manual creation.
- [ ] The saved journey lists every action in execution order and targets the final
      Submit Order step explicitly.
- [ ] The saved experiment records trigger count and allowed interval; replay uses
      those exact values rather than random timing.
- [ ] At least one saved assertion states that no more than one matching order may
      be created.
- [ ] A persisted experiment version is immutable after a run references it.
- [ ] Each run stores a complete versioned configuration snapshot whose hash and
      serialized content remain unchanged when the current experiment is edited.

## Controlled Chromium replay

- [ ] A run command launches headed Chromium from the control server process and
      no dashboard code imports Playwright.
- [ ] A second run command while one is active returns a documented conflict and
      does not create or queue another browser run.
- [ ] The runner executes saved actions in order and records the step number for
      every start and completion event.
- [ ] A missing selector terminates as an inspectable replay/runner error and no
      later journey step executes.
- [ ] The Impatient User injector triggers only at Submit Order and records each
      attempted trigger with a relative timestamp.
- [ ] Stop closes browser resources and transitions `running -> stopping ->
incomplete` in an integration test.
- [ ] Chromium launch or control failures end as `runner_error`, never `failed`.

## Evidence, assertions, and persistence

- [ ] The server captures matching submission-request count, response status, and
      created-order count from actual run behavior.
- [ ] Every persisted run event has a unique ID, run ID, server sequence, event
      type, non-negative relative time, recorded time, schema version, and JSON
      payload accepted by the shared contract.
- [ ] Run events are append-only; automated persistence tests prove existing
      events cannot be updated or reordered.
- [ ] The duplicate-protection assertion stores expected and observed counts plus
      an independent `passed`, `failed`, `not_evaluated`, or `error` status.
- [ ] Vulnerable mode consistently ends `failed` with observed order count greater
      than one across a documented repeated-run test.
- [ ] Fixed mode consistently ends `passed` with observed order count exactly one
      across the identical repeated-run test.
- [ ] Server restart preserves runs, snapshots, events, assertion results, and
      artifact metadata.
- [ ] SQLite contains metadata only; a database inspection confirms no binary
      screenshots or unmasked sensitive input values are stored.

## Live result and comparison

- [ ] Starting the saved experiment from the dashboard requires no terminal
      command after the three applications are running.
- [ ] SSE delivers persisted run events in server sequence and reconnection from a
      known event ID neither loses nor duplicates an event.
- [ ] The dashboard visibly distinguishes current step, disruption triggers,
      request/order counts, assertion result, overall result, incomplete, and runner
      error.
- [ ] A completed vulnerable result identifies the earliest failed assertion and
      displays the underlying request/order evidence chronologically.
- [ ] Only two runs of the same experiment/version lineage can be selected for the
      Priority 0 comparison; invalid pairs receive a clear reason.
- [ ] The comparison shows experiment configuration, disruption step, assertion
      results, request/order counts, final state, and duration for both runs.
- [ ] A configuration difference is called out and cannot be presented as an
      identical replay.
- [ ] An end-to-end test proves a failed vulnerable run and passed fixed run can be
      produced and compared from a clean sample reset.

## Submission reliability

- [ ] Clean-environment installation and start instructions are executed exactly
      as documented on every supported development platform.
- [ ] The complete dashboard-driven vulnerable run, fixed replay, and comparison
      completes in under three minutes in a timed rehearsal.
- [ ] At least ten consecutive clean-reset Priority 0 demonstrations produce the
      expected failed-versus-passed outcomes without runner errors.
- [ ] No UI, API, README, or report claims journey recording, other experiments,
      screenshots, or exports work before their corresponding verified chunk ships.
- [ ] No real payment, customer, credential, or personal data appears in fixtures,
      persisted events, logs, or exported evidence.
