import { randomUUID } from 'node:crypto';

import {
  createExternalExperimentRequestSchema,
  createExternalExperimentSuiteRequestSchema,
  createExternalExperimentVersionRequestSchema,
  externalAssertionResultSchema,
  externalExperimentListSchema,
  externalExperimentVersionSchema,
  externalNetworkObservationSchema,
  recordedRequestEvidenceSchema,
  externalOutcomeCheckResultSchema,
  externalRunDetailSchema,
  externalRunLifecycleStatusSchema,
  externalRunListSchema,
  externalRunSummarySchema,
  externalTestDetailSchema,
  externalTestSummaryListSchema,
  externalTestSummarySchema,
  externalRunnerErrorSchema,
  externalRunWarningSchema,
  persistedJourneySchema,
  runArtifactSchema,
  runEventEnvelopeSchema,
  outcomeAggregateSchema,
  outcomeCheckRunSnapshotSchema,
  type CreateExternalExperimentRequest,
  type CreateExternalExperimentSuiteRequest,
  type CreateExternalExperimentVersionRequest,
  type ExternalAssertionResult,
  type ExternalExperimentVersion,
  type ExternalNetworkObservation,
  type ExternalOutcomeCheckResult,
  type ExternalRunDetail,
  type ExternalRunList,
  type ExternalRunListQuery,
  type ExternalRunSummary,
  type ExternalTestDetail,
  type ExternalTestSummary,
  type ExternalRunnerError,
  type ExternalRunWarning,
  type OutcomeAggregate,
  type OutcomeCheckRunSnapshot,
  type PersistedJourney,
  type RecordedRequestEvidence,
  type RunArtifact,
  type RunEventEnvelope,
} from '@formcrash/contracts';
import type Database from 'better-sqlite3';

import type { CreateArtifactInput } from './run-repository.js';
import { RunPersistenceError } from './run-repository.js';
import { OutcomeCheckRepository } from './outcome-check-repository.js';
import { createGuidedJourneySnapshot } from '../runner/external/guided-journey.js';
import { createOutcomeBaseline } from '../runner/outcomes/baseline-journey.js';
import { presentExternalRun } from '../runner/outcomes/outcome-result-presentation.js';

export class ExternalTestNameExistsError extends Error {
  constructor(readonly testName: string) {
    super(`A test named "${testName}" already exists for this journey.`);
    this.name = 'ExternalTestNameExistsError';
  }
}

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
  readonly networkEvidenceProvenanceJson: string | null;
  readonly assertionSelectionProvenanceJson: string | null;
  readonly criticalActionSnapshotJson: string | null;
  readonly outcomeChecksSnapshotJson: string;
  readonly createdAt: string;
}

interface RunRow {
  readonly id: string;
  readonly experimentVersionId: string;
  readonly projectId: string;
  readonly journeyId: string;
  readonly status: string;
  readonly lifecycleStatus: string;
  readonly outcomeAggregate: string;
  readonly assertionAggregate: string;
  readonly startedAt: string;
  readonly completedAt: string | null;
  readonly durationMs: number | null;
  readonly targetUrl: string;
  readonly projectName: string;
  readonly journeyName: string;
  readonly experimentName: string;
  readonly experimentSnapshotJson: string;
  readonly outcomeChecksSnapshotJson: string;
  readonly resolvedValuesJson: string;
  readonly triggerAttempts: number;
  readonly networkObservationsJson: string;
  readonly runnerErrorJson: string | null;
  readonly warningsJson: string;
  readonly createdAt: string;
}

interface OutcomeResultRow {
  readonly id: string;
  readonly runId: string;
  readonly outcomeCheckId: string;
  readonly journeyId: string;
  readonly criticalActionId: string;
  readonly outcomeType: string;
  readonly expectedJson: string;
  readonly observedJson: string;
  readonly expectedCount: number | null;
  readonly observedCount: number | null;
  readonly status: string;
  readonly reason: string | null;
  readonly evidenceReferencesJson: string;
  readonly templateBindingJson: string | null;
  readonly unknownsJson: string;
  readonly evaluatedAt: string;
}

