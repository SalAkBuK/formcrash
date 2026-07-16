import { randomUUID } from 'node:crypto';

import {
  createExternalExperimentRequestSchema,
  externalAssertionResultSchema,
  externalExperimentListSchema,
  externalExperimentVersionSchema,
  externalNetworkObservationSchema,
  externalRunDetailSchema,
  externalRunListSchema,
  externalRunSummarySchema,
  externalRunnerErrorSchema,
  externalRunWarningSchema,
  persistedJourneySchema,
  runArtifactSchema,
  runEventEnvelopeSchema,
  type CreateExternalExperimentRequest,
  type ExternalAssertionResult,
  type ExternalExperimentVersion,
  type ExternalNetworkObservation,
  type ExternalRunDetail,
  type ExternalRunList,
  type ExternalRunListQuery,
  type ExternalRunSummary,
  type ExternalRunnerError,
  type ExternalRunWarning,
  type PersistedJourney,
  type RunArtifact,
  type RunEventEnvelope,
} from '@formcrash/contracts';
import type Database from 'better-sqlite3';

import type { CreateArtifactInput } from './run-repository.js';
import { RunPersistenceError } from './run-repository.js';
import { createGuidedJourneySnapshot } from '../runner/external/guided-journey.js';

interface ExperimentRow {
  readonly id: string;
  readonly experimentId: string;
  readonly projectId: string;
  readonly journeyId: string;
  readonly name: string;
  readonly experimentType: string;
  readonly version: number;
  readonly configurationJson: string;
  readonly journeySnapshotJson: string;
  readonly assertionsSnapshotJson: string;
  readonly requestSelectionProvenanceJson: string | null;
  readonly assertionSelectionProvenanceJson: string | null;
  readonly createdAt: string;
}

interface RunRow {
  readonly id: string;
  readonly experimentVersionId: string;
  readonly projectId: string;
  readonly journeyId: string;
  readonly status: string;
  readonly startedAt: string;
  readonly completedAt: string | null;
  readonly durationMs: number | null;
  readonly targetUrl: string;
  readonly projectName: string;
  readonly journeyName: string;
  readonly experimentName: string;
  readonly experimentSnapshotJson: string;
  readonly resolvedValuesJson: string;
  readonly triggerAttempts: number;
  readonly networkObservationsJson: string;
  readonly runnerErrorJson: string | null;
  readonly warningsJson: string;
  readonly createdAt: string;
}

interface RunSummaryRow {
  readonly id: string;
  readonly experimentVersionId: string;
  readonly projectId: string;
  readonly journeyId: string;
  readonly status: string;
  readonly startedAt: string;
  readonly completedAt: string | null;
  readonly durationMs: number | null;
  readonly projectName: string;
  readonly journeyName: string;
  readonly experimentName: string;
  readonly triggerAttempts: number;
  readonly networkObservationsJson: string;
  readonly passedAssertionCount: number;
  readonly assertionCount: number;
  readonly screenshotCount: number;
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

interface AssertionRow {
  readonly id: string;
  readonly assertionId: string;
  readonly assertionType: string;
  readonly status: string;
  readonly description: string;
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

export class ExternalExperimentRepository {
  constructor(private readonly database: Database.Database) {}

