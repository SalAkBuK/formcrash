# Conceptual data model

This document describes the server-owned metadata model. Chunk 3 implements the
Priority 0 subset in SQLite through ordered SQL migrations. Identifiers are opaque
strings, timestamps are UTC, JSON is validated at repository boundaries, and
binary screenshots stay on disk.

```mermaid
erDiagram
  PROJECT ||--o{ JOURNEY : owns
  PROJECT ||--o{ EXPERIMENT : owns
  JOURNEY ||--|{ JOURNEY_STEP : contains
  JOURNEY ||--o{ EXPERIMENT_VERSION : used_by
  EXPERIMENT ||--|{ EXPERIMENT_VERSION : versions
  EXPERIMENT_VERSION ||--|{ RECOVERY_ASSERTION : defines
  EXPERIMENT_VERSION ||--o{ RUN : snapshots_to
  RUN ||--o{ RUN_EVENT : appends
  RUN ||--o{ ASSERTION_RESULT : produces
  RUN ||--o{ ARTIFACT : references
  RECOVERY_ASSERTION ||--o{ ASSERTION_RESULT : evaluated_as
  RUN_EVENT ||--o{ ARTIFACT : may_reference
```

## Critical Priority 0 fields

### Project

- `id`, `name`, `targetBaseUrl`, `description`, `createdAt`, `updatedAt`.
- Bundled-sample identity must be explicit rather than inferred from its name.
- External project execution settings persist variable declarations and bounded
  hook configuration, never runtime secret values.
- Authentication metadata stores only a relative storage-state path and capture
  timestamps. Cookie and local-storage contents remain in the server-owned file.

### Journey

- `id`, `projectId`, `name`, `version`, `definitionJson`, and `createdAt`.
- Priority 0 uses a seeded saved journey; recording is post-Priority-0.

Journey steps remain inside the immutable structured `definitionJson` for this
single seeded journey. A normalized journey-step table is deferred until editing
or recording creates a real query requirement.

### Experiment

- `id`, `projectId`, `journeyId`, `name`, `experimentType`, and `createdAt`.
- Stable identity groups replays and comparisons across immutable versions.

### ExperimentVersion

- `id`, `experimentId`, `version`, configuration JSON, journey snapshot JSON,
  assertion snapshot JSON, and `createdAt`.
- Selected journey-step identity and deterministic Impatient User configuration.
- Complete serialized journey, injector, assertion, and target configuration.
- `schemaVersion`, `createdAt`, and a content hash for diagnostic integrity.

### RecoveryAssertion

- `id`, `experimentVersionId`, `type`, readable `description`.
- Type-specific expected value, target/request/record reference, and position.
- Priority 0 requires “no more than one resulting order” or its exact equivalent.

### Run

- `id`, `experimentVersionId`, `status`, `mode`, and `targetUrl`.
- Immutable journey, experiment, and assertion snapshot JSON columns.
- `createdAt`, `startedAt`, `completedAt`, `durationMs`, and error summary fields.
- The snapshot is copied at run creation; historical runs never resolve through
  mutable current experiment data.

### RunEvent

- `id`, `runId`, monotonically increasing `sequence`, `eventType`.
- `relativeTimestampMs`, `recordedAt`, `schemaVersion`, and JSON payload.
- Rows are append-only. Corrections are new events, not updates to prior events.

### AssertionResult

- `id`, `runId`, assertion snapshot/reference, `status`.
- Expected and observed values, plain-language summary, and evaluated timestamp.
- `not_evaluated` and `error` stay distinct from assertion `failed`.

### Artifact

- `id`, `runId`, `artifactType`, `label`, media type, capture sequence, metadata,
  relative filesystem path, byte size, SHA-256 checksum, and created timestamp.
  Screenshot bytes remain under `var/screenshots`, never as SQLite blobs.

## External experiment tables

Chunk 6 adds parallel `external_experiments`, immutable
`external_experiment_versions`, `external_runs`, append-only
`external_run_events`, `external_assertion_results`, and `external_artifacts`.
The original Priority 0 sample tables retain their locked mode and assertion
constraints; forcing generic external data into them would break the seeded
sample contract. Both paths share ownership, locator, event-envelope, assertion
status, and artifact conventions.

An external run snapshots its project/journey/experiment names and definitions,
safe resolved values, trigger count, sanitized browser request observations,
runner error, warnings, assertions, and relative artifact metadata. It never
persists ephemeral secret values or raw HTTP hook headers/bodies.

## Implemented database enforcement

- Foreign keys are enabled on every connection.
- Experiment version numbers are unique within an experiment and version rows are
  immutable through triggers.
- Run snapshot columns cannot be updated after insertion.
- Run event IDs and `(run_id, sequence_number)` are unique; insertion must be the
  next sequence and update/delete triggers preserve append-only history.
- Run modes, run statuses, assertion statuses, artifact labels, and current
  Priority 0 types use practical `CHECK` constraints.
- Artifact paths are validated relative POSIX paths; byte sizes and SHA-256
  checksums support integrity checks while SQLite stores metadata only.

## Integrity and privacy rules

- The control server is the only process allowed to read or mutate this database.
- Run configuration snapshots and experiment versions are immutable after use.
- Events are append-only and ordered by server-assigned sequence, not client time.
- Artifact paths are relative, server-validated paths under `var/`.
- Passwords and manually sensitive inputs are stored as masked markers or named
  references to fake test inputs. Raw sensitive values do not enter events,
  snapshots, logs, screenshots where practical, or exports.
