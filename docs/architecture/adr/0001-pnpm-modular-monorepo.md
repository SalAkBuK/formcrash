# ADR 0001: pnpm modular monorepo

**Status:** Accepted

## Context

The dashboard, control server, bundled checkout, contracts, and test support need
separate ownership but one local installation and verification workflow.

## Decision

Use a pnpm workspace with three application packages and narrowly scoped shared
packages. Applications never import from other applications. Shared imports go
through declared package dependencies.

## Consequences

One lockfile and root command set keep setup small. Package manifests expose
dependency direction for review. Workspace configuration adds modest tooling but
does not introduce a build orchestrator.

## Alternatives rejected

- One undivided package: obscures process and ownership boundaries.
- Multiple repositories: adds coordination overhead before there are independent
  release lifecycles.
- Turborepo or Nx: no current caching or task-graph problem justifies them.
