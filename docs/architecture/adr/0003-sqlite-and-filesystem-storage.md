# ADR 0003: SQLite metadata plus filesystem artifacts

**Status:** Accepted

## Context

The local workbench needs durable relational metadata and potentially large
screenshots and exports without external infrastructure.

## Decision

Store future metadata in a server-owned SQLite database. Store binary artifacts
under `var/` and reference them from metadata with validated relative paths,
checksums, and media information.

## Consequences

Installation remains local and backup is straightforward. Database transactions
can protect metadata, but database and filesystem writes cannot be one atomic
operation; artifact capture must use staged writes and explicit missing/failed
states in a later chunk.

## Alternatives rejected

- Database blobs: enlarge backups and make screenshot access and cleanup awkward.
- In-memory-only state: cannot satisfy restart persistence or trustworthy replay.
- PostgreSQL or cloud object storage: adds services that Priority 0 does not need.
