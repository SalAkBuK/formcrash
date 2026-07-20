import { randomUUID } from 'node:crypto';

import {
  authCaptureSessionSchema,
  httpHookSchema,
  runtimeVariableDeclarationInputSchema,
  type AuthCaptureSession,
  type AuthCaptureStatus,
  type HttpHook,
  type ProjectExecutionSettingsInput,
  type RuntimeVariableDeclarationInput,
} from '@formcrash/contracts';
import type Database from 'better-sqlite3';

export interface StoredProjectSettings {
  readonly projectId: string;
  readonly variables: readonly RuntimeVariableDeclarationInput[];
  readonly beforeRunHook: HttpHook | null;
  readonly afterRunHook: HttpHook | null;
  readonly updatedAt: string;
}

export interface StoredAuthSession {
  readonly projectId: string;
  readonly relativePath: string;
  readonly capturedAt: string;
  readonly updatedAt: string;
}

export interface StoredAuthAccess {
  readonly projectId: string;
  readonly requirement:
    'unknown' | 'not_required' | 'user_confirmed_public' | 'required';
  readonly verification:
    'not_checked' | 'valid' | 'expired' | 'failed' | 'inconclusive';
  readonly lastCheckedAt: string | null;
  readonly updatedAt: string;
}

interface SettingsRow {
  readonly projectId: string;
  readonly variablesJson: string;
  readonly beforeHookJson: string | null;
  readonly afterHookJson: string | null;
  readonly updatedAt: string;
}

interface AuthRow {
  readonly projectId: string;
  readonly relativePath: string;
  readonly capturedAt: string;
  readonly updatedAt: string;
}

interface CaptureRow {
  readonly id: string;
  readonly projectId: string;
  readonly status: string;
  readonly errorMessage: string | null;
  readonly startedAt: string;
  readonly completedAt: string | null;
}

interface AuthAccessRow {
  readonly projectId: string;
  readonly requirement: StoredAuthAccess['requirement'];
  readonly verification: StoredAuthAccess['verification'];
  readonly lastCheckedAt: string | null;
  readonly updatedAt: string;
}

export class ProjectSettingsRepository {
  constructor(private readonly database: Database.Database) {}

  get(projectId: string): StoredProjectSettings {
    const row = this.database
      .prepare(
        `SELECT project_id AS projectId, variables_json AS variablesJson,
                before_hook_json AS beforeHookJson,
                after_hook_json AS afterHookJson, updated_at AS updatedAt
           FROM project_execution_settings WHERE project_id = ?`,
      )
      .get(projectId) as SettingsRow | undefined;
    if (row === undefined) {
      return {
        projectId,
        variables: [],
        beforeRunHook: null,
        afterRunHook: null,
        updatedAt: new Date(0).toISOString(),
      };
    }
    return {
      projectId: row.projectId,
      variables: runtimeVariableDeclarationInputSchema
        .array()
        .parse(JSON.parse(row.variablesJson)),
      beforeRunHook:
        row.beforeHookJson === null
          ? null
          : httpHookSchema.parse(JSON.parse(row.beforeHookJson)),
      afterRunHook:
        row.afterHookJson === null
          ? null
          : httpHookSchema.parse(JSON.parse(row.afterHookJson)),
      updatedAt: row.updatedAt,
    };
  }

  save(
    projectId: string,
    input: ProjectExecutionSettingsInput,
  ): StoredProjectSettings {
    const now = new Date().toISOString();
    this.database
      .prepare(
        `INSERT INTO project_execution_settings
          (project_id, variables_json, before_hook_json, after_hook_json, updated_at)
         VALUES (?, ?, ?, ?, ?)
         ON CONFLICT(project_id) DO UPDATE SET
           variables_json = excluded.variables_json,
           before_hook_json = excluded.before_hook_json,
           after_hook_json = excluded.after_hook_json,
           updated_at = excluded.updated_at`,
      )
      .run(
        projectId,
        JSON.stringify(input.variables),
        input.beforeRunHook === null
          ? null
          : JSON.stringify(input.beforeRunHook),
        input.afterRunHook === null ? null : JSON.stringify(input.afterRunHook),
        now,
      );
    return this.get(projectId);
  }

