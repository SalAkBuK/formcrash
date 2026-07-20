# FormCrash Lab

FormCrash Lab is a local pre-production resilience-testing workbench for transactional web journeys.

It records or replays a critical user flow, deliberately repeats one important action, evaluates explicit recovery expectations, and captures evidence showing whether the application handled the failure safely.

The bundled demo focuses on a common production bug:

> What happens when an impatient user submits checkout twice?

FormCrash runs the same experiment against a vulnerable checkout and a fixed checkout so the failure and the recovery are both visible.

## Why this exists

Many damaging bugs are caused by timing and repeated user actions rather than a complete application crash.

Examples include:

- duplicate orders;
- duplicate payments;
- duplicate form submissions;
- stale or conflicting UI state;
- buttons that remain active while a request is processing;
- backends that do not enforce idempotency.

These failures are difficult to reproduce consistently with manual testing.

FormCrash turns one of those failure modes into a repeatable local experiment with:

- a controlled Chromium browser;
- deterministic repeated-action injection;
- explicit assertions;
- persisted run history;
- screenshots and ordered evidence;
- plain-language results.

## Bundled demo

The guaranteed demo path is included in the repository.

It contains:

- a vulnerable checkout that creates two orders when submitted twice;
- a fixed checkout with client locking and server idempotency;
- one deterministic **Impatient User** experiment;
- one recovery assertion: no more than one order should be created;
- three screenshots captured during each run;
- persisted events, assertions, and observed request evidence.

### Expected results

| Mode       | Expected result | Created orders |
| ---------- | --------------: | -------------: |
| Vulnerable |          Failed |              2 |
| Fixed      |          Passed |              1 |

The failed assertion in vulnerable mode is an expected product result, not a server error.

## Quick start

### Prerequisites

- Node.js `24.11.0`
- Corepack
- pnpm `11.13.0`
- Chromium installed through Playwright

### Install

```bash
corepack enable
corepack prepare pnpm@11.13.0 --activate
pnpm install
pnpm --filter @formcrash/server exec playwright install chromium
```

If `pnpm` is not available directly on Windows, run the same commands through Corepack:

```bash
corepack pnpm install
corepack pnpm --filter @formcrash/server exec playwright install chromium
```

### Start the workspace

```bash
pnpm dev
```

This starts:

| Application     | URL                   |
| --------------- | --------------------- |
| Dashboard       | http://localhost:3000 |
| Control server  | http://localhost:4100 |
| Sample checkout | http://localhost:4200 |

Application startup never downloads a browser. Chromium must be installed explicitly before the first run.

## Judge walkthrough

1. Start the workspace with `pnpm dev`.
2. Open http://localhost:3000.
3. Select **Vulnerable**.
4. Choose **Run Sample Experiment**.
5. Watch FormCrash open Chromium and replay the checkout.
6. Confirm the result shows:
   - a failed recovery assertion;
   - two created orders;
   - the ordered run timeline;
   - before, disruption, and settled-state screenshots.
7. Return to the dashboard.
8. Select **Fixed**.
9. Run the identical experiment again.
10. Confirm the result passes with one created order.

Recent runs are persisted and can be reopened after refreshing the dashboard or restarting the server.

## How it works

The sample experiment follows this sequence:

```text
Reset sample state
→ Open the checkout
→ Complete the recorded journey
→ Reach the critical submit action
→ Trigger the action twice, 100 ms apart
→ Observe requests and created orders
→ Evaluate the duplicate-protection assertion
→ Capture screenshots and persist the result
```

The server owns the browser, execution state, database, screenshots, and SSE event stream. The dashboard only calls the server APIs and renders the authoritative result.

## Project structure

```text
apps/
  dashboard/        Next.js control interface
  server/           Fastify server, Playwright runner, persistence, SSE
  sample-checkout/  Vulnerable and fixed checkout target

packages/
  contracts/        Shared Zod schemas and TypeScript contracts
  test-kit/         Test builders and fixtures
  config/           Shared TypeScript configuration

docs/
  product/          Product requirements
  architecture/     Runner, replay, recommendation, and evidence design
  implementation/   Roadmap and implementation boundaries

var/
  database/         Generated SQLite database
  screenshots/      Generated run screenshots
  auth/             Generated browser storage state
  exports/          Reserved generated exports
```

Generated runtime data under `var/` is ignored by Git.

## Testing an external application

The bundled checkout is the guaranteed demo path.

The reusable external workflow is available at:

http://localhost:3000/projects

It supports:

1. creating a project for a controlled HTTP or HTTPS target;
2. recording a same-tab journey in visible Chromium;
3. reviewing and saving the journey;
4. selecting a recorded click or form submission as the critical action;
5. discovering requests caused by that action;
6. creating an Impatient User experiment;
7. running the experiment with network and interface assertions;
8. reviewing persisted events, evidence, warnings, and screenshots.

