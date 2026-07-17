import { copyFileSync, mkdirSync } from 'node:fs';
import path from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { initializePersistence } from '../src/persistence/initialize.js';
import { ExternalExperimentRepository } from '../src/persistence/external-experiment-repository.js';
import { OutcomeCheckRepository } from '../src/persistence/outcome-check-repository.js';
import { ProjectJourneyRepository } from '../src/persistence/project-journey-repository.js';
import { FormCrashDatabase } from '../src/persistence/database.js';
import { createTemporaryTestConfig } from './fixtures.js';

const cleanups: Array<() => void> = [];

afterEach(() => {
  for (const cleanup of cleanups.splice(0)) cleanup();
});

describe('Outcome Check run persistence', () => {
  it('keeps snapshots and finalized results immutable across removal and restart', () => {
    const temporary = createTemporaryTestConfig();
    cleanups.push(temporary.cleanup);
    let database: FormCrashDatabase = initializePersistence(temporary.config);
    let experiments = new ExternalExperimentRepository(database.connection);
    const projects = new ProjectJourneyRepository(database.connection);
    const outcomes = new OutcomeCheckRepository(database.connection);
    const project = projects.createProject({
      name: 'Outcome persistence',
      targetUrl: 'http://127.0.0.1:49999/profiles',
      description: 'Persistence fixture',
    });
    const journey = projects.saveJourney({
      projectId: project.id,
      name: 'Create profile v1',
      steps: [
        {
          id: 'save-profile',
          name: 'Save profile',
          type: 'submit',
          timestamp: 0,
          url: project.targetUrl,
          locator: { strategy: 'data-testid', value: 'profile-form' },
          fingerprint: null,
          value: null,
          sensitive: false,
        },
      ],
      metadata: {
        recordingSessionId: null,
        recordedAt: '2026-07-17T00:00:00.000Z',
        warningCount: 0,
        normalizationRule: 'test',
      },
    });
    const action = outcomes.approveCriticalAction(journey, {
      stepId: 'save-profile',
      label: 'Save profile',
    });
    const check = outcomes.saveOutcomeCheck({
      journeyId: journey.id,
      criticalActionId: action.id,
      type: 'matching_item_appears_exactly_once',
      description: 'Exactly one original profile should appear.',
      target: outcomeTarget(),
      binding: generatedEmailBinding(),
    });
    const version = experiments.createVersion({
      projectId: project.id,
      journey,
      request: {
        name: 'Double save',
        targetStepId: 'save-profile',
        triggerCount: 2,
        intervalMs: 0,
        networkMatcher: null,
        assertions: [
          {
            id: 'complete',
            type: 'text_appeared',
            text: 'Complete',
            description: 'Completion appears.',
          },
        ],
        continueAfterTarget: false,
        requestSelectionProvenance: null,
      },
    });
    experiments.createRun({
      runId: 'outcome-run',
      experiment: version,
      targetUrl: project.targetUrl,
      projectName: project.name,
      journeyName: journey.name,
      safeResolvedValues: {},
      outcomeCheckSnapshot: { criticalAction: action, checks: [check] },
      startedAt: '2026-07-17T00:00:00.000Z',
    });
    experiments.finalizeRun({
      runId: 'outcome-run',
      status: 'passed',
      completedAt: '2026-07-17T00:00:01.000Z',
      durationMs: 1_000,
      triggerAttempts: 2,
      networkObservations: [],
      runnerError: null,
      warnings: [],
      assertions: [],
      assertionAggregate: 'not_configured',
      outcomeAggregate: 'passed',
      outcomeCheckResults: [
        {
          outcomeCheckResultId: 'outcome-result',
          runId: 'outcome-run',
          outcomeCheckId: check.id,
          journeyId: journey.id,
          criticalActionId: action.id,
          type: check.type,
          expected: {
            visibleMatchCount: 1,
            template: '{{unique.email}}',
          },
          observed: {
            visibleMatchCount: 1,
            description: 'One visible item matched the approved identity.',
          },
          expectedCount: 1,
          observedCount: 1,
          status: 'passed',
          reason: null,
          evidenceReferences: {
            triggerEventIds: [],
            requestObservationIds: [],
            screenshotArtifactIds: [],
            runnerEventIds: [],
          },
          templateBinding: generatedEmailBinding(),
          unknowns: ['Database state was not inspected.'],
          evaluatedAt: '2026-07-17T00:00:00.900Z',
        },
      ],
    });

    expect(outcomes.deleteOutcomeCheck(journey.id, check.id)).toBe('deleted');
    const replacement = outcomes.saveOutcomeCheck({
      journeyId: journey.id,
      criticalActionId: action.id,
      type: 'matching_item_appears_exactly_once',
      description: 'Replacement description must not alter history.',
      target: outcomeTarget(),
      binding: generatedEmailBinding(),
    });
    expect(experiments.getRun('outcome-run')).toMatchObject({
      lifecycleStatus: 'completed',
      outcomeAggregate: 'passed',
      outcomeCheckSnapshot: {
        criticalAction: { id: action.id, journeyId: journey.id },
        checks: [
          {
            id: check.id,
            journeyId: journey.id,
            description: 'Exactly one original profile should appear.',
            binding: { template: '{{unique.email}}' },
          },
        ],
      },
      outcomeCheckResults: [
        {
          outcomeCheckResultId: 'outcome-result',
          status: 'passed',
          expected: { visibleMatchCount: 1, template: '{{unique.email}}' },
          observed: { visibleMatchCount: 1 },
          templateBinding: { template: '{{unique.email}}' },
        },
      ],
    });
    expect(replacement.id).not.toBe(check.id);
    experiments.createRun({
      runId: 'dangling-evidence-run',
      experiment: version,
      targetUrl: project.targetUrl,
      projectName: project.name,
      journeyName: journey.name,
      safeResolvedValues: {},
      outcomeCheckSnapshot: { criticalAction: action, checks: [replacement] },
      startedAt: '2026-07-17T00:00:02.000Z',
    });
    expect(() =>
      experiments.finalizeRun({
        runId: 'dangling-evidence-run',
        status: 'passed',
        completedAt: '2026-07-17T00:00:03.000Z',
        durationMs: 1_000,
        triggerAttempts: 2,
        networkObservations: [],
        runnerError: null,
        warnings: [],
        assertions: [],
        outcomeAggregate: 'passed',
        assertionAggregate: 'not_configured',
        outcomeCheckResults: [
          {
            outcomeCheckResultId: 'dangling-result',
            runId: 'dangling-evidence-run',
            outcomeCheckId: replacement.id,
            journeyId: journey.id,
            criticalActionId: action.id,
            type: replacement.type,
            expected: { visibleMatchCount: 1 },
            observed: { visibleMatchCount: 1 },
            expectedCount: 1,
            observedCount: 1,
            status: 'passed',
            reason: null,
            evidenceReferences: {
              triggerEventIds: ['event-that-does-not-exist'],
              requestObservationIds: [],
              screenshotArtifactIds: [],
              runnerEventIds: [],
            },
            templateBinding: generatedEmailBinding(),
            unknowns: ['Database state was not inspected.'],
            evaluatedAt: '2026-07-17T00:00:02.900Z',
          },
        ],
      }),
    ).toThrow('SQLite could not finalize an external run.');
    expect(experiments.getRun('dangling-evidence-run')).toMatchObject({
      lifecycleStatus: 'created',
      outcomeCheckResults: [],
    });
    expect(() =>
      database.connection
        .prepare(
          "UPDATE external_outcome_check_results SET status = 'failed' WHERE id = ?",
        )
        .run('outcome-result'),
    ).toThrow('external outcome check results are immutable');
    expect(() =>
      database.connection
        .prepare(
          'UPDATE external_runs SET outcome_checks_snapshot_json = ? WHERE id = ?',
        )
        .run('{"criticalAction":null,"checks":[]}', 'outcome-run'),
    ).toThrow('external outcome check snapshots are immutable');

    database.close();
    database = initializePersistence(temporary.config);
    experiments = new ExternalExperimentRepository(database.connection);
    expect(experiments.getRun('outcome-run')).toMatchObject({
      outcomeAggregate: 'passed',
      outcomeCheckSnapshot: {
        checks: [
          {
            id: check.id,
            description: 'Exactly one original profile should appear.',
            binding: { template: '{{unique.email}}' },
          },
        ],
      },
      outcomeCheckResults: [
        {
          outcomeCheckResultId: 'outcome-result',
          expected: { visibleMatchCount: 1, template: '{{unique.email}}' },
          observed: { visibleMatchCount: 1 },
          templateBinding: { template: '{{unique.email}}' },
        },
      ],
    });
    database.close();
  });

  it('keeps runs without Outcome Checks readable', () => {
    const temporary = createTemporaryTestConfig();
    cleanups.push(temporary.cleanup);
    const database = initializePersistence(temporary.config);
    const experiments = new ExternalExperimentRepository(database.connection);
    const projects = new ProjectJourneyRepository(database.connection);
    const project = projects.createProject({
      name: 'Legacy-compatible outcome run',
      targetUrl: 'http://127.0.0.1:49999/',
      description: 'No outcomes',
    });
    const journey = projects.saveJourney({
      projectId: project.id,
      name: 'Legacy journey',
      steps: [
        {
          id: 'submit',
          name: 'Submit',
          type: 'submit',
          timestamp: 0,
          url: project.targetUrl,
          locator: { strategy: 'id', value: 'form' },
          fingerprint: null,
          value: null,
          sensitive: false,
        },
      ],
      metadata: {
        recordingSessionId: null,
        recordedAt: '2026-07-17T00:00:00.000Z',
        warningCount: 0,
        normalizationRule: 'test',
      },
    });
    const version = experiments.createVersion({
      projectId: project.id,
      journey,
      request: {
        name: 'Legacy experiment',
        targetStepId: 'submit',
        triggerCount: 2,
        intervalMs: 0,
        networkMatcher: null,
        assertions: [
          {
            id: 'complete',
            type: 'text_appeared',
            text: 'Complete',
            description: 'Complete',
          },
        ],
        continueAfterTarget: false,
        requestSelectionProvenance: null,
      },
    });
    experiments.createRun({
      runId: 'legacy-run',
      experiment: version,
      targetUrl: project.targetUrl,
      projectName: project.name,
      journeyName: journey.name,
      safeResolvedValues: {},
      startedAt: '2026-07-17T00:00:00.000Z',
    });
    expect(experiments.getRun('legacy-run')).toMatchObject({
      outcomeAggregate: 'not_configured',
      outcomeCheckSnapshot: { criticalAction: null, checks: [] },
      outcomeCheckResults: [],
      presentation: {
        primaryStatus: 'not_configured',
        headline:
          'This run has technical evidence, but no approved Outcome Check was configured.',
        checks: [],
      },
    });
    database.close();
  });

  it('migrates a pre-Outcome-Check run without fabricating outcome evidence', () => {
    const temporary = createTemporaryTestConfig();
    cleanups.push(temporary.cleanup);
    const legacyMigrationDirectory = path.join(
      temporary.root,
      'legacy-migrations',
    );
    mkdirSync(legacyMigrationDirectory, { recursive: true });
    const sourceMigrationDirectory = path.resolve(
      import.meta.dirname,
      '../migrations',
    );
    for (const migration of [
      '0001_priority_zero.sql',
      '0002_external_journeys.sql',
      '0003_external_experiments.sql',
      '0004_project_safety_and_cleanup.sql',
      '0005_request_selection_provenance.sql',
      '0006_assertion_selection_provenance.sql',
      '0007_outcome_checks.sql',
      '0008_outcome_check_hardening.sql',
    ]) {
      copyFileSync(
        path.join(sourceMigrationDirectory, migration),
        path.join(legacyMigrationDirectory, migration),
      );
    }

    const database = new FormCrashDatabase(temporary.config.databasePath);
    database.migrate(legacyMigrationDirectory);
    const projects = new ProjectJourneyRepository(database.connection);
    const experiments = new ExternalExperimentRepository(database.connection);
    const project = projects.createProject({
      name: 'Actual legacy run',
      targetUrl: 'http://127.0.0.1:49999/legacy',
      description: 'Created before Outcome Check execution storage',
    });
    const journey = projects.saveJourney({
      projectId: project.id,
      name: 'Legacy journey v1',
      steps: [
        {
          id: 'legacy-submit',
          name: 'Submit',
          type: 'submit',
          timestamp: 0,
          url: project.targetUrl,
          locator: { strategy: 'id', value: 'legacy-form' },
          fingerprint: null,
          value: null,
          sensitive: false,
        },
      ],
      metadata: {
        recordingSessionId: null,
        recordedAt: '2026-07-16T00:00:00.000Z',
        warningCount: 0,
        normalizationRule: 'legacy test',
      },
    });
    const version = experiments.createVersion({
      projectId: project.id,
      journey,
      request: {
        name: 'Legacy double submit',
        targetStepId: 'legacy-submit',
        triggerCount: 2,
        intervalMs: 0,
        networkMatcher: null,
        assertions: [
          {
            id: 'legacy-complete',
            type: 'text_appeared',
            text: 'Complete',
            description: 'Completion appeared.',
          },
        ],
        continueAfterTarget: false,
        requestSelectionProvenance: null,
      },
    });
    database.connection
      .prepare(
        `INSERT INTO external_runs
          (id, experiment_version_id, project_id, journey_id, status,
           started_at, completed_at, duration_ms, target_url, project_name,
           journey_name, experiment_name, experiment_snapshot_json,
           resolved_values_json, trigger_attempts, network_observations_json,
           runner_error_json, warnings_json, created_at)
         VALUES (?, ?, ?, ?, 'passed', ?, ?, ?, ?, ?, ?, ?, ?, '{}', 2, '[]',
                 NULL, '[]', ?)`,
      )
      .run(
        'pre-outcome-run',
        version.id,
        project.id,
        journey.id,
        '2026-07-16T00:00:00.000Z',
        '2026-07-16T00:00:01.000Z',
        1_000,
        project.targetUrl,
        project.name,
        journey.name,
        version.name,
        JSON.stringify(version),
        '2026-07-16T00:00:00.000Z',
      );
    database.connection
      .prepare(
        `INSERT INTO external_runs
          (id, experiment_version_id, project_id, journey_id, status,
           started_at, completed_at, duration_ms, target_url, project_name,
           journey_name, experiment_name, experiment_snapshot_json,
           resolved_values_json, trigger_attempts, network_observations_json,
           runner_error_json, warnings_json, created_at)
         VALUES (?, ?, ?, ?, 'runner_error', ?, ?, ?, ?, ?, ?, ?, ?, '{}', 0,
                 '[]', ?, '[]', ?)`,
      )
      .run(
        'pre-outcome-runner-error',
        version.id,
        project.id,
        journey.id,
        '2026-07-16T00:00:02.000Z',
        '2026-07-16T00:00:03.000Z',
        1_000,
        project.targetUrl,
        project.name,
        journey.name,
        version.name,
        JSON.stringify(version),
        JSON.stringify({
          code: 'runner_failure',
          message: 'Legacy runner failure.',
          failedStep: null,
          missingVariables: [],
        }),
        '2026-07-16T00:00:02.000Z',
      );
    database.connection
      .prepare(
        `INSERT INTO external_assertion_results
          (id, run_id, assertion_id, assertion_type, status, description,
           expected_description, observed_description, evaluated_at)
         VALUES (?, ?, ?, ?, 'passed', ?, ?, ?, ?)`,
      )
      .run(
        'legacy-assertion-result',
        'pre-outcome-run',
        'legacy-complete',
        'text_appeared',
        'Completion appeared.',
        'Text appears.',
        'Text appeared once.',
        '2026-07-16T00:00:00.900Z',
      );

    database.migrate();
    const migrated = new ExternalExperimentRepository(
      database.connection,
    ).getRun('pre-outcome-run');
    expect(migrated).toMatchObject({
      status: 'passed',
      lifecycleStatus: 'completed',
      outcomeAggregate: 'not_configured',
      outcomeCheckSnapshot: { criticalAction: null, checks: [] },
      outcomeCheckResults: [],
      presentation: { primaryStatus: 'not_configured', checks: [] },
      assertions: [
        {
          assertionResultId: 'legacy-assertion-result',
          assertionId: 'legacy-complete',
          status: 'passed',
          observedDescription: 'Text appeared once.',
        },
      ],
    });
    expect(
      new ExternalExperimentRepository(database.connection).getRun(
        'pre-outcome-runner-error',
      ),
    ).toMatchObject({
      status: 'runner_error',
      lifecycleStatus: 'runner_error',
      outcomeAggregate: 'not_configured',
      outcomeCheckResults: [],
      runnerError: { code: 'runner_failure' },
      presentation: {
        primaryStatus: 'runner_error',
        headline: 'FormCrash could not complete the journey.',
      },
    });
    database.close();
  });
});

function generatedEmailBinding() {
  return {
    expression: 'unique.email' as const,
    template: '{{unique.email}}' as const,
    label: 'Unique email',
  };
}

function outcomeTarget() {
  return {
    locator: { strategy: 'data-formcrash' as const, value: 'profile-result' },
    fingerprint: {
      tagName: 'li',
      dataFormcrash: 'profile-result',
      dataTestId: null,
      id: null,
      role: null,
      accessibleName: null,
      name: null,
      cssPath: '#profile-results > li',
    },
    preview: 'Profile {{unique.email}}',
    reliability: 'high' as const,
    warnings: [],
    generatedBindings: [generatedEmailBinding()],
  };
}
