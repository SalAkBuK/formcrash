import { randomUUID } from 'node:crypto';

import {
  journeyListSchema,
  journeyRecordingMetadataSchema,
  hybridTraceManifestSchema,
  journeyTraceReferenceSchema,
  persistedJourneySchema,
  projectListSchema,
  projectSchema,
  recordedJourneyStepSchema,
  recordingSessionSchema,
  recordingWarningSchema,
  recordedRequestEvidenceSchema,
  traceSummarySchema,
  type CreateProjectRequest,
  type JourneyRecordingMetadata,
  type HybridTraceManifest,
  type JourneyTraceReference,
  type PersistedJourney,
  type Project,
  type ProjectEnvironment,
  type RecordedJourneyStep,
  type RecordingSession,
  type RecordingSessionStatus,
  type RecordingWarning,
  type RecordedRequestEvidence,
  type TraceCaptureStatus,
  type TraceSummary,
} from '@formcrash/contracts';
import type Database from 'better-sqlite3';

import { SAMPLE_DEFINITION_IDS } from './sample-seed.js';

interface ProjectRow {
  readonly id: string;
  readonly name: string;
  readonly targetUrl: string;
  readonly environment: string;
  readonly description: string;
  readonly createdAt: string;
  readonly updatedAt: string;
}

interface JourneyRow {
  readonly id: string;
  readonly projectId: string;
  readonly name: string;
  readonly version: number;
  readonly definitionJson: string;
  readonly recordingMetadataJson: string;
  readonly createdAt: string;
  readonly traceId: string | null;
  readonly traceChecksumSha256: string | null;
  readonly traceSizeBytes: number | null;
  readonly traceManifestJson: string | null;
}

interface RecordingRow {
  readonly id: string;
  readonly projectId: string;
  readonly status: string;
  readonly stepsJson: string;
  readonly warningsJson: string;
  readonly errorMessage: string | null;
  readonly authenticationRequired: number;
  readonly startedAt: string;
  readonly completedAt: string | null;
  readonly captureFormat: string;
  readonly traceStatus: string;
  readonly traceSummaryJson: string | null;
  readonly requestEvidenceJson: string;
}

interface RecordingTraceRow {
  readonly id: string;
  readonly recordingSessionId: string;
  readonly manifestJson: string;
  readonly relativePath: string;
  readonly sizeBytes: number;
  readonly checksumSha256: string;
  readonly createdAt: string;
}

export interface RecordingTraceRecord {
  readonly id: string;
  readonly recordingSessionId: string;
  readonly manifest: HybridTraceManifest;
  readonly relativePath: string;
  readonly sizeBytes: number;
  readonly checksumSha256: string;
  readonly createdAt: string;
}

export class ProjectJourneyRepository {
  constructor(private readonly database: Database.Database) {}

