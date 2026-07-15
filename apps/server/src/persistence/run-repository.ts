import { randomUUID } from 'node:crypto';

import {
  assertionSnapshotSchema,
  createdOrdersAssertionResultSchema,
  evidenceWarningSchema,
  impatientUserExperimentSchema,
  persistedAssertionResultSchema,
  persistedRunDetailSchema,
  persistedRunListSchema,
  runArtifactSchema,
  runEventEnvelopeSchema,
  runStatusSchema,
  sampleJourneyStepsSchema,
  sampleObservedStateSchema,
  sampleRunnerErrorSchema,
  type AssertionSnapshot,
  type CreatedOrdersAssertionResult,
  type EvidenceWarning,
  type ImpatientUserExperiment,
  type PersistedRunDetail,
  type PersistedRunList,
  type RunArtifact,
  type RunEventEnvelope,
  type RunStatus,
  type SampleJourneyStep,
  type SampleObservedState,
  type SampleRunnerError,
  type SampleRunMode,
} from '@formcrash/contracts';
import type Database from 'better-sqlite3';

import { summarizeStep } from '../runner/journeys/types.js';
import { createNotEvaluatedAssertion } from '../runner/assertions/max-created-orders.js';
import { SAMPLE_DEFINITION_IDS } from './sample-seed.js';

export class RunPersistenceError extends Error {
  constructor(operation: string, cause: unknown) {
    super(`SQLite could not ${operation}.`, { cause });
    this.name = 'RunPersistenceError';
  }
}

export interface SeededExperimentDefinition {
  readonly experimentVersionId: string;
  readonly journey: readonly SampleJourneyStep[];
  readonly experiment: ImpatientUserExperiment;
  readonly assertions: readonly AssertionSnapshot[];
  readonly assertionId: string;
}

export interface CreateRunInput {
  readonly runId: string;
  readonly experimentVersionId: string;
  readonly mode: SampleRunMode;
  readonly startedAt: string;
  readonly targetUrl: string;
  readonly journey: readonly SampleJourneyStep[];
  readonly experiment: ImpatientUserExperiment;
  readonly assertions: readonly AssertionSnapshot[];
}

export interface FinalizeRunInput {
  readonly runId: string;
  readonly status: Extract<RunStatus, 'passed' | 'failed' | 'runner_error'>;
  readonly completedAt: string;
  readonly durationMs: number;
  readonly observed: SampleObservedState | null;
  readonly runnerError: SampleRunnerError | null;
  readonly evidenceWarnings: readonly EvidenceWarning[];
  readonly assertionId: string;
  readonly assertion: CreatedOrdersAssertionResult;
}

export interface CreateArtifactInput {
  readonly runId: string;
  readonly label: RunArtifact['label'];
  readonly relativePath: string;
  readonly sizeBytes: number;
  readonly checksumSha256: string;
  readonly captureSequence: number;
  readonly createdAt: string;
  readonly metadata: RunArtifact['metadata'];
}

interface SeedRow {
  readonly id: string;
  readonly configurationJson: string;
  readonly journeySnapshotJson: string;
  readonly assertionsSnapshotJson: string;
  readonly assertionId: string;
}

interface RunRow {
  readonly id: string;
  readonly experimentVersionId: string;
  readonly mode: string;
  readonly status: string;
  readonly startedAt: string;
  readonly completedAt: string | null;
  readonly durationMs: number | null;
  readonly targetUrl: string;
  readonly journeySnapshotJson: string;
  readonly experimentSnapshotJson: string;
  readonly assertionsSnapshotJson: string;
  readonly observedJson: string | null;
  readonly runnerErrorJson: string | null;
  readonly evidenceWarningsJson: string;
  readonly createdAt: string;
}

interface EventRow {
  readonly id: string;
  readonly runId: string;
  readonly sequenceNumber: number;
  readonly eventType: string;
  readonly relativeTimestampMs: number;
  readonly recordedAt: string;
  readonly schemaVersion: number;
  readonly payloadJson: string;
}

