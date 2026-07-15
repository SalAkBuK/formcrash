# FormCrash Lab

FormCrash Lab is a local pre-production resilience-testing workbench for
transactional web journeys. It is designed to replay a controlled journey,
introduce one deliberate failure, evaluate explicit recovery expectations, and
compare behavior before and after an application fix.

The locked product requirements are in [`docs/product/prd.md`](docs/product/prd.md).
Priority 0 is the duplicate checkout-submission demonstration described there.

## Repository boundaries

- `apps/dashboard` — Next.js interface for future project, experiment, run, and
  result workflows. It communicates with the control server over HTTP and never
  launches browsers or reads the FormCrash database.
- `apps/server` — Fastify modular monolith that owns health, the hardcoded
  sample-run API, Playwright execution, assertions, and in-memory evidence.
  Persistence and live event delivery remain deferred.
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

Runner configuration:

| Variable                       | Default                 | Purpose                                                    |
| ------------------------------ | ----------------------- | ---------------------------------------------------------- |
| `FORMCRASH_BROWSER_HEADLESS`   | `false`                 | Use visible Chromium by default; set `true` in automation. |
| `FORMCRASH_BROWSER_TIMEOUT_MS` | `10000`                 | Bounded target, action, and evidence timeout.              |
| `SAMPLE_CHECKOUT_BASE_URL`     | `http://localhost:4200` | Already-running bundled checkout target.                   |

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

## Hardcoded Priority 0 browser run

With the control server and sample checkout already running, invoke the one
predefined experiment from PowerShell:

```powershell
$vulnerable = Invoke-RestMethod -Method Post `
  -Uri http://localhost:4100/api/sample-runs `
  -ContentType 'application/json' `
  -Body '{"mode":"vulnerable"}'
$vulnerable | ConvertTo-Json -Depth 12

$fixed = Invoke-RestMethod -Method Post `
  -Uri http://localhost:4100/api/sample-runs `
  -ContentType 'application/json' `
  -Body '{"mode":"fixed"}'
$fixed | ConvertTo-Json -Depth 12
```

The endpoint awaits completion. Vulnerable mode returns HTTP 200 with run status
`failed` and two orders; fixed mode returns HTTP 200 with status `passed` and one
order. Assertion failure is a test result, not an HTTP error. The latest result is
available only in memory at `GET /api/sample-runs/latest`.

The current runner allows one browser run at a time. A concurrent request receives
HTTP 409 and is not queued. The hardcoded experiment triggers Submit Order twice,
100 ms apart, and checks exactly one assertion: no more than one order should be
created.

## Runtime storage

Local generated state belongs under `var/`:

- `var/database` for the future SQLite database.
- `var/runs` for structured run evidence.
- `var/screenshots` for binary screenshots.
- `var/exports` for generated reports and test starting points.

Generated contents are ignored by Git. The control server will be the only owner
of the FormCrash database and artifact layout.

## Current implementation status

Chunks 0 through 2 are implemented. The bundled checkout supports the complete
fake cart-to-confirmation journey, intentional vulnerable duplicate creation,
fixed client locking, fixed server idempotency, visible local evidence, and reset.
The control server now runs the one hardcoded checkout journey in Chromium,
injects the first Impatient User experiment, captures in-memory evidence, and
evaluates the duplicate-order assertion. It does **not** implement recording,
editable journeys or experiments, persistence, SSE, screenshots, dashboard run
workflows, reports, exports, or comparisons.

Priority 0 must be built in this order:

1. Bundled vulnerable and fixed sample checkout.
2. Hardcoded checkout journey and Impatient User browser runner.
3. Duplicate assertion, persistence, and evidence.
4. Dashboard run control and live progress.
5. Failed-versus-fixed comparison.
6. Report export and demonstration hardening.

See [`docs/implementation/roadmap.md`](docs/implementation/roadmap.md) for chunk
boundaries and objective exit criteria.
