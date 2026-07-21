# FormCrash

FormCrash is a local-first, pre-production resilience-testing application for transactional browser journeys.

It records a successful browser journey, identifies the critical state-changing action, deliberately repeats that action under controlled timing, and evaluates approved Outcome Checks. Projects, Journeys, Tests, and Runs remain durable records instead of disappearing into a one-time automation wizard.

The bundled demo focuses on a common production bug:

> What happens when an impatient user submits checkout twice?

FormCrash runs the same Test against a vulnerable checkout and a fixed checkout so the failure and the recovery are both visible.

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

FormCrash turns one of those failure modes into a repeatable Test with:

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
- one deterministic **Impatient User** Test;
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

## Hackathon walkthrough

Use a staging or otherwise controlled target that you are authorized to modify. Rehearse the full path before recording because journey replay and Test execution can create real target data.

1. Open **Projects** and select the controlled target.
2. Record the successful browser journey, then review and save its immutable version.
3. From the Saved Journey, choose **Configure test suite**.
4. Confirm the Critical Action that creates or updates the business record.
5. Replay the journey to capture the successful outcome.
6. When Chromium enters Outcome selection, use the exact generated name, email, phone, or identifier shown in both the dashboard and Chromium banner to locate the newly created record among older rows.
7. Click the matching row, confirmation, or other visible proof and approve the Outcome Check.
8. Review and save. FormCrash creates the Double-click, Triple-click, and Delayed repeat Tests without running them, then returns to their Saved Journey.
9. Run a Test directly from the Journey and open its latest **Run details** without detouring through the Runs directory.
10. Review the immutable configuration, approved browser and request evidence, verdict, timeline, and screenshots.

Generated literals are scoped to the active baseline capture. Reusable Outcome Checks persist templates such as `{{unique.name}}`, not a one-off tenant or customer value.

## Bundled fallback walkthrough

1. Start the workspace with `pnpm dev`.
2. Open http://localhost:3000.
3. Select **Vulnerable**.
4. Choose **Run Sample Experiment** (the bundled legacy demo label).
5. Watch FormCrash open Chromium and replay the checkout.
6. Confirm the result shows:
   - a failed recovery assertion;
   - two created orders;
   - the ordered run timeline;
   - before, disruption, and settled-state screenshots.
7. Return to the dashboard.
8. Select **Fixed**.
9. Run the identical Test again.
10. Confirm the result passes with one created order.

Recent runs are persisted and can be reopened after refreshing the dashboard or restarting the server.

## How it works

The sample Test follows this sequence:

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

The bundled checkout is the guaranteed deterministic path. The reusable external workflow is designed for authorized local, staging, and controlled pre-production targets.

The reusable external workflow is available at:

http://localhost:3000/projects

It supports:

1. creating a project for a controlled HTTP or HTTPS target;
2. recording a same-tab journey in visible Chromium;
3. reviewing and saving an immutable Journey version;
4. approving a recorded click or form submission as the Critical Action;
5. replaying the Journey once to approve browser-visible Outcome Checks, with exact synthetic identities displayed during selection;
6. explicitly approving sanitized request evidence captured during recording, or bounded evidence from an existing prior Run, without another discovery replay;
7. atomically saving Double-click, Triple-click, and Delayed repeat as three sibling Tests;
8. returning to the Saved Journey, where each Test can be run and its latest Run details opened directly;
9. reviewing immutable Test versions, canonical verdicts, events, evidence, warnings, and screenshots.

There is one supported Test editor. Optional Technical checks add bounded browser assertions for visibility, hidden or disabled state, text, retained fields, and final URLs. They supplement approved Outcome Checks rather than replacing them.

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

Values may also be supplied ephemerally for a replay or Test run.

Secret values and values derived from them are resolved in memory and excluded from persisted snapshots, API responses, events, errors, and screenshot metadata. Sensitive browser fields are added to the screenshot mask list when their target locator remains available.