  createProject(input: CreateProjectRequest): Project {
    const now = new Date().toISOString();
    const project = projectSchema.parse({
      id: randomUUID(),
      ...input,
      environment:
        input.environment ?? inferProjectEnvironment(input.targetUrl),
      description: input.description ?? '',
      createdAt: now,
      updatedAt: now,
    });
    this.database
      .prepare(
        `INSERT INTO projects
          (id, name, target_url, environment, description, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        project.id,
        project.name,
        project.targetUrl,
        project.environment,
        project.description,
        project.createdAt,
        project.updatedAt,
      );
    return project;
  }

  listProjects(): readonly Project[] {
    const rows = this.database
      .prepare(
        `SELECT id, name, target_url AS targetUrl, environment, description,
                created_at AS createdAt, updated_at AS updatedAt
           FROM projects ORDER BY updated_at DESC, id DESC`,
      )
      .all() as ProjectRow[];
    return projectListSchema.parse({ items: rows }).items;
  }

  getProject(projectId: string): Project | null {
    const row = this.database
      .prepare(
        `SELECT id, name, target_url AS targetUrl, environment, description,
                created_at AS createdAt, updated_at AS updatedAt
           FROM projects WHERE id = ?`,
      )
      .get(projectId) as ProjectRow | undefined;
    return row === undefined ? null : projectSchema.parse(row);
  }

  deleteProject(
    projectId: string,
    force = false,
  ): 'deleted' | 'not_found' | 'protected' | 'has_activity' {
    if (projectId === SAMPLE_DEFINITION_IDS.projectId) return 'protected';
    if (this.getProject(projectId) === null) return 'not_found';

    const dependentTables = [
      'journeys',
      'recording_sessions',
      'auth_capture_sessions',
      'experiments',
      'external_experiments',
      'external_runs',
    ] as const;
    const hasActivity = dependentTables.some((table) => {
      const row = this.database
        .prepare(`SELECT 1 FROM ${table} WHERE project_id = ? LIMIT 1`)
        .get(projectId);
      return row !== undefined;
    });
    if (hasActivity && !force) return 'has_activity';

    const remove = this.database.transaction(() => {
      if (force) {
        deleteProjectActivity(this.database, projectId);
      }
      this.database
        .prepare('DELETE FROM project_execution_settings WHERE project_id = ?')
        .run(projectId);
      this.database
        .prepare('DELETE FROM project_auth_sessions WHERE project_id = ?')
        .run(projectId);
      this.database.prepare('DELETE FROM projects WHERE id = ?').run(projectId);
    });
    remove();
    return 'deleted';
  }

  deleteJourney(journeyId: string): 'deleted' | 'not_found' {
    const journey = this.getJourney(journeyId);
    if (journey === null) return 'not_found';
    const remove = this.database.transaction(() => {
      deleteJourneyActivity(this.database, journeyId);
      this.database.prepare('DELETE FROM journeys WHERE id = ?').run(journeyId);
      this.database
        .prepare('UPDATE projects SET updated_at = ? WHERE id = ?')
        .run(new Date().toISOString(), journey.projectId);
    });
    remove();
    return 'deleted';
  }

  createRecordingSession(projectId: string): RecordingSession {
    const session = recordingSessionSchema.parse({
      id: randomUUID(),
      projectId,
      status: 'created',
      steps: [],
      warnings: [],
      errorMessage: null,
      authenticationRequired: false,
      startedAt: new Date().toISOString(),
      completedAt: null,
      captureFormat: 'hybrid-v2',
      traceStatus: 'capturing',
      traceSummary: null,
      requestEvidence: [],
    });
    this.database
      .prepare(
        `INSERT INTO recording_sessions
          (id, project_id, status, steps_json, warnings_json, error_message,
           started_at, completed_at, capture_format, trace_status,
           trace_summary_json, request_evidence_json)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        session.id,
        session.projectId,
        session.status,
        '[]',
        '[]',
        null,
        session.startedAt,
        null,
        session.captureFormat,
        session.traceStatus,
        null,
        '[]',
      );
    return session;
  }

  updateRecordingSession(input: {
    readonly id: string;
    readonly status: RecordingSessionStatus;
    readonly steps?: readonly RecordedJourneyStep[];
    readonly warnings?: readonly RecordingWarning[];
    readonly errorMessage?: string | null;
    readonly authenticationRequired?: boolean;
    readonly completedAt?: string | null;
    readonly traceStatus?: TraceCaptureStatus;
    readonly traceSummary?: TraceSummary | null;
    readonly requestEvidence?: readonly RecordedRequestEvidence[];
  }): RecordingSession {
    const current = this.getRecordingSession(input.id);
    if (current === null) throw new Error('Recording session was not found.');
    const steps = recordedJourneyStepSchema
      .array()
      .parse(input.steps ?? current.steps);
    const warnings = recordingWarningSchema
      .array()
      .parse(input.warnings ?? current.warnings);
    this.database
      .prepare(
        `UPDATE recording_sessions
            SET status = ?, steps_json = ?, warnings_json = ?,
                error_message = ?, authentication_required = ?,
                completed_at = ?, trace_status = ?,
                trace_summary_json = ?, request_evidence_json = ?
          WHERE id = ?`,
      )
      .run(
        input.status,
        JSON.stringify(steps),
        JSON.stringify(warnings),
        input.errorMessage === undefined
          ? current.errorMessage
          : input.errorMessage,
        input.authenticationRequired === undefined
          ? Number(current.authenticationRequired)
          : Number(input.authenticationRequired),
        input.completedAt === undefined
          ? current.completedAt
          : input.completedAt,
        input.traceStatus ?? current.traceStatus ?? 'not_captured',
        input.traceSummary === undefined
          ? current.traceSummary === null
            ? null
            : JSON.stringify(current.traceSummary)
          : input.traceSummary === null
            ? null
            : JSON.stringify(traceSummarySchema.parse(input.traceSummary)),
        JSON.stringify(
          recordedRequestEvidenceSchema
            .array()
            .max(500)
            .parse(input.requestEvidence ?? current.requestEvidence),
        ),
        input.id,
      );
    const updated = this.getRecordingSession(input.id);
    if (updated === null) throw new Error('Recording session update was lost.');
    return updated;
  }