  createVersion(input: {
    readonly projectId: string;
    readonly journey: PersistedJourney;
    readonly request: CreateExternalExperimentRequest;
  }): ExternalExperimentVersion {
    return this.protect('create an external experiment version', () => {
      const request = createExternalExperimentRequestSchema.parse(
        input.request,
      );
      const target = input.journey.steps.find(
        (step) => step.id === request.targetStepId,
      );
      if (target === undefined)
        throw new Error('Target journey step was not found.');
      if (target.type !== 'click' && target.type !== 'submit') {
        throw new Error(
          'Impatient User can target only click or submit steps.',
        );
      }
      const journeySnapshot = createGuidedJourneySnapshot(
        input.journey,
        request.stepValueOverrides ?? {},
        request.normalizeJourney ?? false,
      );
      const create = this.database.transaction(() => {
        const existing = this.database
          .prepare(
            `SELECT id FROM external_experiments
              WHERE project_id = ? AND journey_id = ? AND name = ?`,
          )
          .get(input.projectId, input.journey.id, request.name) as
          { id: string } | undefined;
        const experimentId = existing?.id ?? randomUUID();
        const now = new Date().toISOString();
        if (existing === undefined) {
          this.database
            .prepare(
              `INSERT INTO external_experiments
                (id, project_id, journey_id, name, experiment_type, created_at)
               VALUES (?, ?, ?, ?, 'impatient_user', ?)`,
            )
            .run(
              experimentId,
              input.projectId,
              input.journey.id,
              request.name,
              now,
            );
        }
        const versionRow = this.database
          .prepare(
            `SELECT COALESCE(MAX(version), 0) AS version
               FROM external_experiment_versions WHERE experiment_id = ?`,
          )
          .get(experimentId) as { version: number };
        const version = versionRow.version + 1;
        const id = randomUUID();
        const configuration = {
          targetStepId: request.targetStepId,
          triggerCount: request.triggerCount,
          intervalMs: request.intervalMs,
          networkMatcher: request.networkMatcher,
          continueAfterTarget: request.continueAfterTarget,
          guided: request.guided ?? false,
        };
        this.database
          .prepare(
            `INSERT INTO external_experiment_versions
              (id, experiment_id, version, configuration_json,
               journey_snapshot_json, assertions_snapshot_json,
               request_selection_provenance_json,
               assertion_selection_provenance_json, created_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          )
          .run(
            id,
            experimentId,
            version,
            JSON.stringify(configuration),
            JSON.stringify(journeySnapshot),
            JSON.stringify(request.assertions),
            request.requestSelectionProvenance === null
              ? null
              : JSON.stringify(request.requestSelectionProvenance),
            (request.assertionSelectionProvenance?.length ?? 0) === 0
              ? null
              : JSON.stringify(request.assertionSelectionProvenance),
            now,
          );
        const created = this.getVersion(id);
        if (created === null)
          throw new Error('Created experiment version is missing.');
        return created;
      });
      return create();
    });
  }

  getVersion(id: string): ExternalExperimentVersion | null {
    return this.protect('read an external experiment version', () => {
      const row = this.database
        .prepare(experimentSelect('WHERE ev.id = ?'))
        .get(id) as ExperimentRow | undefined;
      return row === undefined ? null : mapExperiment(row);
    });
  }

  listVersions(journeyId: string): readonly ExternalExperimentVersion[] {
    return this.protect('list external experiment versions', () => {
      const rows = this.database
        .prepare(
          experimentSelect(
            'WHERE e.journey_id = ? ORDER BY ev.created_at DESC, ev.id DESC',
          ),
        )
        .all(journeyId) as ExperimentRow[];
      return externalExperimentListSchema.parse({
        items: rows.map(mapExperiment),
      }).items;
    });
  }

  createRun(input: {
    readonly runId: string;
    readonly experiment: ExternalExperimentVersion;
    readonly targetUrl: string;
    readonly projectName: string;
    readonly journeyName: string;
    readonly safeResolvedValues: Readonly<Record<string, string>>;
    readonly startedAt: string;
  }): void {
    this.protect('create an external run', () => {
      this.database
        .prepare(
          `INSERT INTO external_runs
            (id, experiment_version_id, project_id, journey_id, status,
             started_at, target_url, project_name, journey_name,
             experiment_name, experiment_snapshot_json, resolved_values_json,
             created_at)
           VALUES (?, ?, ?, ?, 'created', ?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(
          input.runId,
          input.experiment.id,
          input.experiment.projectId,
          input.experiment.journeyId,
          input.startedAt,
          input.targetUrl,
          input.projectName,
          input.journeyName,
          input.experiment.name,
          JSON.stringify(input.experiment),
          JSON.stringify(input.safeResolvedValues),
          input.startedAt,
        );
    });
  }

  updateStatus(runId: string, status: ExternalRunDetail['status']): void {
    this.protect('update external run status', () => {
      this.database
        .prepare('UPDATE external_runs SET status = ? WHERE id = ?')
        .run(status, runId);
    });
  }

  appendEvent(event: RunEventEnvelope): void {
    this.protect('append an external run event', () => {
      const parsed = runEventEnvelopeSchema.parse(event);
      this.database
        .prepare(
          `INSERT INTO external_run_events
            (id, run_id, sequence_number, event_type, relative_timestamp_ms,
             recorded_at, schema_version, payload_json)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(
          parsed.eventId,
          parsed.runId,
          parsed.sequence,
          parsed.eventType,
          parsed.relativeTimestampMs,
          parsed.recordedAt,
          parsed.schemaVersion,
          JSON.stringify(parsed.payload),
        );
    });
  }

  finalizeRun(input: {
    readonly runId: string;
    readonly status: Extract<
      ExternalRunDetail['status'],
      'passed' | 'failed' | 'runner_error'
    >;
    readonly completedAt: string;
    readonly durationMs: number;
    readonly triggerAttempts: number;
    readonly networkObservations: readonly ExternalNetworkObservation[];
    readonly runnerError: ExternalRunnerError | null;
    readonly warnings: readonly ExternalRunWarning[];
    readonly assertions: readonly ExternalAssertionResult[];
  }): void {
    this.protect('finalize an external run', () => {
      const complete = this.database.transaction(() => {
        this.database
          .prepare(
            `UPDATE external_runs
                SET status = ?, completed_at = ?, duration_ms = ?,
                    trigger_attempts = ?, network_observations_json = ?,
                    runner_error_json = ?, warnings_json = ?
              WHERE id = ?`,
          )
          .run(
            input.status,
            input.completedAt,
            input.durationMs,
            input.triggerAttempts,
            JSON.stringify(
              externalNetworkObservationSchema
                .array()
                .parse(input.networkObservations),
            ),
            input.runnerError === null
              ? null
              : JSON.stringify(
                  externalRunnerErrorSchema.parse(input.runnerError),
                ),
            JSON.stringify(
              externalRunWarningSchema.array().parse(input.warnings),
            ),
            input.runId,
          );
        const insert = this.database.prepare(
          `INSERT INTO external_assertion_results
            (id, run_id, assertion_id, assertion_type, status, description,
             expected_description, observed_description, evaluated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        );
        for (const assertion of input.assertions) {
          const parsed = externalAssertionResultSchema.parse(assertion);
          insert.run(
            parsed.assertionResultId,
            input.runId,
            parsed.assertionId,
            parsed.type,
            parsed.status,
            parsed.description,
            parsed.expectedDescription,
            parsed.observedDescription,
            parsed.evaluatedAt,
          );
        }
      });
      complete();
    });
  }

  createArtifact(input: CreateArtifactInput): RunArtifact {
    return this.protect('create external artifact metadata', () => {
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
          `INSERT INTO external_artifacts
            (id, run_id, artifact_type, label, relative_path, mime_type,
             size_bytes, checksum_sha256, capture_sequence, created_at,
             metadata_json)
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

  getArtifact(runId: string, artifactId: string): RunArtifact | null {
    return this.protect('read external artifact metadata', () => {
      const row = this.database
        .prepare(
          `SELECT id, run_id AS runId, artifact_type AS artifactType, label,
                  relative_path AS relativePath, mime_type AS mimeType,
                  size_bytes AS sizeBytes, checksum_sha256 AS checksumSha256,
                  capture_sequence AS captureSequence, created_at AS createdAt,
                  metadata_json AS metadataJson
             FROM external_artifacts WHERE run_id = ? AND id = ?`,
        )
        .get(runId, artifactId) as ArtifactRow | undefined;
      return row === undefined ? null : mapArtifact(row);
    });
  }

  listArtifactsForProject(projectId: string): readonly RunArtifact[] {
    return this.protect('list project external artifacts', () =>
      this.listArtifacts(
        `WHERE run_id IN (
          SELECT id FROM external_runs WHERE project_id = ?
        )`,
        projectId,
      ),
    );
  }

  listArtifactsForJourney(journeyId: string): readonly RunArtifact[] {
    return this.protect('list journey external artifacts', () =>
      this.listArtifacts(
        `WHERE run_id IN (
          SELECT id FROM external_runs WHERE journey_id = ?
        )`,
        journeyId,
      ),
    );
  }

  deleteRun(runId: string): readonly RunArtifact[] | null {
    return this.protect('delete an external run', () => {
      const existing = this.database
        .prepare('SELECT 1 FROM external_runs WHERE id = ?')
        .get(runId);
      if (existing === undefined) return null;
      const artifacts = this.listArtifacts('WHERE run_id = ?', runId);
      this.database.transaction(() => {
        this.database
          .prepare('DELETE FROM external_assertion_results WHERE run_id = ?')
          .run(runId);
        this.database
          .prepare('DELETE FROM external_run_events WHERE run_id = ?')
          .run(runId);
        this.database
          .prepare('DELETE FROM external_artifacts WHERE run_id = ?')
          .run(runId);
        this.database
          .prepare('DELETE FROM external_runs WHERE id = ?')
          .run(runId);
      })();
      return artifacts;
    });
  }

  deleteVersion(versionId: string): readonly RunArtifact[] | null {
    return this.protect('delete an external experiment version', () => {
      const version = this.getVersion(versionId);
      if (version === null) return null;
      const runIds = this.database
        .prepare('SELECT id FROM external_runs WHERE experiment_version_id = ?')
        .all(versionId) as Array<{ readonly id: string }>;
      const artifacts = runIds.flatMap(({ id }) =>
        this.listArtifacts('WHERE run_id = ?', id),
      );
      this.database.transaction(() => {
        for (const { id } of runIds) {
          this.database
            .prepare('DELETE FROM external_assertion_results WHERE run_id = ?')
            .run(id);
          this.database
            .prepare('DELETE FROM external_run_events WHERE run_id = ?')
            .run(id);
          this.database
            .prepare('DELETE FROM external_artifacts WHERE run_id = ?')
            .run(id);
          this.database
            .prepare('DELETE FROM external_runs WHERE id = ?')
            .run(id);
        }
        this.database
          .prepare('DELETE FROM external_experiment_versions WHERE id = ?')
          .run(versionId);
        const remaining = this.database
          .prepare(
            'SELECT 1 FROM external_experiment_versions WHERE experiment_id = ? LIMIT 1',
          )
          .get(version.experimentId);
        if (remaining === undefined) {
          this.database
            .prepare('DELETE FROM external_experiments WHERE id = ?')
            .run(version.experimentId);
        }
      })();
      return artifacts;
    });
  }

  listRuns(query: ExternalRunListQuery): ExternalRunList {
    return this.protect('list external runs', () => {
      const clauses: string[] = [];
      const parameters: Array<string | number> = [];
      if (query.projectId !== undefined) {
        clauses.push('r.project_id = ?');
        parameters.push(query.projectId);
      }
      if (query.journeyId !== undefined) {
        clauses.push('r.journey_id = ?');
        parameters.push(query.journeyId);
      }
      const where =
        clauses.length === 0 ? '' : `WHERE ${clauses.join(' AND ')}`;
      parameters.push(query.limit, query.offset);
      const rows = this.database
        .prepare(
          `SELECT r.id,
                  r.experiment_version_id AS experimentVersionId,
                  r.project_id AS projectId, r.journey_id AS journeyId,
                  r.status, r.started_at AS startedAt,
                  r.completed_at AS completedAt, r.duration_ms AS durationMs,
                  r.project_name AS projectName, r.journey_name AS journeyName,
                  r.experiment_name AS experimentName,
                  r.trigger_attempts AS triggerAttempts,
                  r.network_observations_json AS networkObservationsJson,
                  (SELECT COUNT(*) FROM external_assertion_results ar
                    WHERE ar.run_id = r.id AND ar.status = 'passed')
                    AS passedAssertionCount,
                  (SELECT COUNT(*) FROM external_assertion_results ar
                    WHERE ar.run_id = r.id) AS assertionCount,
                  (SELECT COUNT(*) FROM external_artifacts ea
                    WHERE ea.run_id = r.id) AS screenshotCount,
                  r.created_at AS createdAt
             FROM external_runs r
             ${where}
             ORDER BY r.created_at DESC, r.id DESC
             LIMIT ? OFFSET ?`,
        )
        .all(...parameters) as RunSummaryRow[];
      return externalRunListSchema.parse({
        items: rows.map(mapRunSummary),
        limit: query.limit,
        offset: query.offset,
      });
    });
  }

  getRun(runId: string): ExternalRunDetail | null {
    return this.protect('read an external run', () => {
      const row = this.database
        .prepare(
          `SELECT id, experiment_version_id AS experimentVersionId,
                  project_id AS projectId, journey_id AS journeyId, status,
                  started_at AS startedAt, completed_at AS completedAt,
                  duration_ms AS durationMs, target_url AS targetUrl,
                  project_name AS projectName, journey_name AS journeyName,
                  experiment_name AS experimentName,
                  experiment_snapshot_json AS experimentSnapshotJson,
                  resolved_values_json AS resolvedValuesJson,
                  trigger_attempts AS triggerAttempts,
                  network_observations_json AS networkObservationsJson,
                  runner_error_json AS runnerErrorJson,
                  warnings_json AS warningsJson, created_at AS createdAt
             FROM external_runs WHERE id = ?`,
        )
        .get(runId) as RunRow | undefined;
      return row === undefined ? null : this.mapRun(row);
    });
  }

  private mapRun(row: RunRow): ExternalRunDetail {
    const events = (
      this.database
        .prepare(
          `SELECT id, run_id AS runId, sequence_number AS sequenceNumber,
                  event_type AS eventType,
                  relative_timestamp_ms AS relativeTimestampMs,
                  recorded_at AS recordedAt, schema_version AS schemaVersion,
                  payload_json AS payloadJson
             FROM external_run_events WHERE run_id = ? ORDER BY sequence_number`,
        )
        .all(row.id) as EventRow[]
    ).map(mapEvent);
    const assertions = (
      this.database
        .prepare(
          `SELECT id, assertion_id AS assertionId,
                  assertion_type AS assertionType, status, description,
                  expected_description AS expectedDescription,
                  observed_description AS observedDescription,
                  evaluated_at AS evaluatedAt
             FROM external_assertion_results WHERE run_id = ?
             ORDER BY evaluated_at, id`,
        )
        .all(row.id) as AssertionRow[]
    ).map(mapAssertion);
    const artifacts = (
      this.database
        .prepare(
          `SELECT id, run_id AS runId, artifact_type AS artifactType, label,
                  relative_path AS relativePath, mime_type AS mimeType,
                  size_bytes AS sizeBytes, checksum_sha256 AS checksumSha256,
                  capture_sequence AS captureSequence, created_at AS createdAt,
                  metadata_json AS metadataJson
             FROM external_artifacts WHERE run_id = ? ORDER BY capture_sequence`,
        )
        .all(row.id) as ArtifactRow[]
    ).map(mapArtifact);
    return externalRunDetailSchema.parse({
      runId: row.id,
      experimentVersionId: row.experimentVersionId,
      projectId: row.projectId,
      journeyId: row.journeyId,
      status: row.status,
      startedAt: row.startedAt,
      completedAt: row.completedAt,
      durationMs: row.durationMs,
      targetUrl: row.targetUrl,
      projectName: row.projectName,
      journeyName: row.journeyName,
      experimentName: row.experimentName,
      experimentSnapshot: parseJson(row.experimentSnapshotJson),
      resolvedValues: parseJson(row.resolvedValuesJson),
      triggerAttempts: row.triggerAttempts,
      networkObservations: parseJson(row.networkObservationsJson),
      assertions,
      events,
      runnerError:
        row.runnerErrorJson === null ? null : parseJson(row.runnerErrorJson),
      warnings: parseJson(row.warningsJson),
      artifacts,
      createdAt: row.createdAt,
    });
  }

  private listArtifacts(
    where: string,
    parameter: string,
  ): readonly RunArtifact[] {
    const rows = this.database
      .prepare(
        `SELECT id, run_id AS runId, artifact_type AS artifactType, label,
                relative_path AS relativePath, mime_type AS mimeType,
                size_bytes AS sizeBytes, checksum_sha256 AS checksumSha256,
                capture_sequence AS captureSequence, created_at AS createdAt,
                metadata_json AS metadataJson
           FROM external_artifacts ${where}
           ORDER BY created_at, capture_sequence`,
      )
      .all(parameter) as ArtifactRow[];
    return rows.map(mapArtifact);
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

function mapRunSummary(row: RunSummaryRow): ExternalRunSummary {
  const observations = externalNetworkObservationSchema
    .array()
    .parse(parseJson(row.networkObservationsJson));
  return externalRunSummarySchema.parse({
    runId: row.id,
    experimentVersionId: row.experimentVersionId,
    projectId: row.projectId,
    journeyId: row.journeyId,
    status: row.status,
    startedAt: row.startedAt,
    completedAt: row.completedAt,
    durationMs: row.durationMs,
    projectName: row.projectName,
    journeyName: row.journeyName,
    experimentName: row.experimentName,
    triggerAttempts: row.triggerAttempts,
    matchedRequestCount: observations.filter((item) => item.matched).length,
    passedAssertionCount: row.passedAssertionCount,
    assertionCount: row.assertionCount,
    screenshotCount: row.screenshotCount,
    createdAt: row.createdAt,
  });
}

function experimentSelect(suffix: string): string {
  return `SELECT ev.id, e.id AS experimentId, e.project_id AS projectId,
                 e.journey_id AS journeyId, e.name, e.experiment_type AS experimentType,
                 ev.version, ev.configuration_json AS configurationJson,
                 ev.journey_snapshot_json AS journeySnapshotJson,
                 ev.assertions_snapshot_json AS assertionsSnapshotJson,
                 ev.request_selection_provenance_json AS requestSelectionProvenanceJson,
                 ev.assertion_selection_provenance_json AS assertionSelectionProvenanceJson,
                 ev.created_at AS createdAt
            FROM external_experiment_versions ev
            JOIN external_experiments e ON e.id = ev.experiment_id
            ${suffix}`;
}

function mapExperiment(row: ExperimentRow): ExternalExperimentVersion {
  const configuration = parseJson(row.configurationJson) as Record<
    string,
    unknown
  >;
  return externalExperimentVersionSchema.parse({
    id: row.id,
    experimentId: row.experimentId,
    projectId: row.projectId,
    journeyId: row.journeyId,
    name: row.name,
    experimentType: row.experimentType,
    version: row.version,
    ...configuration,
    assertions: parseJson(row.assertionsSnapshotJson),
    requestSelectionProvenance:
      row.requestSelectionProvenanceJson === null
        ? null
        : parseJson(row.requestSelectionProvenanceJson),
    assertionSelectionProvenance:
      row.assertionSelectionProvenanceJson === null
        ? []
        : parseJson(row.assertionSelectionProvenanceJson),
    journeySnapshot: persistedJourneySchema.parse(
      parseJson(row.journeySnapshotJson),
    ),
    createdAt: row.createdAt,
  });
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

function mapAssertion(row: AssertionRow): ExternalAssertionResult {
  return externalAssertionResultSchema.parse({
    assertionResultId: row.id,
    assertionId: row.assertionId,
    type: row.assertionType,
    status: row.status,
    description: row.description,
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

function parseJson(value: string): unknown {
  return JSON.parse(value) as unknown;
}