  getAuthSession(projectId: string): StoredAuthSession | null {
    const row = this.database
      .prepare(
        `SELECT project_id AS projectId, relative_path AS relativePath,
                captured_at AS capturedAt, updated_at AS updatedAt
           FROM project_auth_sessions WHERE project_id = ?`,
      )
      .get(projectId) as AuthRow | undefined;
    return row ?? null;
  }

  saveAuthSession(input: StoredAuthSession): void {
    this.database
      .prepare(
        `INSERT INTO project_auth_sessions
          (project_id, relative_path, captured_at, updated_at)
         VALUES (?, ?, ?, ?)
         ON CONFLICT(project_id) DO UPDATE SET
           relative_path = excluded.relative_path,
           captured_at = excluded.captured_at,
           updated_at = excluded.updated_at`,
      )
      .run(
        input.projectId,
        input.relativePath,
        input.capturedAt,
        input.updatedAt,
      );
  }

  clearAuthSession(projectId: string): void {
    this.database
      .prepare('DELETE FROM project_auth_sessions WHERE project_id = ?')
      .run(projectId);
  }

  getAuthAccess(projectId: string): StoredAuthAccess {
    const row = this.database
      .prepare(
        `SELECT project_id AS projectId, requirement, verification,
                last_checked_at AS lastCheckedAt, updated_at AS updatedAt
           FROM project_auth_access WHERE project_id = ?`,
      )
      .get(projectId) as AuthAccessRow | undefined;
    return (
      row ?? {
        projectId,
        requirement: 'unknown',
        verification: 'not_checked',
        lastCheckedAt: null,
        updatedAt: new Date(0).toISOString(),
      }
    );
  }

  saveAuthAccess(input: Omit<StoredAuthAccess, 'updatedAt'>): StoredAuthAccess {
    const now = new Date().toISOString();
    this.database
      .prepare(
        `INSERT INTO project_auth_access
          (project_id, requirement, verification, last_checked_at, updated_at)
         VALUES (?, ?, ?, ?, ?)
         ON CONFLICT(project_id) DO UPDATE SET
           requirement = excluded.requirement,
           verification = excluded.verification,
           last_checked_at = excluded.last_checked_at,
           updated_at = excluded.updated_at`,
      )
      .run(
        input.projectId,
        input.requirement,
        input.verification,
        input.lastCheckedAt,
        now,
      );
    return this.getAuthAccess(input.projectId);
  }

  createAuthCapture(projectId: string): AuthCaptureSession {
    const session = authCaptureSessionSchema.parse({
      id: randomUUID(),
      projectId,
      status: 'created',
      errorMessage: null,
      startedAt: new Date().toISOString(),
      completedAt: null,
    });
    this.database
      .prepare(
        `INSERT INTO auth_capture_sessions
          (id, project_id, status, error_message, started_at, completed_at)
         VALUES (?, ?, ?, ?, ?, ?)`,
      )
      .run(
        session.id,
        session.projectId,
        session.status,
        null,
        session.startedAt,
        null,
      );
    return session;
  }

  updateAuthCapture(input: {
    readonly id: string;
    readonly status: AuthCaptureStatus;
    readonly errorMessage?: string | null;
    readonly completedAt?: string | null;
  }): AuthCaptureSession {
    const current = this.getAuthCapture(input.id);
    if (current === null)
      throw new Error('Authentication capture was not found.');
    this.database
      .prepare(
        `UPDATE auth_capture_sessions
            SET status = ?, error_message = ?, completed_at = ?
          WHERE id = ?`,
      )
      .run(
        input.status,
        input.errorMessage === undefined
          ? current.errorMessage
          : input.errorMessage,
        input.completedAt === undefined
          ? current.completedAt
          : input.completedAt,
        input.id,
      );
    const updated = this.getAuthCapture(input.id);
    if (updated === null)
      throw new Error('Authentication capture update was lost.');
    return updated;
  }

  getAuthCapture(id: string): AuthCaptureSession | null {
    const row = this.database
      .prepare(
        `SELECT id, project_id AS projectId, status,
                error_message AS errorMessage, started_at AS startedAt,
                completed_at AS completedAt
           FROM auth_capture_sessions WHERE id = ?`,
      )
      .get(id) as CaptureRow | undefined;
    return row === undefined ? null : authCaptureSessionSchema.parse(row);
  }
}
