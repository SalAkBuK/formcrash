import { afterEach, describe, expect, it } from 'vitest';
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';

import { FormCrashDatabase } from '../src/persistence/database.js';
import { initializePersistence } from '../src/persistence/initialize.js';
import {
  RunPersistenceError,
  RunRepository,
} from '../src/persistence/run-repository.js';
import { seedSampleDefinitions } from '../src/persistence/sample-seed.js';
import { createTemporaryTestConfig } from './fixtures.js';

const cleanups: Array<() => void> = [];

afterEach(() => {
  for (const cleanup of cleanups.splice(0)) cleanup();
});

describe('SQLite migrations and seeded definitions', () => {
  it('initializes an empty database and safely reapplies migrations', () => {
    const temporary = createTemporaryTestConfig();
    cleanups.push(temporary.cleanup);
    const database = new FormCrashDatabase(temporary.config.databasePath);

    const first = database.migrate();
    const second = database.migrate();

    expect(first.map((migration) => migration.version)).toEqual([
      '0001_priority_zero.sql',
      '0002_external_journeys.sql',
      '0003_external_experiments.sql',
      '0004_project_safety_and_cleanup.sql',
      '0005_request_selection_provenance.sql',
      '0006_assertion_selection_provenance.sql',
      '0007_outcome_checks.sql',
      '0008_outcome_check_hardening.sql',
      '0009_outcome_check_execution.sql',
      '0010_hybrid_journey_traces.sql',
      '0011_project_auth_access.sql',
      '0012_user_confirmed_auth_access.sql',
      '0013_production_replay_acknowledgement.sql',
      '0014_external_version_outcome_snapshots.sql',
      '0015_network_evidence_provenance.sql',
      '0016_deduplicate_outcome_assertions.sql',
      '0017_restore_outcome_snapshot_nulls.sql',
    ]);
    expect(second).toEqual(first);
    expect(database.connection.pragma('foreign_keys', { simple: true })).toBe(
      1,
    );
    database.close();
  });

  it('seeds one project, journey, version, and assertion idempotently', () => {
    const temporary = createTemporaryTestConfig();
    cleanups.push(temporary.cleanup);
    const database = new FormCrashDatabase(temporary.config.databasePath);
    database.migrate();

    seedSampleDefinitions(database.connection, 'http://localhost:4200');
    seedSampleDefinitions(database.connection, 'http://localhost:4200');

    expect(count(database, 'projects')).toBe(1);
    expect(count(database, 'journeys')).toBe(1);
    expect(count(database, 'experiments')).toBe(1);
    expect(count(database, 'experiment_versions')).toBe(1);
    expect(count(database, 'recovery_assertions')).toBe(1);
    const definition = new RunRepository(
      database.connection,
    ).loadSeededExperiment();
    expect(definition.experiment).toMatchObject({
      triggerCount: 2,
      intervalMs: 100,
      targetStep: 'submit-order',
    });
    expect(definition.assertions).toHaveLength(1);
    database.close();
  });

  it('rolls back a failed migration and refuses initialization', () => {
    const temporary = createTemporaryTestConfig();
    cleanups.push(temporary.cleanup);
    const directory = path.join(temporary.root, 'bad-migrations');
    mkdirSync(directory, { recursive: true });
    writeFileSync(
      path.join(directory, '0001_broken.sql'),
      'CREATE TABLE partial_table (id TEXT PRIMARY KEY) STRICT; INSERT INTO missing_table VALUES (1);',
    );
    const database = new FormCrashDatabase(temporary.config.databasePath);

    expect(() => database.migrate(directory)).toThrow();
    expect(
      database.connection
        .prepare(
          "SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'partial_table'",
        )
        .get(),
    ).toBeUndefined();
    database.close();
  });

  it('rejects an applied migration whose committed contents changed', () => {
    const temporary = createTemporaryTestConfig();
    cleanups.push(temporary.cleanup);
    const directory = path.join(temporary.root, 'checked-migrations');
    const migrationPath = path.join(directory, '0001_checked.sql');
    mkdirSync(directory, { recursive: true });
    writeFileSync(
      migrationPath,
      'CREATE TABLE checked_table (id TEXT PRIMARY KEY) STRICT;',
    );
    const database = new FormCrashDatabase(temporary.config.databasePath);
    database.migrate(directory);

    writeFileSync(
      migrationPath,
      'CREATE TABLE changed_table (id TEXT PRIMARY KEY) STRICT;',
    );

    expect(() => database.migrate(directory)).toThrow(
      'changed after it was applied',
    );
    database.close();
  });

  it('treats LF and CRLF migration files as the same committed contents', () => {
    const temporary = createTemporaryTestConfig();
    cleanups.push(temporary.cleanup);
    const directory = path.join(temporary.root, 'line-ending-migrations');
    const migrationPath = path.join(directory, '0001_line_endings.sql');
    mkdirSync(directory, { recursive: true });
    writeFileSync(
      migrationPath,
      'CREATE TABLE line_endings (\n  id TEXT PRIMARY KEY\n) STRICT;\n',
    );
    const database = new FormCrashDatabase(temporary.config.databasePath);
    const first = database.migrate(directory);

    writeFileSync(
      migrationPath,
      'CREATE TABLE line_endings (\r\n  id TEXT PRIMARY KEY\r\n) STRICT;\r\n',
    );

    expect(database.migrate(directory)).toEqual(first);
    expect(
      database.connection
        .prepare(
          `SELECT checksum_sha256 AS checksumSha256,
                  applied_at AS appliedAt
             FROM schema_migrations
            WHERE version = ?`,
        )
        .get('0001_line_endings.sql'),
    ).toEqual({
      checksumSha256: first[0]?.checksumSha256,
      appliedAt: first[0]?.appliedAt,
    });
    database.close();
  });

  it('does not normalize meaningful whitespace or trailing newlines', () => {
    const temporary = createTemporaryTestConfig();
    cleanups.push(temporary.cleanup);
    const directory = path.join(temporary.root, 'strict-content-migrations');
    const migrationPath = path.join(directory, '0001_strict_content.sql');
    mkdirSync(directory, { recursive: true });
    writeFileSync(
      migrationPath,
      'CREATE TABLE strict_content (id TEXT PRIMARY KEY) STRICT;\n',
    );
    const database = new FormCrashDatabase(temporary.config.databasePath);
    database.migrate(directory);

    writeFileSync(
      migrationPath,
      'CREATE TABLE strict_content (id  TEXT PRIMARY KEY) STRICT;\n',
    );
    expect(() => database.migrate(directory)).toThrow(
      'changed after it was applied',
    );

    writeFileSync(
      migrationPath,
      'CREATE TABLE strict_content (id TEXT PRIMARY KEY) STRICT;\n\n',
    );
    expect(() => database.migrate(directory)).toThrow(
      'changed after it was applied',
    );
    database.close();
  });
});