Guided Test is the default workflow. Advanced mode exposes the full matcher, assertion, variable, authentication, and hook configuration.

### Supported recorded actions

- top-frame navigation;
- click;
- text input;
- checkbox and radio changes;
- dropdown selection;
- form submission.

### Explicitly unsupported or limited

- iframes;
- CAPTCHA;
- file uploads;
- third-party payment pages;
- drag and drop;
- contenteditable editors;
- new-tab workflows;
- unsupported Shadow DOM targets.

Unsupported actions produce warnings rather than being silently recorded.

## Authentication and runtime variables

FormCrash can capture and restore browser storage state for a controlled test application.

Runtime variables use this format:

```text
FORMCRASH_VAR_<NAME>
```

Example:

```text
FORMCRASH_VAR_API_TOKEN
```

Values may also be supplied ephemerally for a replay or experiment run.

Secret values and values derived from them are resolved in memory and excluded from persisted snapshots, API responses, events, errors, and screenshot metadata. Sensitive browser fields are added to the screenshot mask list when their target locator remains available.

## Safety boundaries

FormCrash is intended for local, staging, and controlled pre-production environments.

Production targets require explicit confirmation before replay, discovery, or repeated-action execution.

Before-run and cleanup hooks accept only bounded `POST` or `DELETE` requests. They should only be used against controlled test environments.

The runner executes one browser run at a time. A concurrent sample-run request receives HTTP `409` and is not queued.

## Configuration

| Variable                           | Default                       | Purpose                         |
| ---------------------------------- | ----------------------------- | ------------------------------- |
| `DASHBOARD_PORT`                   | `3000`                        | Dashboard port                  |
| `SERVER_PORT`                      | `4100`                        | Control-server port             |
| `SAMPLE_CHECKOUT_PORT`             | `4200`                        | Sample-checkout port            |
| `SERVER_HOST`                      | local default                 | Control-server bind address     |
| `NEXT_PUBLIC_FORMCRASH_SERVER_URL` | `http://localhost:4100`       | Browser-visible server URL      |
| `FORMCRASH_DASHBOARD_ORIGINS`      | `http://localhost:3000`       | Allowed dashboard origins       |
| `FORMCRASH_BROWSER_HEADLESS`       | `false`                       | Run visible Chromium by default |
| `FORMCRASH_BROWSER_TIMEOUT_MS`     | `10000`                       | Bounded browser timeout         |
| `SAMPLE_CHECKOUT_BASE_URL`         | `http://localhost:4200`       | Bundled checkout target         |
| `FORMCRASH_DATABASE_PATH`          | `./var/database/formcrash.db` | SQLite database path            |
| `FORMCRASH_ARTIFACT_ROOT`          | `./var`                       | Generated artifact root         |

The root launcher reads environment variables but does not load `.env` files automatically.

## Verification

Run the complete non-destructive verification suite:

```bash
pnpm verify
```

Individual commands:

```bash
pnpm format:check
pnpm lint
pnpm typecheck
pnpm test
pnpm build
```

Persistence tests use temporary directories and do not write to the active `var/` directory.

## Resetting local state

To clear FormCrash run history:

1. stop the server;
2. remove generated database files under `var/database/`;
3. remove generated run directories under `var/screenshots/`;
4. keep the committed `.gitkeep` files;
5. restart the workspace.

To clear only the bundled checkout's in-memory orders and idempotency state, use its reset action or:

```text
POST http://localhost:4200/api/test-support/reset
```

## Current scope

Implemented:

- vulnerable and fixed sample checkout;
- deterministic duplicate-submit experiment;
- visible Playwright execution;
- persisted runs, events, assertions, and screenshots;
- replayable SSE progress;
- external project creation;
- journey recording and replay;
- authentication capture;
- runtime variables and secret redaction;
- request discovery and deterministic ranking;
- Guided and Advanced experiment configuration;
- network, UI, field-retention, and URL assertions;
- persisted external-run evidence.

Not currently implemented:

- dedicated failed-versus-fixed comparison reports;
- PDF or HTML exports;
- CI orchestration;
- cloud execution;
- additional failure injectors;
- generic business-record count inference;
- runtime OpenAI or other LLM features.

FormCrash was built with Codex, but it has no runtime AI dependency.

## Documentation

- Product requirements: `docs/product/prd.md`
- Implementation roadmap: `docs/implementation/roadmap.md`
- High-fidelity replay contract: `docs/architecture/high-fidelity-replay.md`
- Request recommendation model: `docs/architecture/request-recommendation.md`
- Assertion recommendation model: `docs/architecture/assertion-recommendation.md`
