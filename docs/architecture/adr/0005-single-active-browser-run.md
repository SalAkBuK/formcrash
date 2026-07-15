# ADR 0005: One active browser run at a time for the MVP

**Status:** Accepted

## Context

The submission depends on deterministic, visible Chromium execution on a local
developer machine. Concurrent runs would contend for focus, ports, sample state,
and evidence ordering.

## Decision

Allow one active browser run across the control server for the MVP. A second run
request must receive a clear conflict response rather than queueing invisibly.

## Consequences

Resource ownership and sample reset behavior stay predictable. Throughput is
limited, which is acceptable for a single-user local workbench. The constraint
must be visible in the API and dashboard rather than looking like a stalled run.

## Alternatives rejected

- Unbounded concurrency: makes the guaranteed demo unreliable.
- A persistent job queue: introduces scheduling and recovery machinery before it
  has a product need.
- Per-project concurrency: still permits contention in the shared browser and
  bundled checkout.
