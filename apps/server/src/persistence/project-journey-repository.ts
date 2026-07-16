import { randomUUID } from 'node:crypto';

import {
  journeyListSchema,
  journeyRecordingMetadataSchema,
  persistedJourneySchema,
  projectListSchema,
  projectSchema,
  recordedJourneyStepSchema,
  recordingSessionSchema,
  recordingWarningSchema,
  type CreateProjectRequest,
  type JourneyRecordingMetadata,
  type PersistedJourney,
  type Project,
  type ProjectEnvironment,
  type RecordedJourneyStep,
  type RecordingSession,
  type RecordingSessionStatus,
  type RecordingWarning,
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
}

interface RecordingRow {
  readonly id: string;
  readonly projectId: string;
  readonly status: string;
  readonly stepsJson: string;
  readonly warningsJson: string;
  readonly errorMessage: string | null;
  readonly startedAt: string;
  readonly completedAt: string | null;
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
      startedAt: new Date().toISOString(),
      completedAt: null,
    });
    this.database
      .prepare(
        `INSERT INTO recording_sessions
          (id, project_id, status, steps_json, warnings_json, error_message,
           started_at, completed_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
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
      );
    return session;
  }

  updateRecordingSession(input: {
    readonly id: string;
    readonly status: RecordingSessionStatus;
    readonly steps?: readonly RecordedJourneyStep[];
    readonly warnings?: readonly RecordingWarning[];
    readonly errorMessage?: string | null;
    readonly completedAt?: string | null;
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
                error_message = ?, completed_at = ?
          WHERE id = ?`,
      )
      .run(
        input.status,
        JSON.stringify(steps),
        JSON.stringify(warnings),
        input.errorMessage === undefined
          ? current.errorMessage
          : input.errorMessage,
        input.completedAt === undefined
          ? current.completedAt
          : input.completedAt,
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
                started_at AS startedAt, completed_at AS completedAt
           FROM recording_sessions WHERE id = ?`,
      )
      .get(sessionId) as RecordingRow | undefined;
    if (row === undefined) return null;
    return recordingSessionSchema.parse({
      ...row,
      steps: JSON.parse(row.stepsJson) as unknown,
      warnings: JSON.parse(row.warningsJson) as unknown,
    });
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
      this.database
        .prepare('UPDATE projects SET updated_at = ? WHERE id = ?')
        .run(createdAt, input.projectId);
      return journey;
    });
    return save();
  }

  listJourneys(projectId: string): readonly PersistedJourney[] {
    const rows = this.database
      .prepare(
        `SELECT id, project_id AS projectId, name, version,
                definition_json AS definitionJson,
                recording_metadata_json AS recordingMetadataJson,
                created_at AS createdAt
           FROM journeys
          WHERE project_id = ? AND recording_metadata_json IS NOT NULL
          ORDER BY created_at DESC, id DESC`,
      )
      .all(projectId) as JourneyRow[];
    return journeyListSchema.parse({ items: rows.map(mapJourney) }).items;
  }

  getJourney(journeyId: string): PersistedJourney | null {
    const row = this.database
      .prepare(
        `SELECT id, project_id AS projectId, name, version,
                definition_json AS definitionJson,
                recording_metadata_json AS recordingMetadataJson,
                created_at AS createdAt
           FROM journeys
          WHERE id = ? AND recording_metadata_json IS NOT NULL`,
      )
      .get(journeyId) as JourneyRow | undefined;
    return row === undefined ? null : mapJourney(row);
  }
}

function mapJourney(row: JourneyRow): PersistedJourney {
  return persistedJourneySchema.parse({
    id: row.id,
    projectId: row.projectId,
    name: row.name,
    version: row.version,
    steps: JSON.parse(row.definitionJson) as unknown,
    recordingMetadata: JSON.parse(row.recordingMetadataJson) as unknown,
    createdAt: row.createdAt,
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
    .prepare('DELETE FROM recording_sessions WHERE project_id = ?')
    .run(projectId);
  database.prepare('DELETE FROM journeys WHERE project_id = ?').run(projectId);
}

function deleteJourneyActivity(
  database: Database.Database,
  journeyId: string,
): void {
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