interface AssertionResultRow {
  readonly id: string;
  readonly runId: string;
  readonly assertionId: string;
  readonly assertionType: string;
  readonly status: string;
  readonly expectedJson: string;
  readonly observedJson: string;
  readonly expectedDescription: string;
  readonly observedDescription: string;
  readonly evaluatedAt: string;
}

interface ArtifactRow {
  readonly id: string;
  readonly runId: string;
  readonly artifactType: string;
  readonly label: string;
  readonly relativePath: string;
  readonly mimeType: string;
  readonly sizeBytes: number;
  readonly checksumSha256: string;
  readonly captureSequence: number;
  readonly createdAt: string;
  readonly metadataJson: string;
}

export class RunRepository {
  constructor(private readonly database: Database.Database) {}

  loadSeededExperiment(): SeededExperimentDefinition {
    return this.protect('load the seeded experiment version', () => {
      const row = this.database
        .prepare(
          `SELECT ev.id,
                  ev.configuration_json AS configurationJson,
                  ev.journey_snapshot_json AS journeySnapshotJson,
                  ev.assertions_snapshot_json AS assertionsSnapshotJson,
                  ra.id AS assertionId
             FROM experiment_versions ev
             JOIN recovery_assertions ra ON ra.experiment_version_id = ev.id
            WHERE ev.id = ?`,
        )
        .get(SAMPLE_DEFINITION_IDS.experimentVersionId) as SeedRow | undefined;
      if (row === undefined) {
        throw new Error('The seeded Priority 0 experiment version is missing.');
      }
      return {
        experimentVersionId: row.id,
        journey: sampleJourneyStepsSchema.parse(
          JSON.parse(row.journeySnapshotJson),
        ),
        experiment: impatientUserExperimentSchema.parse(
          JSON.parse(row.configurationJson),
        ),
        assertions: assertionSnapshotSchema
          .array()
          .min(1)
          .parse(JSON.parse(row.assertionsSnapshotJson)),
        assertionId: row.assertionId,
      };
    });
  }

  createRun(input: CreateRunInput): void {
    this.protect('create the run', () => {
      this.database
        .prepare(
          `INSERT INTO runs
            (id, experiment_version_id, mode, status, started_at, completed_at,
             duration_ms, target_url, journey_snapshot_json,
             experiment_snapshot_json, assertions_snapshot_json, observed_json,
             runner_error_json, evidence_warnings_json, created_at)
           VALUES (?, ?, ?, 'created', ?, NULL, NULL, ?, ?, ?, ?, NULL, NULL, '[]', ?)`,
        )
        .run(
          input.runId,
          input.experimentVersionId,
          input.mode,
          input.startedAt,
          input.targetUrl,
          JSON.stringify(input.journey),
          JSON.stringify(input.experiment),
          JSON.stringify(input.assertions),
          input.startedAt,
        );
    });
  }

  updateRunStatus(runId: string, status: RunStatus): void {
    this.protect(`persist run status ${status}`, () => {
      const result = this.database
        .prepare('UPDATE runs SET status = ? WHERE id = ?')
        .run(runStatusSchema.parse(status), runId);
      if (result.changes !== 1) throw new Error('Run does not exist.');
    });
  }