interface RunSummaryRow {
  readonly id: string;
  readonly experimentVersionId: string;
  readonly projectId: string;
  readonly journeyId: string;
  readonly status: string;
  readonly lifecycleStatus: string;
  readonly outcomeAggregate: string;
  readonly assertionAggregate: string;
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

interface PriorRunEvidenceRow {
  readonly runId: string;
  readonly startedAt: string;
  readonly networkObservationsJson: string;
  readonly triggerTimestampMs: number;
}

export interface PriorRunRequestEvidence {
  readonly runId: string;
  readonly evidence: readonly RecordedRequestEvidence[];
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

  createTest(input: {
    readonly projectId: string;
    readonly journey: PersistedJourney;
    readonly request: CreateExternalExperimentRequest;
  }): ExternalExperimentVersion {
    return this.protect('create an external test', () => {
      const request = createExternalExperimentRequestSchema.parse(
        input.request,
      );
      this.validateTarget(input.journey, request.targetStepId);
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
        if (existing !== undefined) {
          throw new ExternalTestNameExistsError(request.name);
        }
        const experimentId = randomUUID();
        const now = new Date().toISOString();
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
        return this.insertVersion({
          experimentId,
          version: 1,
          journeySnapshot,
          request,
          now,
        });
      });
      return create();
    });
  }

  createTestSuite(input: {
    readonly projectId: string;
    readonly journey: PersistedJourney;
    readonly requests: CreateExternalExperimentSuiteRequest['tests'];
  }): readonly ExternalExperimentVersion[] {
    return this.protect('create an external test suite', () => {
      const requests = createExternalExperimentSuiteRequestSchema.parse({
        tests: input.requests,
      }).tests;
      const create = this.database.transaction(() =>
        requests.map((request) =>
          this.createTest({
            projectId: input.projectId,
            journey: input.journey,
            request,
          }),
        ),
      );
      return create();
    });
  }

  createVersion(input: {
    readonly testId: string;
    readonly request: CreateExternalExperimentVersionRequest;
  }): ExternalExperimentVersion {
    return this.protect('create an external test version', () => {
      const request = createExternalExperimentVersionRequestSchema.parse(
        input.request,
      );
      const latest = this.getLatestVersion(input.testId);
      if (latest === null) throw new Error('External test was not found.');
      this.validateTarget(latest.journeySnapshot, request.targetStepId);
      const create = this.database.transaction(() => {
        const versionRow = this.database
          .prepare(
            `SELECT COALESCE(MAX(version), 0) AS version
               FROM external_experiment_versions WHERE experiment_id = ?`,
          )
          .get(input.testId) as { version: number };
        return this.insertVersion({
          experimentId: input.testId,
          version: versionRow.version + 1,
          journeySnapshot: latest.journeySnapshot,
          request,
          now: new Date().toISOString(),
        });
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

  getLatestVersion(testId: string): ExternalExperimentVersion | null {
    return this.protect('read the latest external test version', () => {
      const row = this.database
        .prepare(
          experimentSelect(
            'WHERE e.id = ? ORDER BY ev.version DESC, ev.created_at DESC LIMIT 1',
          ),
        )
        .get(testId) as ExperimentRow | undefined;
      return row === undefined ? null : mapExperiment(row);
    });
  }

  resolveVersion(identifier: string): ExternalExperimentVersion | null {
    return this.getVersion(identifier) ?? this.getLatestVersion(identifier);
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

  listVersionsByProject(
    projectId: string,
  ): readonly ExternalExperimentVersion[] {
    return this.protect('list project external experiment versions', () => {
      const rows = this.database
        .prepare(
          experimentSelect(
            'WHERE e.project_id = ? ORDER BY ev.created_at DESC, ev.id DESC',
          ),
        )
        .all(projectId) as ExperimentRow[];
      return externalExperimentListSchema.parse({
        items: rows.map(mapExperiment),
      }).items;
    });
  }

  listTestSummaries(journeyId: string): readonly ExternalTestSummary[] {
    return this.protect('list stable external tests', () => {
      const versions = this.listVersions(journeyId);
      const families = new Map<string, ExternalExperimentVersion[]>();
      for (const version of versions) {
        const family = families.get(version.experimentId) ?? [];
        family.push(version);
        families.set(version.experimentId, family);
      }
      return externalTestSummaryListSchema.parse({
        items: [...families.values()].map((family) =>
          this.mapTestSummary(family),
        ),
      }).items;
    });
  }

  getTestDetail(testId: string): ExternalTestDetail | null {
    return this.protect('read stable external test detail', () => {
      const historicalVersion = this.getVersion(testId);
      const stableTestId = historicalVersion?.experimentId ?? testId;
      const rows = this.database
        .prepare(
          experimentSelect(
            'WHERE e.id = ? ORDER BY ev.version DESC, ev.created_at DESC',
          ),
        )
        .all(stableTestId) as ExperimentRow[];
      if (rows.length === 0) return null;
      const versions = rows.map(mapExperiment);
      const summary = this.mapTestSummary(versions);
      return externalTestDetailSchema.parse({
        ...summary,
        versions,
        runs: this.listRunsForTest(stableTestId),
      });
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
             outcome_checks_snapshot_json, created_at)
           VALUES (?, ?, ?, ?, 'created', ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
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
          JSON.stringify(input.experiment.outcomeCheckSnapshot),
          input.startedAt,
        );
    });
  }

  updateStatus(runId: string, status: ExternalRunDetail['status']): void {
    this.protect('update external run status', () => {
      this.database
        .prepare(
          'UPDATE external_runs SET status = ?, lifecycle_status = ? WHERE id = ?',
        )
        .run(status, status, runId);
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
    readonly outcomeAggregate?: OutcomeAggregate;
    readonly assertionAggregate?: OutcomeAggregate;
    readonly outcomeCheckResults?: readonly ExternalOutcomeCheckResult[];
  }): void {
    this.protect('finalize an external run', () => {
      const complete = this.database.transaction(() => {
        this.assertOutcomeEvidenceReferences(
          input.runId,
          input.outcomeCheckResults ?? [],
          input.networkObservations,
        );
        this.database
          .prepare(
            `UPDATE external_runs
                SET status = ?, completed_at = ?, duration_ms = ?,
                    trigger_attempts = ?, network_observations_json = ?,
                    runner_error_json = ?, warnings_json = ?,
                    lifecycle_status = ?, outcome_aggregate = ?,
                    assertion_aggregate = ?
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
            input.status === 'runner_error' ? 'runner_error' : 'completed',
            outcomeAggregateSchema.parse(
              input.outcomeAggregate ?? 'not_configured',
            ),
            outcomeAggregateSchema.parse(
              input.assertionAggregate ??
                (input.status === 'passed'
                  ? 'passed'
                  : input.status === 'failed'
                    ? 'failed'
                    : 'could_not_verify'),
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
        const insertOutcome = this.database.prepare(
          `INSERT INTO external_outcome_check_results
            (id, run_id, outcome_check_id, journey_id, critical_action_id,
             outcome_type, expected_json, observed_json, expected_count,
             observed_count, status, reason, evidence_references_json,
             template_binding_json, unknowns_json, evaluated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        );
        for (const result of input.outcomeCheckResults ?? []) {
          const parsed = externalOutcomeCheckResultSchema.parse(result);
          insertOutcome.run(
            parsed.outcomeCheckResultId,
            input.runId,
            parsed.outcomeCheckId,
            parsed.journeyId,
            parsed.criticalActionId,
            parsed.type,
            JSON.stringify(parsed.expected),
            JSON.stringify(parsed.observed),
            parsed.expectedCount,
            parsed.observedCount,
            parsed.status,
            parsed.reason,
            JSON.stringify(parsed.evidenceReferences),
            parsed.templateBinding === null
              ? null
              : JSON.stringify(parsed.templateBinding),
            JSON.stringify(parsed.unknowns),
            parsed.evaluatedAt,
          );
        }
      });
      complete();
    });
  }

  private assertOutcomeEvidenceReferences(
    runId: string,
    results: readonly ExternalOutcomeCheckResult[],
    observations: readonly ExternalNetworkObservation[],
  ): void {
    const eventIds = new Set(
      (
        this.database
          .prepare('SELECT id FROM external_run_events WHERE run_id = ?')
          .all(runId) as Array<{ readonly id: string }>
      ).map((row) => row.id),
    );
    const artifactIds = new Set(
      (
        this.database
          .prepare('SELECT id FROM external_artifacts WHERE run_id = ?')
          .all(runId) as Array<{ readonly id: string }>
      ).map((row) => row.id),
    );
    const requestIds = new Set(observations.map((item) => item.requestId));
    for (const candidate of results) {
      const result = externalOutcomeCheckResultSchema.parse(candidate);
      if (result.runId !== runId) {
        throw new Error('Outcome Check result belongs to another run.');
      }
      const referencedEventIds = [
        ...result.evidenceReferences.triggerEventIds,
        ...result.evidenceReferences.runnerEventIds,
      ];
      if (referencedEventIds.some((id) => !eventIds.has(id))) {
        throw new Error(
          'Outcome Check result references an event that was not persisted for this run.',
        );
      }
      if (
        result.evidenceReferences.screenshotArtifactIds.some(
          (id) => !artifactIds.has(id),
        )
      ) {
        throw new Error(
          'Outcome Check result references a screenshot that was not persisted for this run.',
        );
      }
      if (
        result.evidenceReferences.requestObservationIds.some(
          (id) => !requestIds.has(id),
        )
      ) {
        throw new Error(
          'Outcome Check result references a request observation that was not persisted for this run.',
        );
      }
    }
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
          .prepare(
            'DELETE FROM external_outcome_check_results WHERE run_id = ?',
          )
          .run(runId);
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
            .prepare(
              'DELETE FROM external_outcome_check_results WHERE run_id = ?',
            )
            .run(id);
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

  deleteTest(testId: string): readonly RunArtifact[] | null {
    return this.protect('delete an external test', () => {
      const direct = this.database
        .prepare('SELECT id FROM external_experiments WHERE id = ?')
        .get(testId) as { readonly id: string } | undefined;
      const historical =
        direct === undefined
          ? (this.database
              .prepare(
                'SELECT experiment_id AS id FROM external_experiment_versions WHERE id = ?',
              )
              .get(testId) as { readonly id: string } | undefined)
          : undefined;
      const stableTestId = direct?.id ?? historical?.id;
      if (stableTestId === undefined) return null;
      const runIds = this.database
        .prepare(
          `SELECT r.id
             FROM external_runs r
             JOIN external_experiment_versions ev
               ON ev.id = r.experiment_version_id
            WHERE ev.experiment_id = ?`,
        )
        .all(stableTestId) as Array<{ readonly id: string }>;
      const artifacts = runIds.flatMap(({ id }) =>
        this.listArtifacts('WHERE run_id = ?', id),
      );
      this.database.transaction(() => {
        for (const { id } of runIds) {
          this.database
            .prepare(
              'DELETE FROM external_outcome_check_results WHERE run_id = ?',
            )
            .run(id);
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
          .prepare(
            'DELETE FROM external_experiment_versions WHERE experiment_id = ?',
          )
          .run(stableTestId);
        this.database
          .prepare('DELETE FROM external_experiments WHERE id = ?')
          .run(stableTestId);
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
                  r.status, r.lifecycle_status AS lifecycleStatus,
                  r.outcome_aggregate AS outcomeAggregate,
                  r.assertion_aggregate AS assertionAggregate,
                  r.started_at AS startedAt,
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

  listPriorRunRequestEvidence(
    journeyId: string,
    actionStepId: string,
  ): readonly PriorRunRequestEvidence[] {
    return this.protect('list prior-run request evidence', () => {
      const rows = this.database
        .prepare(
          `SELECT r.id AS runId, r.started_at AS startedAt,
                  r.network_observations_json AS networkObservationsJson,
                  MIN(ere.relative_timestamp_ms) AS triggerTimestampMs
             FROM external_runs r
             JOIN external_run_events ere ON ere.run_id = r.id
            WHERE r.journey_id = ?
              AND ere.event_type = 'experiment.triggered'
              AND json_extract(ere.payload_json, '$.targetStepId') = ?
            GROUP BY r.id
            ORDER BY r.created_at DESC, r.id DESC
            LIMIT 20`,
        )
        .all(journeyId, actionStepId) as PriorRunEvidenceRow[];
      return rows.flatMap((row) => {
        const observations = externalNetworkObservationSchema
          .array()
          .parse(parseJson(row.networkObservationsJson));
        const grouped = new Map<string, RecordedRequestEvidence>();
        for (const observation of observations) {
          const relativeTimestampMs =
            observation.startedAtMs - row.triggerTimestampMs;
          if (relativeTimestampMs < 0 || relativeTimestampMs > 5_000) continue;
          const host = new URL(observation.origin).host;
          const key = [
            observation.method,
            observation.origin,
            observation.pathname,
            observation.status ?? 'pending',
            observation.failed,
          ].join('|');
          const current = grouped.get(key);
          if (current === undefined) {
            grouped.set(
              key,
              recordedRequestEvidenceSchema.parse({
                actionStepId,
                method: observation.method,
                origin: observation.origin,
                host,
                pathname: observation.pathname,
                status: observation.status,
                failed: observation.failed,
                relativeTimestampMs,
                occurrences: 1,
                observedAt: new Date(
                  Date.parse(row.startedAt) + observation.startedAtMs,
                ).toISOString(),
              }),
            );
          } else {
            grouped.set(key, {
              ...current,
              failed: current.failed || observation.failed,
              occurrences: current.occurrences + 1,
              relativeTimestampMs: Math.min(
                current.relativeTimestampMs,
                relativeTimestampMs,
              ),
            });
          }
        }
        return grouped.size === 0
          ? []
          : [{ runId: row.runId, evidence: [...grouped.values()] }];
      });
    });
  }

  private mapTestSummary(
    versions: readonly ExternalExperimentVersion[],
  ): ExternalTestSummary {
    const latestVersion = versions.reduce((latest, candidate) =>
      candidate.version > latest.version ? candidate : latest,
    );
    const runs = this.listRunsForTest(latestVersion.experimentId, 1);
    const count = this.database
      .prepare(
        `SELECT COUNT(*) AS count
           FROM external_runs r
           JOIN external_experiment_versions ev
             ON ev.id = r.experiment_version_id
          WHERE ev.experiment_id = ?`,
      )
      .get(latestVersion.experimentId) as { count: number };
    return externalTestSummarySchema.parse({
      testId: latestVersion.experimentId,
      projectId: latestVersion.projectId,
      journeyId: latestVersion.journeyId,
      name: latestVersion.name,
      experimentType: latestVersion.experimentType,
      latestVersion,
      versionCount: versions.length,
      latestRun: runs[0] ?? null,
      runCount: count.count,
    });
  }

  private listRunsForTest(
    testId: string,
    limit = 100,
  ): readonly ExternalRunSummary[] {
    const rows = this.database
      .prepare(
        `SELECT r.id,
                r.experiment_version_id AS experimentVersionId,
                r.project_id AS projectId, r.journey_id AS journeyId,
                r.status, r.lifecycle_status AS lifecycleStatus,
                r.outcome_aggregate AS outcomeAggregate,
                r.assertion_aggregate AS assertionAggregate,
                r.started_at AS startedAt,
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
           JOIN external_experiment_versions ev
             ON ev.id = r.experiment_version_id
          WHERE ev.experiment_id = ?
          ORDER BY r.created_at DESC, r.id DESC
          LIMIT ?`,
      )
      .all(testId, limit) as RunSummaryRow[];
    return rows.map(mapRunSummary);
  }

  getRun(runId: string): ExternalRunDetail | null {
    return this.protect('read an external run', () => {
      const row = this.database
        .prepare(
          `SELECT id, experiment_version_id AS experimentVersionId,
                  project_id AS projectId, journey_id AS journeyId, status,
                  lifecycle_status AS lifecycleStatus,
                  outcome_aggregate AS outcomeAggregate,
                  assertion_aggregate AS assertionAggregate,
                  started_at AS startedAt, completed_at AS completedAt,
                  duration_ms AS durationMs, target_url AS targetUrl,
                  project_name AS projectName, journey_name AS journeyName,
                  experiment_name AS experimentName,
                  experiment_snapshot_json AS experimentSnapshotJson,
                  outcome_checks_snapshot_json AS outcomeChecksSnapshotJson,
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
    const outcomeCheckResults = (
      this.database
        .prepare(
          `SELECT id, run_id AS runId, outcome_check_id AS outcomeCheckId,
                  journey_id AS journeyId, critical_action_id AS criticalActionId,
                  outcome_type AS outcomeType, expected_json AS expectedJson,
                  observed_json AS observedJson, expected_count AS expectedCount,
                  observed_count AS observedCount, status, reason,
                  evidence_references_json AS evidenceReferencesJson,
                  template_binding_json AS templateBindingJson,
                  unknowns_json AS unknownsJson, evaluated_at AS evaluatedAt
             FROM external_outcome_check_results WHERE run_id = ?
             ORDER BY evaluated_at, id`,
        )
        .all(row.id) as OutcomeResultRow[]
    ).map(mapOutcomeResult);
    const lifecycleStatus = externalRunLifecycleStatusSchema.parse(
      row.lifecycleStatus,
    );
    const outcomeAggregate = outcomeAggregateSchema.parse(row.outcomeAggregate);
    const outcomeCheckSnapshot = outcomeCheckRunSnapshotSchema.parse(
      parseJson(row.outcomeChecksSnapshotJson),
    );
    const networkObservations = externalNetworkObservationSchema
      .array()
      .parse(parseJson(row.networkObservationsJson));
    const runnerError =
      row.runnerErrorJson === null
        ? null
        : externalRunnerErrorSchema.parse(parseJson(row.runnerErrorJson));
    const presentation = presentExternalRun({
      lifecycleStatus,
      outcomeAggregate,
      triggerAttempts: row.triggerAttempts,
      snapshot: outcomeCheckSnapshot,
      results: outcomeCheckResults,
      observations: networkObservations,
      assertions,
      events,
      artifacts,
      runnerError,
    });
    return externalRunDetailSchema.parse({
      runId: row.id,
      experimentVersionId: row.experimentVersionId,
      projectId: row.projectId,
      journeyId: row.journeyId,
      status: row.status,
      lifecycleStatus,
      outcomeAggregate,
      assertionAggregate: row.assertionAggregate,
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
      networkObservations,
      assertions,
      outcomeCheckSnapshot,
      outcomeCheckResults,
      presentation,
      events,
      runnerError,
      warnings: parseJson(row.warningsJson),
      artifacts,
      createdAt: row.createdAt,
    });
  }

  private insertVersion(input: {
    readonly experimentId: string;
    readonly version: number;
    readonly journeySnapshot: PersistedJourney;
    readonly request:
      CreateExternalExperimentRequest | CreateExternalExperimentVersionRequest;
    readonly now: string;
  }): ExternalExperimentVersion {
    const id = randomUUID();
    const outcomeCheckSnapshot = new OutcomeCheckRepository(
      this.database,
    ).snapshot(input.journeySnapshot.id);
    const journeySnapshot = alignJourneyWithOutcomeBindings(
      input.journeySnapshot,
      outcomeCheckSnapshot,
    );
    this.validateOutcomeCheckSnapshot(
      outcomeCheckSnapshot,
      input.request.targetStepId,
    );
    const assertions = input.request.assertions.filter(
      (assertion) =>
        !outcomeCheckSnapshot.checks.some(
          (check) => assertion.id === `outcome-${check.id}`,
        ),
    );
    if (outcomeCheckSnapshot.checks.length === 0 && assertions.length === 0) {
      throw new Error(
        'A test requires at least one approved Outcome Check or custom technical check.',
      );
    }
    const configuration = {
      targetStepId: input.request.targetStepId,
      triggerCount: input.request.triggerCount,
      intervalMs: input.request.intervalMs,
      networkMatcher: input.request.networkMatcher,
      continueAfterTarget: input.request.continueAfterTarget,
      guided: input.request.guided ?? false,
    };
    this.database
      .prepare(
        `INSERT INTO external_experiment_versions
          (id, experiment_id, version, configuration_json,
           journey_snapshot_json, assertions_snapshot_json,
           request_selection_provenance_json,
           network_evidence_provenance_json,
           assertion_selection_provenance_json,
           critical_action_snapshot_json, outcome_checks_snapshot_json,
           created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        id,
        input.experimentId,
        input.version,
        JSON.stringify(configuration),
        JSON.stringify(journeySnapshot),
        JSON.stringify(assertions),
        input.request.requestSelectionProvenance === null
          ? null
          : JSON.stringify(input.request.requestSelectionProvenance),
        input.request.networkEvidenceProvenance == null
          ? null
          : JSON.stringify(input.request.networkEvidenceProvenance),
        (input.request.assertionSelectionProvenance?.length ?? 0) === 0
          ? null
          : JSON.stringify(
              input.request.assertionSelectionProvenance?.filter(
                (entry) =>
                  entry.assertionId === null ||
                  assertions.some(
                    (assertion) => assertion.id === entry.assertionId,
                  ),
              ),
            ),
        outcomeCheckSnapshot.criticalAction === null
          ? null
          : JSON.stringify(outcomeCheckSnapshot.criticalAction),
        JSON.stringify(outcomeCheckSnapshot.checks),
        input.now,
      );
    const created = this.getVersion(id);
    if (created === null)
      throw new Error('Created experiment version is missing.');
    return created;
  }

  private validateTarget(
    journey: PersistedJourney,
    targetStepId: string,
  ): void {
    const target = journey.steps.find((step) => step.id === targetStepId);
    if (target === undefined)
      throw new Error('Target journey step was not found.');
    if (target.type !== 'click' && target.type !== 'submit') {
      throw new Error('Impatient User can target only click or submit steps.');
    }
  }

  private validateOutcomeCheckSnapshot(
    snapshot: OutcomeCheckRunSnapshot,
    targetStepId: string,
  ): void {
    if (snapshot.checks.length === 0) return;
    if (snapshot.criticalAction === null) {
      throw new Error(
        'Outcome Checks exist without an approved Critical Action.',
      );
    }
    if (snapshot.criticalAction.stepId !== targetStepId) {
      throw new Error(
        'The test target must be the approved Critical Action for every required Outcome Check.',
      );
    }
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
      if (
        error instanceof RunPersistenceError ||
        error instanceof ExternalTestNameExistsError
      ) {
        throw error;
      }
      throw new RunPersistenceError(operation, error);
    }
  }
}

function alignJourneyWithOutcomeBindings(
  journey: PersistedJourney,
  snapshot: OutcomeCheckRunSnapshot,
): PersistedJourney {
  const hasGeneratedOutcomeBinding = snapshot.checks.some(
    (check) =>
      check.type !== 'final_pathname_matches' &&
      check.target.generatedBindings.length > 0,
  );
  if (!hasGeneratedOutcomeBinding) return journey;
  const baseline = createOutcomeBaseline(journey);
  return baseline.generatedInputs.length === 0 ? journey : baseline.journey;
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
    lifecycleStatus: row.lifecycleStatus,
    outcomeAggregate: row.outcomeAggregate,
    assertionAggregate: row.assertionAggregate,
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
                 ev.network_evidence_provenance_json AS networkEvidenceProvenanceJson,
                 ev.assertion_selection_provenance_json AS assertionSelectionProvenanceJson,
                 ev.critical_action_snapshot_json AS criticalActionSnapshotJson,
                 ev.outcome_checks_snapshot_json AS outcomeChecksSnapshotJson,
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
    networkEvidenceProvenance:
      row.networkEvidenceProvenanceJson === null
        ? null
        : parseJson(row.networkEvidenceProvenanceJson),
    assertionSelectionProvenance:
      row.assertionSelectionProvenanceJson === null
        ? []
        : parseJson(row.assertionSelectionProvenanceJson),
    outcomeCheckSnapshot: outcomeCheckRunSnapshotSchema.parse({
      criticalAction:
        row.criticalActionSnapshotJson === null
          ? null
          : parseJson(row.criticalActionSnapshotJson),
      checks: parseJson(row.outcomeChecksSnapshotJson),
    }),
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

function mapOutcomeResult(row: OutcomeResultRow): ExternalOutcomeCheckResult {
  return externalOutcomeCheckResultSchema.parse({
    outcomeCheckResultId: row.id,
    runId: row.runId,
    outcomeCheckId: row.outcomeCheckId,
    journeyId: row.journeyId,
    criticalActionId: row.criticalActionId,
    type: row.outcomeType,
    expected: parseJson(row.expectedJson),
    observed: parseJson(row.observedJson),
    expectedCount: row.expectedCount,
    observedCount: row.observedCount,
    status: row.status,
    reason: row.reason,
    evidenceReferences: parseJson(row.evidenceReferencesJson),
    templateBinding:
      row.templateBindingJson === null
        ? null
        : parseJson(row.templateBindingJson),
    unknowns: parseJson(row.unknownsJson),
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