describe('durable run integrity', () => {
  it('enforces append-only ordered events and immutable snapshots', () => {
    const temporary = createTemporaryTestConfig();
    cleanups.push(temporary.cleanup);
    const database = initializePersistence(temporary.config);
    const repository = new RunRepository(database.connection);
    createRun(repository, 'run-integrity');

    repository.appendEvent(event('run-integrity', 1, 'run.created'));
    repository.appendEvent(event('run-integrity', 2, 'run.starting'));
    expect(() =>
      repository.appendEvent({
        ...event('run-integrity', 2, 'duplicate'),
        eventId: 'duplicate-event-id',
      }),
    ).toThrow(RunPersistenceError);
    expect(() =>
      repository.appendEvent(event('run-integrity', 4, 'out-of-order')),
    ).toThrow(RunPersistenceError);
    expect(() =>
      database.connection
        .prepare(
          "UPDATE run_events SET event_type = 'changed' WHERE run_id = ?",
        )
        .run('run-integrity'),
    ).toThrow('run events are append-only');
    expect(() =>
      database.connection
        .prepare('UPDATE runs SET target_url = ? WHERE id = ?')
        .run('http://changed.invalid', 'run-integrity'),
    ).toThrow('run snapshots are immutable');
    expect(() =>
      database.connection
        .prepare(
          'UPDATE experiment_versions SET configuration_json = ? WHERE id = ?',
        )
        .run('{}', 'experiment-version-impatient-user-v1'),
    ).toThrow('experiment versions are immutable');

    expect(
      repository.getRun('run-integrity')?.events.map((item) => item.sequence),
    ).toEqual([1, 2]);
    database.close();
  });

  it('reloads passed, failed, and runner-error runs after restart', () => {
    const temporary = createTemporaryTestConfig();
    cleanups.push(temporary.cleanup);
    let database = initializePersistence(temporary.config);
    let repository = new RunRepository(database.connection);

    finalize(repository, 'run-passed', 'passed', 1);
    finalize(repository, 'run-failed', 'failed', 2);
    finalize(repository, 'run-error', 'runner_error', null);
    const snapshotBefore = database.connection
      .prepare('SELECT journey_snapshot_json AS value FROM runs WHERE id = ?')
      .get('run-passed') as { value: string };
    database.close();

    database = initializePersistence(temporary.config);
    repository = new RunRepository(database.connection);
    expect(repository.getRun('run-passed')).toMatchObject({
      status: 'passed',
      assertions: [{ status: 'passed', observedCount: 1 }],
    });
    expect(repository.getRun('run-failed')).toMatchObject({
      status: 'failed',
      assertions: [{ status: 'failed', observedCount: 2 }],
    });
    expect(repository.getRun('run-error')).toMatchObject({
      status: 'runner_error',
      assertions: [{ status: 'not_evaluated', observedCount: null }],
      runnerError: { code: 'runner_failure' },
    });
    const snapshotAfter = database.connection
      .prepare('SELECT journey_snapshot_json AS value FROM runs WHERE id = ?')
      .get('run-passed') as { value: string };
    expect(snapshotAfter.value).toBe(snapshotBefore.value);
    expect(
      database.connection
        .prepare(
          `SELECT typeof(journey_snapshot_json) AS journeyType,
                  typeof(observed_json) AS observedType
             FROM runs WHERE id = ?`,
        )
        .get('run-passed'),
    ).toEqual({ journeyType: 'text', observedType: 'text' });
    database.close();
  });
});