## Safety boundaries

FormCrash is intended for local, staging, and controlled pre-production environments.

Production targets require explicit confirmation before replay, Outcome capture, or repeated-action execution. Prefer staging for demonstrations.

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

## Contributing

Contributions are welcome. Keep changes focused, preserve existing behavior outside the proposed scope, and represent incomplete or unsafe states honestly.

### Before writing code

1. Fork and clone the repository, then create a focused branch such as `feature/run-filtering` or `fix/outcome-selection`.
2. Install the workspace and Chromium using the [Quick start](#quick-start) instructions.
3. Read `docs/product/ui-direction.md` and `docs/product/active-bugs.md` before changing the dashboard. Read the relevant product and architecture documents for the area being changed.
4. For a large feature, schema change, or new runner capability, open an issue first so the behavior and safety boundary can be agreed before implementation.

### Engineering expectations

- Preserve the persistent Project → Journey → Test → Run information architecture. Do not turn the application into a global wizard.
- Keep real backend behavior connected. Do not hide active defects with placeholders, removed error states, relabeling, or weakened tests.
- Treat browser execution and target data as potentially destructive. Use local or staging fixtures and never commit runtime data, credentials, authentication state, databases, or screenshots from real targets.
- Update shared contracts before their server and dashboard consumers when a public shape changes.
- Add focused regression coverage for every behavioral change. Browser-sensitive work should include visible-browser verification when the environment supports it.
- Avoid unrelated cleanup or mass formatting in the same pull request.

### Validate the change

Run the tests closest to the changed package while developing:

```bash
pnpm --filter @formcrash/contracts test
pnpm --filter @formcrash/dashboard test
pnpm --filter @formcrash/server test
```

Before opening a pull request, run `pnpm verify`. If a repository-wide check exposes an unrelated pre-existing failure, do not rewrite unrelated files; run focused checks for the touched files and document the exact baseline failure in the pull request.

A pull request should include:

- the user problem and resulting behavior;
- the intentionally changed files and any migration or compatibility impact;
- tests and manual verification performed;
- screenshots for meaningful dashboard changes;
- remaining limitations, skipped verification, and data-safety considerations.

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
- deterministic duplicate-submit Test;
- visible Playwright execution;
- persisted runs, events, assertions, and screenshots;
- replayable SSE progress;
- external project creation;
- immutable Journey recording and replay;
- authentication capture;
- runtime variables and secret redaction;
- Critical Action and Outcome Check approval;
- generated safe identities with exact active-capture guidance and template-only persistence;
- recording-time and prior-Run request evidence with deterministic ranking and explicit approval;
- one Test editor that atomically creates three reusable sibling Tests;
- stable Test identities with immutable version and Run history;
- Saved Journey Test actions for Run, latest Run details, record details, and editing;
- canonical verdicts that distinguish failed, passed, could-not-verify, and runner-error outcomes;
- network, UI, field-retention, and URL assertions;
- persisted external-run evidence.

Not currently implemented:

- complete generic before-and-after proof across arbitrary external targets;
- PDF or HTML exports;
- CI orchestration;
- cloud execution;
- additional failure injectors;
- generic business-record count inference;
- runtime OpenAI or other LLM features.

FormCrash was built with Codex, but it has no runtime AI dependency.

## Documentation

- Product requirements: `docs/product/prd.md`
- Product UI direction: `docs/product/ui-direction.md`
- Active bugs and verification gaps: `docs/product/active-bugs.md`
- Multi-Test acceptance record: `docs/product/multi-test-acceptance.md`
- Architecture and data flow: `docs/architecture/data-flow.md`
- High-fidelity replay contract: `docs/architecture/high-fidelity-replay.md`
- Request recommendation model: `docs/architecture/request-recommendation.md`
- Assertion recommendation model: `docs/architecture/assertion-recommendation.md`

## License

FormCrash is licensed under the MIT License. See `/LICENSE`.
