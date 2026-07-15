# ADR 0006: Immutable run snapshots and append-only events

**Status:** Accepted

## Context

Failed-versus-fixed proof is trustworthy only when historical runs retain the
exact journey, failure settings, assertions, and evidence that produced them.

## Decision

Create an immutable configuration snapshot when a run is requested. Persist run
events as append-only, server-sequenced records. Never reconstruct old run
configuration from mutable current entities.

## Consequences

Runs remain explainable after experiments are edited and comparisons can expose
real configuration differences. Snapshots duplicate some data and require schema
versioning and migration/read-compatibility policies.

## Alternatives rejected

- Referencing only current experiment rows: rewrites historical meaning after an
  edit.
- Updating event rows: weakens chronology and auditability.
- Storing only a final result: discards the evidence-first product value.