  appendEvent(eventInput: RunEventEnvelope): void {
    this.protect('append the run event', () => {
      const event = runEventEnvelopeSchema.parse(eventInput);
      this.database
        .prepare(
          `INSERT INTO run_events
            (id, run_id, sequence_number, event_type, relative_timestamp_ms,
             recorded_at, schema_version, payload_json)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(
          event.eventId,
          event.runId,
          event.sequence,
          event.eventType,
          event.relativeTimestampMs,
          event.recordedAt,
          event.schemaVersion,
          JSON.stringify(event.payload),
        );
    });
  }

  createArtifact(input: CreateArtifactInput): RunArtifact {
    return this.protect('persist artifact metadata', () => {
      const artifact = runArtifactSchema.parse({
        artifactId: randomUUID(),
        runId: input.runId,
        artifactType: 'screenshot',
        label: input.label,
        relativePath: input.relativePath,
        mimeType: 'image/png',
        sizeBytes: input.sizeBytes,
        checksumSha256: input.checksumSha256,
        captureSequence: input.captureSequence,
        createdAt: input.createdAt,
        metadata: input.metadata,
      });
      this.database
        .prepare(
          `INSERT INTO artifacts
            (id, run_id, artifact_type, label, relative_path, mime_type,
             size_bytes, checksum_sha256, capture_sequence, created_at, metadata_json)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(
          artifact.artifactId,
          artifact.runId,
          artifact.artifactType,
          artifact.label,
          artifact.relativePath,
          artifact.mimeType,
          artifact.sizeBytes,
          artifact.checksumSha256,
          artifact.captureSequence,
          artifact.createdAt,
          JSON.stringify(artifact.metadata),
        );
      return artifact;
    });
  }

  finalizeRun(input: FinalizeRunInput): void {
    this.protect('finalize the run', () => {
      const assertion = createdOrdersAssertionResultSchema.parse(
        input.assertion,
      );
      this.database.transaction(() => {
        const update = this.database
          .prepare(
            `UPDATE runs
                SET status = ?, completed_at = ?, duration_ms = ?, observed_json = ?,
                    runner_error_json = ?, evidence_warnings_json = ?
              WHERE id = ?`,
          )
          .run(
            input.status,
            input.completedAt,
            input.durationMs,
            input.observed === null ? null : JSON.stringify(input.observed),
            input.runnerError === null
              ? null
              : JSON.stringify(input.runnerError),
            JSON.stringify(input.evidenceWarnings),
            input.runId,
          );
        if (update.changes !== 1) throw new Error('Run does not exist.');

        this.database
          .prepare(
            `INSERT INTO assertion_results
              (id, run_id, assertion_id, assertion_type, status, expected_json,
               observed_json, expected_description, observed_description, evaluated_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          )
          .run(
            randomUUID(),
            input.runId,
            input.assertionId,
            assertion.assertionType,
            assertion.status,
            JSON.stringify({ expectedMaximum: assertion.expectedMaximum }),
            JSON.stringify({ observedCount: assertion.observedCount }),
            assertion.expectedDescription,
            assertion.observedDescription,
            input.completedAt,
          );
      })();
    });
  }

  getRun(runId: string): PersistedRunDetail | null {
    return this.protect('read the run', () => {
      const row = this.database
        .prepare(
          `SELECT id, experiment_version_id AS experimentVersionId, mode, status,
                  started_at AS startedAt, completed_at AS completedAt,
                  duration_ms AS durationMs, target_url AS targetUrl,
                  journey_snapshot_json AS journeySnapshotJson,
                  experiment_snapshot_json AS experimentSnapshotJson,
                  assertions_snapshot_json AS assertionsSnapshotJson,
                  observed_json AS observedJson, runner_error_json AS runnerErrorJson,
                  evidence_warnings_json AS evidenceWarningsJson,
                  created_at AS createdAt
             FROM runs WHERE id = ?`,
        )
        .get(runId) as RunRow | undefined;
      return row === undefined ? null : this.mapRun(row);
    });
  }

  getLatestRun(): PersistedRunDetail | null {
    return this.protect('read the latest run', () => {
      const row = this.database
        .prepare(
          `SELECT id, experiment_version_id AS experimentVersionId, mode, status,
                  started_at AS startedAt, completed_at AS completedAt,
                  duration_ms AS durationMs, target_url AS targetUrl,
                  journey_snapshot_json AS journeySnapshotJson,
                  experiment_snapshot_json AS experimentSnapshotJson,
                  assertions_snapshot_json AS assertionsSnapshotJson,
                  observed_json AS observedJson, runner_error_json AS runnerErrorJson,
                  evidence_warnings_json AS evidenceWarningsJson,
                  created_at AS createdAt
             FROM runs ORDER BY created_at DESC, id DESC LIMIT 1`,
        )
        .get() as RunRow | undefined;
      return row === undefined ? null : this.mapRun(row);
    });
  }

  listRuns(limit: number, offset: number): PersistedRunList {
    return this.protect('list runs', () => {
      const items = this.database
        .prepare(
          `SELECT r.id AS runId, r.mode, r.status, r.started_at AS startedAt,
                  r.completed_at AS completedAt, r.duration_ms AS durationMs,
                  CAST(json_extract(r.observed_json, '$.createdOrderCount') AS INTEGER)
                    AS createdOrderCount,
                  (SELECT ar.status FROM assertion_results ar WHERE ar.run_id = r.id LIMIT 1)
                    AS assertionStatus,
                  (SELECT COUNT(*) FROM artifacts a WHERE a.run_id = r.id
                    AND a.artifact_type = 'screenshot') AS screenshotCount
             FROM runs r
            ORDER BY r.created_at DESC, r.id DESC
            LIMIT ? OFFSET ?`,
        )
        .all(limit, offset);
      return persistedRunListSchema.parse({ items, limit, offset });
    });
  }

  getArtifact(runId: string, artifactId: string): RunArtifact | null {
    return this.protect('read artifact metadata', () => {
      const row = this.database
        .prepare(
          `SELECT id, run_id AS runId, artifact_type AS artifactType, label,
                  relative_path AS relativePath, mime_type AS mimeType,
                  size_bytes AS sizeBytes, checksum_sha256 AS checksumSha256,
                  capture_sequence AS captureSequence,
                  created_at AS createdAt, metadata_json AS metadataJson
             FROM artifacts WHERE id = ? AND run_id = ?`,
        )
        .get(artifactId, runId) as ArtifactRow | undefined;
      return row === undefined ? null : mapArtifact(row);
    });
  }

  private mapRun(row: RunRow): PersistedRunDetail {
    const journey = sampleJourneyStepsSchema.parse(
      JSON.parse(row.journeySnapshotJson),
    );
    const experiment = impatientUserExperimentSchema.parse(
      JSON.parse(row.experimentSnapshotJson),
    );
    const assertionSnapshots = assertionSnapshotSchema
      .array()
      .min(1)
      .parse(JSON.parse(row.assertionsSnapshotJson));
    const events = (
      this.database
        .prepare(
          `SELECT id, run_id AS runId, sequence_number AS sequenceNumber,
                  event_type AS eventType,
                  relative_timestamp_ms AS relativeTimestampMs,
                  recorded_at AS recordedAt, schema_version AS schemaVersion,
                  payload_json AS payloadJson
             FROM run_events WHERE run_id = ? ORDER BY sequence_number`,
        )
        .all(row.id) as EventRow[]
    ).map(mapEvent);
    const assertionResults = (
      this.database
        .prepare(
          `SELECT id, run_id AS runId, assertion_id AS assertionId,
                  assertion_type AS assertionType, status,
                  expected_json AS expectedJson, observed_json AS observedJson,
                  expected_description AS expectedDescription,
                  observed_description AS observedDescription,
                  evaluated_at AS evaluatedAt
             FROM assertion_results WHERE run_id = ? ORDER BY evaluated_at, id`,
        )
        .all(row.id) as AssertionResultRow[]
    ).map(mapAssertionResult);
    const artifacts = (
      this.database
        .prepare(
          `SELECT id, run_id AS runId, artifact_type AS artifactType, label,
                  relative_path AS relativePath, mime_type AS mimeType,
                  size_bytes AS sizeBytes, checksum_sha256 AS checksumSha256,
                  capture_sequence AS captureSequence,
                  created_at AS createdAt, metadata_json AS metadataJson
             FROM artifacts WHERE run_id = ? ORDER BY capture_sequence`,
        )
        .all(row.id) as ArtifactRow[]
    ).map(mapArtifact);
    const assertion = assertionResults[0];
    const publicAssertion =
      assertion === undefined
        ? createNotEvaluatedAssertion()
        : createdOrdersAssertionResultSchema.parse({
            assertionType: assertion.assertionType,
            expectedMaximum: readNumberProperty(
              assertion.expected,
              'expectedMaximum',
            ),
            observedCount: readNullableNumberProperty(
              assertion.observed,
              'observedCount',
            ),
            status: assertion.status,
            expectedDescription: assertion.expectedDescription,
            observedDescription: assertion.observedDescription,
          });

    return persistedRunDetailSchema.parse({
      runId: row.id,
      experimentVersionId: row.experimentVersionId,
      status: row.status,
      mode: row.mode,
      startedAt: row.startedAt,
      completedAt: row.completedAt,
      durationMs: row.durationMs,
      targetUrl: row.targetUrl,
      createdAt: row.createdAt,
      journey: {
        id: 'sample-checkout-priority-0',
        name: 'Sample checkout order submission',
        steps: journey.map(summarizeStep),
      },
      experiment,
      assertions: [publicAssertion],
      snapshots: { journey, experiment, assertions: assertionSnapshots },
      events,
      observed:
        row.observedJson === null
          ? null
          : sampleObservedStateSchema.parse(JSON.parse(row.observedJson)),
      runnerError:
        row.runnerErrorJson === null
          ? null
          : sampleRunnerErrorSchema.parse(JSON.parse(row.runnerErrorJson)),
      evidenceWarnings: evidenceWarningSchema
        .array()
        .parse(JSON.parse(row.evidenceWarningsJson)),
      assertionResults,
      artifacts,
    });
  }

  private protect<T>(operation: string, action: () => T): T {
    try {
      return action();
    } catch (error: unknown) {
      if (error instanceof RunPersistenceError) throw error;
      throw new RunPersistenceError(operation, error);
    }
  }
}

function mapEvent(row: EventRow): RunEventEnvelope {
  return runEventEnvelopeSchema.parse({
    eventId: row.id,
    runId: row.runId,
    eventType: row.eventType,
    sequence: row.sequenceNumber,
    relativeTimestampMs: row.relativeTimestampMs,
    recordedAt: row.recordedAt,
    schemaVersion: row.schemaVersion,
    payload: parseJson(row.payloadJson),
  });
}

function mapAssertionResult(row: AssertionResultRow) {
  return persistedAssertionResultSchema.parse({
    assertionResultId: row.id,
    runId: row.runId,
    assertionId: row.assertionId,
    assertionType: row.assertionType,
    status: row.status,
    expected: parseJson(row.expectedJson),
    observed: parseJson(row.observedJson),
    expectedDescription: row.expectedDescription,
    observedDescription: row.observedDescription,
    evaluatedAt: row.evaluatedAt,
  });
}

function mapArtifact(row: ArtifactRow): RunArtifact {
  return runArtifactSchema.parse({
    artifactId: row.id,
    runId: row.runId,
    artifactType: row.artifactType,
    label: row.label,
    relativePath: row.relativePath,
    mimeType: row.mimeType,
    sizeBytes: row.sizeBytes,
    checksumSha256: row.checksumSha256,
    captureSequence: row.captureSequence,
    createdAt: row.createdAt,
    metadata: parseJson(row.metadataJson),
  });
}

function readNumberProperty(value: unknown, key: string): number {
  if (
    typeof value !== 'object' ||
    value === null ||
    !(key in value) ||
    typeof value[key as keyof typeof value] !== 'number'
  ) {
    throw new Error(`Persisted JSON property ${key} is not a number.`);
  }
  return value[key as keyof typeof value];
}

function readNullableNumberProperty(
  value: unknown,
  key: string,
): number | null {
  if (typeof value !== 'object' || value === null || !(key in value)) {
    throw new Error(`Persisted JSON property ${key} is missing.`);
  }
  const property = value[key as keyof typeof value];
  if (property !== null && typeof property !== 'number') {
    throw new Error(`Persisted JSON property ${key} is not nullable numeric.`);
  }
  return property;
}

function parseJson(value: string): unknown {
  return JSON.parse(value) as unknown;
}
