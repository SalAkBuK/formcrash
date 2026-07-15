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
- `apps/server` — Fastify modular monolith that will own commands, live events,
  Playwright, persistence, assertions, and evidence. Chunk 0 exposes only health.
- `apps/sample-checkout` — independent Next.js target application for the bundled
  vulnerable-versus-fixed demonstration.
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

Playwright and Chromium are intentionally not dependencies yet. A later runner
chunk will document and run the browser installation command when browser
execution has a concrete implementation.

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

## Verification

```sh
pnpm format:check
pnpm lint
pnpm typecheck
pnpm test
pnpm build
pnpm verify
```

`pnpm verify` runs all non-destructive checks and production builds. Tests in this
bootstrap cover shared contract validation and the server health endpoint; they
do not pretend that deferred product behavior exists.

## Runtime storage

Local generated state belongs under `var/`:

- `var/database` for the future SQLite database.
- `var/runs` for structured run evidence.
- `var/screenshots` for binary screenshots.
- `var/exports` for generated reports and test starting points.

Generated contents are ignored by Git. The control server will be the only owner
of the FormCrash database and artifact layout.

## Current implementation status

Chunk 0, architecture bootstrap, contains application shells, foundational
contracts, server lifecycle and health handling, runner interfaces, state
definitions, documentation, and verification tooling. It does **not** implement
checkout behavior, journey recording or replay, failure injection, assertions,
persistence, screenshots, reports, exports, or comparisons.

Priority 0 must be built in this order:

1. Bundled vulnerable and fixed sample checkout.
2. Hardcoded checkout journey and Impatient User browser runner.
3. Duplicate assertion, persistence, and evidence.
4. Dashboard run control and live progress.
5. Failed-versus-fixed comparison.
6. Report export and demonstration hardening.

See [`docs/implementation/roadmap.md`](docs/implementation/roadmap.md) for chunk
boundaries and objective exit criteria.
