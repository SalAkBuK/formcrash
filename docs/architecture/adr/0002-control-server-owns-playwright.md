# ADR 0002: Separate long-running control server for Playwright

**Status:** Accepted

## Context

Browser runs outlive individual dashboard requests and require cancellation,
ordered progress, cleanup, persistence, and exclusive resource ownership.

## Decision

Use a long-running Fastify control server as the sole future owner of Playwright
and visible Chromium. The dashboard issues commands over HTTP and never launches
a browser.

## Consequences

Runs survive dashboard navigation, shutdown can close Chromium coherently, and
browser concerns stay outside UI rendering. The local system has an additional
process and must expose clear health and lifecycle behavior.

## Alternatives rejected

- Launching Playwright from Next.js route handlers: couples browser lifetime to
  request and framework execution semantics.
- Launching Playwright in the dashboard/browser: impossible without unsafe local
  privileges and violates the ownership boundary.
- A separate runner microservice: creates distributed coordination with no MVP
  benefit.