  getRecordingSession(sessionId: string): RecordingSession | null {
    const row = this.database
      .prepare(
        `SELECT id, project_id AS projectId, status, steps_json AS stepsJson,
                warnings_json AS warningsJson, error_message AS errorMessage,
                authentication_required AS authenticationRequired,
                started_at AS startedAt, completed_at AS completedAt,
                capture_format AS captureFormat, trace_status AS traceStatus,
                trace_summary_json AS traceSummaryJson,
                request_evidence_json AS requestEvidenceJson
           FROM recording_sessions WHERE id = ?`,
      )
      .get(sessionId) as RecordingRow | undefined;
    if (row === undefined) return null;
    return recordingSessionSchema.parse({
      ...row,
      authenticationRequired: row.authenticationRequired === 1,
      steps: JSON.parse(row.stepsJson) as unknown,
      warnings: JSON.parse(row.warningsJson) as unknown,
      traceSummary:
        row.traceSummaryJson === null
          ? null
          : (JSON.parse(row.traceSummaryJson) as unknown),
      requestEvidence: JSON.parse(row.requestEvidenceJson) as unknown,
    });
  }

  listRecordingRequestEvidence(
    journeyId: string,
    actionStepId: string,
  ): readonly RecordedRequestEvidence[] {
    const journey = this.getJourney(journeyId);
    const sessionId = journey?.recordingMetadata.recordingSessionId ?? null;
    if (sessionId === null) return [];
    return (
      this.getRecordingSession(sessionId)?.requestEvidence.filter(
        (candidate) => candidate.actionStepId === actionStepId,
      ) ?? []
    );
  }

