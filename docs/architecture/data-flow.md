# Priority 0 data flow

The eventual submission-critical lifecycle is below. Chunk 2 implements an API-
driven, in-memory version of the browser execution core; persistence, dashboard
control, and comparison remain deferred.

```mermaid
sequenceDiagram
  actor Developer
  participant Dashboard
  participant Server as Control server
  participant Store as SQLite + filesystem
  participant Browser as Visible Chromium
  participant Checkout as Sample checkout

  Developer->>Dashboard: Request saved experiment run
  Dashboard->>Server: POST run command
  Server->>Store: Persist immutable experiment snapshot
  Server->>Browser: Launch and own Chromium
  Browser->>Checkout: Replay saved checkout journey
  Server->>Browser: Trigger Impatient User at Submit Order
  Browser->>Checkout: Repeated submission requests
  Server->>Server: Collect evidence and evaluate assertions
  Server->>Store: Append events and artifact metadata
  Server-->>Dashboard: Stream ordered SSE events
  Dashboard->>Server: Request comparable completed runs
```

## Lifecycle responsibilities

1. **Dashboard requests a run — partially implemented.** `POST /api/sample-runs`
   accepts a target mode, but the dashboard does not call it yet.
2. **Server snapshots the saved experiment — not implemented.** The snapshot will
   include journey steps, injector configuration, assertion configuration, and
   relevant target settings so future edits cannot rewrite history.
3. **Server launches visible Chromium — implemented.** Only the server owns
   Playwright and uses a fresh context per run; tests override visible mode to
   headless.
4. **Runner executes journey steps — implemented for one hardcoded journey.**
   Steps execute in order and missing targets produce identified runner errors.
5. **Impatient User acts at Submit Order — implemented.** Two trigger attempts
   occur exactly 100 ms apart at the configured step.
6. **Evidence is collected — partially implemented.** Browser order-request
   metadata and sample test-support state are captured in memory. Screenshots are
   deferred.
7. **Assertions are evaluated — implemented for one assertion.** Created-order
   count determines pass/fail; evidence failures remain runner errors.
8. **Events and artifacts are persisted — not implemented.** Run events append in
   order. Artifact metadata points to server-owned files rather than database
   blobs.
9. **Dashboard receives live events — not implemented.** One SSE stream per run
   carries versioned event envelopes after the REST command returns.
10. **Completed runs become comparable — not implemented.** Only runs of the same
    saved experiment can form the core failed-versus-fixed comparison.

REST is used for finite commands and queries. SSE is used for one-way ordered
progress because the MVP does not require bidirectional socket messaging.