function count(database: FormCrashDatabase, table: string): number {
  const allowed = [
    'projects',
    'journeys',
    'experiments',
    'experiment_versions',
    'recovery_assertions',
  ];
  if (!allowed.includes(table)) throw new Error('Unexpected test table.');
  return (
    database.connection
      .prepare(`SELECT COUNT(*) AS count FROM ${table}`)
      .get() as {
      count: number;
    }
  ).count;
}

function createRun(repository: RunRepository, runId: string): void {
  const definition = repository.loadSeededExperiment();
  repository.createRun({
    runId,
    experimentVersionId: definition.experimentVersionId,
    mode: 'fixed',
    startedAt: '2026-07-15T00:00:00.000Z',
    targetUrl: 'http://localhost:4200',
    journey: definition.journey,
    experiment: definition.experiment,
    assertions: definition.assertions,
  });
}

function finalize(
  repository: RunRepository,
  runId: string,
  status: 'passed' | 'failed' | 'runner_error',
  observedCount: number | null,
): void {
  createRun(repository, runId);
  repository.appendEvent(event(runId, 1, 'run.created'));
  const definition = repository.loadSeededExperiment();
  repository.finalizeRun({
    runId,
    status,
    completedAt: '2026-07-15T00:00:01.000Z',
    durationMs: 1_000,
    observed:
      observedCount === null
        ? null
        : {
            browserOrderRequestCount: observedCount,
            requestAttemptCount: observedCount,
            acceptedCount: observedCount,
            deduplicatedCount: 0,
            rejectedCount: 0,
            createdOrderCount: observedCount,
            orderIds: Array.from(
              { length: observedCount },
              (_, index) => `order-${index + 1}`,
            ),
            requests: [],
          },
    runnerError:
      status === 'runner_error'
        ? {
            code: 'runner_failure',
            message: 'Synthetic runner failure.',
            failedStep: null,
          }
        : null,
    evidenceWarnings: [],
    assertionId: definition.assertionId,
    assertion: {
      assertionType: 'max_created_orders',
      expectedMaximum: 1,
      observedCount,
      status:
        status === 'runner_error'
          ? 'not_evaluated'
          : status === 'failed'
            ? 'failed'
            : 'passed',
      expectedDescription: 'No more than one order should be created.',
      observedDescription:
        observedCount === null
          ? 'The application state could not be evaluated.'
          : `${observedCount} order${observedCount === 1 ? '' : 's'} were created.`,
    },
  });
}

function event(runId: string, sequence: number, eventType: string) {
  return {
    eventId: `${runId}-event-${sequence}`,
    runId,
    eventType,
    sequence,
    relativeTimestampMs: sequence,
    recordedAt: '2026-07-15T00:00:00.000Z',
    schemaVersion: 1 as const,
    payload: {},
  };
}