  saveJourney(input: {
    readonly projectId: string;
    readonly name: string;
    readonly steps: readonly RecordedJourneyStep[];
    readonly metadata: JourneyRecordingMetadata;
  }): PersistedJourney {
    const steps = recordedJourneyStepSchema.array().min(1).parse(input.steps);
    const metadata = journeyRecordingMetadataSchema.parse(input.metadata);
    const createdAt = new Date().toISOString();
    const save = this.database.transaction(() => {
      const row = this.database
        .prepare(
          `SELECT COALESCE(MAX(version), 0) AS version
             FROM journeys WHERE project_id = ? AND name = ?`,
        )
        .get(input.projectId, input.name) as { version: number };
      const journey = persistedJourneySchema.parse({
        id: randomUUID(),
        projectId: input.projectId,
        name: input.name,
        version: row.version + 1,
        steps,
        recordingMetadata: metadata,
        createdAt,
      });
      this.database
        .prepare(
          `INSERT INTO journeys
            (id, project_id, name, version, definition_json,
             recording_metadata_json, created_at)
           VALUES (?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(
          journey.id,
          journey.projectId,
          journey.name,
          journey.version,
          JSON.stringify(journey.steps),
          JSON.stringify(journey.recordingMetadata),
          journey.createdAt,
        );
      const trace = this.getRecordingTraceBySession(
        input.metadata.recordingSessionId,
      );
      if (trace !== null) {
        const includedStepIds = new Set(journey.steps.map((step) => step.id));
        const manifest = hybridTraceManifestSchema.parse({
          ...trace.manifest,
          interactions: trace.manifest.interactions.filter((interaction) =>
            includedStepIds.has(interaction.stepId),
          ),
        });
        this.database
          .prepare(
            `INSERT INTO journey_trace_links
              (journey_id, trace_id, manifest_json, created_at)
             VALUES (?, ?, ?, ?)`,
          )
          .run(journey.id, trace.id, JSON.stringify(manifest), createdAt);
      }
      this.database
        .prepare('UPDATE projects SET updated_at = ? WHERE id = ?')
        .run(createdAt, input.projectId);
      return this.getJourney(journey.id) ?? journey;
    });
    return save();
  }

  listJourneys(projectId: string): readonly PersistedJourney[] {
    if (!this.traceStorageAvailable()) {
      const rows = this.database
        .prepare(
          `SELECT id, project_id AS projectId, name, version,
                  definition_json AS definitionJson,
                  recording_metadata_json AS recordingMetadataJson,
                  created_at AS createdAt, NULL AS traceId,
                  NULL AS traceChecksumSha256, NULL AS traceSizeBytes,
                  NULL AS traceManifestJson
             FROM journeys
            WHERE project_id = ? AND recording_metadata_json IS NOT NULL
            ORDER BY created_at DESC, id DESC`,
        )
        .all(projectId) as JourneyRow[];
      return journeyListSchema.parse({ items: rows.map(mapJourney) }).items;
    }
    const rows = this.database
      .prepare(
        `SELECT journeys.id, journeys.project_id AS projectId, journeys.name,
                journeys.version, journeys.definition_json AS definitionJson,
                journeys.recording_metadata_json AS recordingMetadataJson,
                journeys.created_at AS createdAt,
                journey_trace_links.trace_id AS traceId,
                recording_traces.checksum_sha256 AS traceChecksumSha256,
                recording_traces.size_bytes AS traceSizeBytes,
                journey_trace_links.manifest_json AS traceManifestJson
           FROM journeys
          LEFT JOIN journey_trace_links ON journey_trace_links.journey_id = journeys.id
          LEFT JOIN recording_traces ON recording_traces.id = journey_trace_links.trace_id
          WHERE journeys.project_id = ?
            AND journeys.recording_metadata_json IS NOT NULL
          ORDER BY journeys.created_at DESC, journeys.id DESC`,
      )
      .all(projectId) as JourneyRow[];
    return journeyListSchema.parse({ items: rows.map(mapJourney) }).items;
  }

  getJourney(journeyId: string): PersistedJourney | null {
    if (!this.traceStorageAvailable()) {
      const row = this.database
        .prepare(
          `SELECT id, project_id AS projectId, name, version,
                  definition_json AS definitionJson,
                  recording_metadata_json AS recordingMetadataJson,
                  created_at AS createdAt, NULL AS traceId,
                  NULL AS traceChecksumSha256, NULL AS traceSizeBytes,
                  NULL AS traceManifestJson
             FROM journeys
            WHERE id = ? AND recording_metadata_json IS NOT NULL`,
        )
        .get(journeyId) as JourneyRow | undefined;
      return row === undefined ? null : mapJourney(row);
    }
    const row = this.database
      .prepare(
        `SELECT journeys.id, journeys.project_id AS projectId, journeys.name,
                journeys.version, journeys.definition_json AS definitionJson,
                journeys.recording_metadata_json AS recordingMetadataJson,
                journeys.created_at AS createdAt,
                journey_trace_links.trace_id AS traceId,
                recording_traces.checksum_sha256 AS traceChecksumSha256,
                recording_traces.size_bytes AS traceSizeBytes,
                journey_trace_links.manifest_json AS traceManifestJson
           FROM journeys
          LEFT JOIN journey_trace_links ON journey_trace_links.journey_id = journeys.id
          LEFT JOIN recording_traces ON recording_traces.id = journey_trace_links.trace_id
          WHERE journeys.id = ?
            AND journeys.recording_metadata_json IS NOT NULL`,
      )
      .get(journeyId) as JourneyRow | undefined;
    return row === undefined ? null : mapJourney(row);
  }

  createRecordingTrace(input: {
    readonly recordingSessionId: string;
    readonly manifest: HybridTraceManifest;
    readonly relativePath: string;
    readonly sizeBytes: number;
    readonly checksumSha256: string;
  }): RecordingTraceRecord {
    if (!this.traceStorageAvailable()) {
      throw new Error('Hybrid trace storage is not available.');
    }
    const record = {
      id: randomUUID(),
      recordingSessionId: input.recordingSessionId,
      manifest: hybridTraceManifestSchema.parse(input.manifest),
      relativePath: input.relativePath,
      sizeBytes: input.sizeBytes,
      checksumSha256: input.checksumSha256,
      createdAt: new Date().toISOString(),
    };
    this.database
      .prepare(
        `INSERT INTO recording_traces
          (id, recording_session_id, format_version, manifest_json,
           relative_path, size_bytes, checksum_sha256, created_at)
         VALUES (?, ?, 2, ?, ?, ?, ?, ?)`,
      )
      .run(
        record.id,
        record.recordingSessionId,
        JSON.stringify(record.manifest),
        record.relativePath,
        record.sizeBytes,
        record.checksumSha256,
        record.createdAt,
      );
    return record;
  }

  getRecordingTraceBySession(
    recordingSessionId: string | null,
  ): RecordingTraceRecord | null {
    if (recordingSessionId === null || !this.traceStorageAvailable()) {
      return null;
    }
    const row = this.database
      .prepare(
        `SELECT id, recording_session_id AS recordingSessionId,
                manifest_json AS manifestJson, relative_path AS relativePath,
                size_bytes AS sizeBytes, checksum_sha256 AS checksumSha256,
                created_at AS createdAt
           FROM recording_traces WHERE recording_session_id = ?`,
      )
      .get(recordingSessionId) as RecordingTraceRow | undefined;
    return row === undefined ? null : mapRecordingTrace(row);
  }

  getJourneyTraceManifest(journeyId: string): HybridTraceManifest | null {
    if (!this.traceStorageAvailable()) return null;
    const row = this.database
      .prepare(
        `SELECT manifest_json AS manifestJson
           FROM journey_trace_links WHERE journey_id = ?`,
      )
      .get(journeyId) as { readonly manifestJson: string } | undefined;
    return row === undefined
      ? null
      : hybridTraceManifestSchema.parse(JSON.parse(row.manifestJson));
  }

  getRecordingTraceByJourney(journeyId: string): RecordingTraceRecord | null {
    if (!this.traceStorageAvailable()) return null;
    const row = this.database
      .prepare(
        `SELECT recording_traces.id,
                recording_traces.recording_session_id AS recordingSessionId,
                recording_traces.manifest_json AS manifestJson,
                recording_traces.relative_path AS relativePath,
                recording_traces.size_bytes AS sizeBytes,
                recording_traces.checksum_sha256 AS checksumSha256,
                recording_traces.created_at AS createdAt
           FROM journey_trace_links
           JOIN recording_traces
             ON recording_traces.id = journey_trace_links.trace_id
          WHERE journey_trace_links.journey_id = ?`,
      )
      .get(journeyId) as RecordingTraceRow | undefined;
    return row === undefined ? null : mapRecordingTrace(row);
  }

  listTracePathsForProject(projectId: string): readonly string[] {
    if (!this.traceStorageAvailable()) return [];
    return (
      this.database
        .prepare(
          `SELECT recording_traces.relative_path AS relativePath
             FROM recording_traces
             JOIN recording_sessions
               ON recording_sessions.id = recording_traces.recording_session_id
            WHERE recording_sessions.project_id = ?`,
        )
        .all(projectId) as Array<{ readonly relativePath: string }>
    ).map((row) => row.relativePath);
  }

  private traceStorageAvailable(): boolean {
    return (
      this.database
        .prepare(
          `SELECT 1 FROM sqlite_master
            WHERE type = 'table' AND name = 'journey_trace_links'`,
        )
        .get() !== undefined
    );
  }
}

function mapJourney(row: JourneyRow): PersistedJourney {
  const manifest =
    row.traceManifestJson === null
      ? null
      : hybridTraceManifestSchema.parse(JSON.parse(row.traceManifestJson));
  const trace: JourneyTraceReference | null =
    manifest === null ||
    row.traceId === null ||
    row.traceChecksumSha256 === null ||
    row.traceSizeBytes === null
      ? null
      : journeyTraceReferenceSchema.parse({
          id: row.traceId,
          checksumSha256: row.traceChecksumSha256,
          sizeBytes: row.traceSizeBytes,
          ...traceSummary(manifest),
        });
  return persistedJourneySchema.parse({
    id: row.id,
    projectId: row.projectId,
    name: row.name,
    version: row.version,
    steps: JSON.parse(row.definitionJson) as unknown,
    recordingMetadata: JSON.parse(row.recordingMetadataJson) as unknown,
    createdAt: row.createdAt,
    replayFormat: trace === null ? 'semantic-v1' : 'hybrid-v2',
    trace,
  });
}

function mapRecordingTrace(row: RecordingTraceRow): RecordingTraceRecord {
  return {
    id: row.id,
    recordingSessionId: row.recordingSessionId,
    manifest: hybridTraceManifestSchema.parse(JSON.parse(row.manifestJson)),
    relativePath: row.relativePath,
    sizeBytes: row.sizeBytes,
    checksumSha256: row.checksumSha256,
    createdAt: row.createdAt,
  };
}

function traceSummary(manifest: HybridTraceManifest): TraceSummary {
  return traceSummarySchema.parse({
    interactionCount: manifest.interactions.length,
    eventCount: manifest.eventCount,
    pageCount: manifest.pageCount,
    frameCount: manifest.frameCount,
    videoCaptured: manifest.videoCaptured,
    truncated: manifest.truncated,
  });
}

function inferProjectEnvironment(targetUrl: string): ProjectEnvironment {
  const hostname = new URL(targetUrl).hostname;
  return ['localhost', '127.0.0.1', '::1'].includes(hostname)
    ? 'local'
    : 'production';
}

function deleteProjectActivity(
  database: Database.Database,
  projectId: string,
): void {
  const journeyIds = database
    .prepare('SELECT id FROM journeys WHERE project_id = ?')
    .all(projectId) as Array<{ readonly id: string }>;
  for (const { id } of journeyIds) deleteJourneyActivity(database, id);
  database
    .prepare('DELETE FROM auth_capture_sessions WHERE project_id = ?')
    .run(projectId);
  database
    .prepare(
      `DELETE FROM recording_traces
        WHERE recording_session_id IN (
          SELECT id FROM recording_sessions WHERE project_id = ?
        )`,
    )
    .run(projectId);
  database
    .prepare('DELETE FROM recording_sessions WHERE project_id = ?')
    .run(projectId);
  database.prepare('DELETE FROM journeys WHERE project_id = ?').run(projectId);
}

function deleteJourneyActivity(
  database: Database.Database,
  journeyId: string,
): void {
  database
    .prepare('DELETE FROM journey_trace_links WHERE journey_id = ?')
    .run(journeyId);
  database
    .prepare(
      `DELETE FROM external_outcome_check_results
        WHERE run_id IN (SELECT id FROM external_runs WHERE journey_id = ?)`,
    )
    .run(journeyId);
  database
    .prepare('DELETE FROM outcome_checks WHERE journey_id = ?')
    .run(journeyId);
  database
    .prepare('DELETE FROM critical_actions WHERE journey_id = ?')
    .run(journeyId);
  database
    .prepare(
      `DELETE FROM external_assertion_results
        WHERE run_id IN (SELECT id FROM external_runs WHERE journey_id = ?)`,
    )
    .run(journeyId);
  database
    .prepare(
      `DELETE FROM external_run_events
        WHERE run_id IN (SELECT id FROM external_runs WHERE journey_id = ?)`,
    )
    .run(journeyId);
  database
    .prepare(
      `DELETE FROM external_artifacts
        WHERE run_id IN (SELECT id FROM external_runs WHERE journey_id = ?)`,
    )
    .run(journeyId);
  database
    .prepare('DELETE FROM external_runs WHERE journey_id = ?')
    .run(journeyId);
  database
    .prepare(
      `DELETE FROM external_experiment_versions
        WHERE experiment_id IN (
          SELECT id FROM external_experiments WHERE journey_id = ?
        )`,
    )
    .run(journeyId);
  database
    .prepare('DELETE FROM external_experiments WHERE journey_id = ?')
    .run(journeyId);

  database
    .prepare(
      `DELETE FROM artifacts WHERE run_id IN (
        SELECT r.id FROM runs r
        JOIN experiment_versions ev ON ev.id = r.experiment_version_id
        JOIN experiments e ON e.id = ev.experiment_id
        WHERE e.journey_id = ?
      )`,
    )
    .run(journeyId);
  database
    .prepare(
      `DELETE FROM assertion_results WHERE run_id IN (
        SELECT r.id FROM runs r
        JOIN experiment_versions ev ON ev.id = r.experiment_version_id
        JOIN experiments e ON e.id = ev.experiment_id
        WHERE e.journey_id = ?
      )`,
    )
    .run(journeyId);
  database
    .prepare(
      `DELETE FROM run_events WHERE run_id IN (
        SELECT r.id FROM runs r
        JOIN experiment_versions ev ON ev.id = r.experiment_version_id
        JOIN experiments e ON e.id = ev.experiment_id
        WHERE e.journey_id = ?
      )`,
    )
    .run(journeyId);
  database
    .prepare(
      `DELETE FROM runs WHERE experiment_version_id IN (
        SELECT ev.id FROM experiment_versions ev
        JOIN experiments e ON e.id = ev.experiment_id
        WHERE e.journey_id = ?
      )`,
    )
    .run(journeyId);
  database
    .prepare(
      `DELETE FROM recovery_assertions WHERE experiment_version_id IN (
        SELECT ev.id FROM experiment_versions ev
        JOIN experiments e ON e.id = ev.experiment_id
        WHERE e.journey_id = ?
      )`,
    )
    .run(journeyId);
  database
    .prepare(
      `DELETE FROM experiment_versions WHERE experiment_id IN (
        SELECT id FROM experiments WHERE journey_id = ?
      )`,
    )
    .run(journeyId);
  database
    .prepare('DELETE FROM experiments WHERE journey_id = ?')
    .run(journeyId);
}
