import { describe, expect, it } from 'vitest';

import {
  externalRunDetailSchema,
  type ExternalRunDetail,
  type OutcomeAggregate,
} from '@formcrash/contracts';

import { compareExternalRuns } from '../src/runner/outcomes/external-run-comparison.js';
import { presentExternalRun } from '../src/runner/outcomes/outcome-result-presentation.js';

describe('external run comparison compatibility', () => {
  it('compares exact immutable configuration and verifies failed-to-passed protection', () => {
    const before = run({
      runId: 'before',
      outcome: 'failed',
      observedCount: 2,
    });
    const after = run({ runId: 'after', outcome: 'passed', observedCount: 1 });

    const comparison = compareExternalRuns(before, after);

    expect(comparison).toMatchObject({
      compatibility: 'compatible',
      primaryStatus: 'protection_verified',
      differences: [],
      presentation: {
        headline: 'Repeated-submission protection verified.',
        failureRecipe: { triggerCount: 2, intervalMs: 0 },
        technicalAssertionAggregates: { before: 'failed', after: 'passed' },
      },
    });
    expect(comparison.matchedProperties.map((item) => item.key)).toEqual([
      'project',
      'journey_version',
      'critical_action',
      'failure_recipe',
      'outcome_checks',
      'generated_template_strategy',
      'request_matcher',
      'technical_assertions',
    ]);
    expect(comparison.presentation?.evidenceTable).toEqual([
      {
        key: 'critical_action_triggers',
        label: 'Critical-action triggers',
        before: 2,
        after: 2,
      },
      {
        key: 'successful_matching_requests',
        label: 'Successful matching requests',
        before: 2,
        after: 1,
      },
      {
        key: 'visible_matching_results',
        label: 'Visible matching results',
        before: 2,
        after: 1,
      },
      {
        key: 'expected_visible_results',
        label: 'Expected visible results',
        before: 1,
        after: 1,
      },
      {
        key: 'outcome',
        label: 'Outcome',
        before: 'Failed',
        after: 'Passed',
      },
    ]);
    expect(comparison.presentation?.unknowns).toEqual([
      'Database state was not inspected.',
      'Hidden backend records or side effects were not evaluated.',
      'FormCrash did not prove which frontend or backend code change caused the result.',
    ]);
    expect(comparison.presentation?.conclusion).not.toMatch(
      /database duplicate|backend idempotency|root cause/iu,
    );
  });

  it('ignores run-specific generated literals while retaining template identity', () => {
    const before = run({
      runId: 'before',
      outcome: 'failed',
      observedCount: 2,
      resolvedLiteral: 'profile-before-123@example.test',
    });
    const after = run({
      runId: 'after',
      outcome: 'passed',
      observedCount: 1,
      resolvedLiteral: 'profile-after-456@example.test',
    });

    const serialized = JSON.stringify(compareExternalRuns(before, after));

    expect(serialized).toContain('{{unique.email}}');
    expect(serialized).not.toContain('profile-before-123@example.test');
    expect(serialized).not.toContain('profile-after-456@example.test');
  });

  it.each([
    [
      'project',
      'different_project',
      (value: ExternalRunDetail) => ({ ...value, projectId: 'other-project' }),
    ],
    [
      'journey version',
      'different_journey_version',
      (value: ExternalRunDetail) => ({
        ...value,
        journeyId: 'journey-v2',
        experimentSnapshot: {
          ...value.experimentSnapshot,
          journeyId: 'journey-v2',
          journeySnapshot: {
            ...value.experimentSnapshot.journeySnapshot,
            id: 'journey-v2',
            version: 2,
          },
        },
      }),
    ],
    [
      'Critical Action',
      'different_critical_action',
      (value: ExternalRunDetail) => ({
        ...value,
        outcomeCheckSnapshot: {
          ...value.outcomeCheckSnapshot,
          criticalAction: {
            ...value.outcomeCheckSnapshot.criticalAction!,
            id: 'other-action',
          },
        },
      }),
    ],
    [
      'trigger count',
      'different_trigger_count',
      (value: ExternalRunDetail) => ({
        ...value,
        experimentSnapshot: {
          ...value.experimentSnapshot,
          triggerCount: 3 as const,
        },
      }),
    ],
    [
      'trigger interval',
      'different_trigger_interval',
      (value: ExternalRunDetail) => ({
        ...value,
        experimentSnapshot: {
          ...value.experimentSnapshot,
          intervalMs: 100 as const,
        },
      }),
    ],
    [
      'continuation behavior',
      'different_continuation_behavior',
      (value: ExternalRunDetail) => ({
        ...value,
        experimentSnapshot: {
          ...value.experimentSnapshot,
          continueAfterTarget: true,
        },
      }),
    ],
    [
      'Outcome Check definition',
      'different_outcome_checks',
      (value: ExternalRunDetail) => ({
        ...value,
        outcomeCheckSnapshot: {
          ...value.outcomeCheckSnapshot,
          checks: value.outcomeCheckSnapshot.checks.map((check) => ({
            ...check,
            description: 'A changed approved outcome.',
          })),
        },
      }),
    ],
    [
      'generated template strategy',
      'different_generated_template_strategy',
      (value: ExternalRunDetail) => ({
        ...value,
        experimentSnapshot: {
          ...value.experimentSnapshot,
          journeySnapshot: {
            ...value.experimentSnapshot.journeySnapshot,
            steps: value.experimentSnapshot.journeySnapshot.steps.map((step) =>
              step.id === 'email'
                ? {
                    ...step,
                    value: { kind: 'safe' as const, value: '{{unique.name}}' },
                  }
                : step,
            ),
          },
        },
      }),
    ],
    [
      'request matcher',
      'different_request_matcher',
      (value: ExternalRunDetail) => ({
        ...value,
        experimentSnapshot: {
          ...value.experimentSnapshot,
          networkMatcher: {
            ...value.experimentSnapshot.networkMatcher!,
            pathname: '/api/other',
          },
        },
      }),
    ],
    [
      'technical assertion',
      'different_assertions',
      (value: ExternalRunDetail) => ({
        ...value,
        experimentSnapshot: {
          ...value.experimentSnapshot,
          assertions: [
            {
              id: 'request-max-one',
              type: 'network_request_max' as const,
              maximum: 2,
              description: 'No more than two requests.',
            },
          ],
        },
      }),
    ],
  ])('discloses incompatible %s configuration', (_label, code, mutate) => {
    const before = run({
      runId: 'before',
      outcome: 'failed',
      observedCount: 2,
    });
    const after = mutate(
      run({ runId: 'after', outcome: 'passed', observedCount: 1 }),
    );

    const comparison = compareExternalRuns(before, after);

    expect(comparison.compatibility).toBe('incompatible');
    expect(comparison.primaryStatus).toBe('incompatible');
    expect(comparison.presentation).toBeNull();
    expect(comparison.differences).toEqual(
      expect.arrayContaining([expect.objectContaining({ code })]),
    );
  });

  it('rejects the same run and reverse chronology', () => {
    const same = run({ runId: 'same', outcome: 'failed', observedCount: 2 });
    expect(compareExternalRuns(same, same).differences).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ code: 'same_run' }),
        expect.objectContaining({ code: 'reverse_chronology' }),
      ]),
    );

    const before = run({
      runId: 'later',
      outcome: 'failed',
      observedCount: 2,
      createdAt: '2026-07-18T00:00:02.000Z',
    });
    const after = run({
      runId: 'earlier',
      outcome: 'passed',
      observedCount: 1,
      createdAt: '2026-07-18T00:00:01.000Z',
    });
    expect(compareExternalRuns(before, after).differences).toContainEqual(
      expect.objectContaining({ code: 'reverse_chronology' }),
    );
  });

  it('uses historical snapshots without consulting current Outcome Check objects', () => {
    const before = run({
      runId: 'before',
      outcome: 'failed',
      observedCount: 2,
    });
    const after = run({ runId: 'after', outcome: 'passed', observedCount: 1 });

    expect(compareExternalRuns(before, after).compatibility).toBe('compatible');
  });

  it('accepts a different Outcome Check ID when the normalized definition is exact', () => {
    const before = run({
      runId: 'before',
      outcome: 'failed',
      observedCount: 2,
    });
    const originalAfter = run({
      runId: 'after',
      outcome: 'passed',
      observedCount: 1,
    });
    const replacementId = 'replacement-check-id';
    const after = {
      ...originalAfter,
      outcomeCheckSnapshot: {
        ...originalAfter.outcomeCheckSnapshot,
        checks: originalAfter.outcomeCheckSnapshot.checks.map((check) => ({
          ...check,
          id: replacementId,
        })),
      },
      outcomeCheckResults: originalAfter.outcomeCheckResults.map((result) => ({
        ...result,
        outcomeCheckId: replacementId,
      })),
      presentation: {
        ...originalAfter.presentation,
        checks: originalAfter.presentation.checks.map((check) => ({
          ...check,
          outcomeCheckId: replacementId,
        })),
      },
    };

    expect(compareExternalRuns(before, after).compatibility).toBe('compatible');
  });
});

describe('external run comparison statuses and evidence', () => {
  it.each([
    ['failed', 2, 'failed', 3, 'still_failing'],
    ['passed', 1, 'failed', 2, 'regressed'],
    ['passed', 1, 'passed', 1, 'no_material_change'],
    ['could_not_verify', null, 'passed', 1, 'could_not_verify'],
  ] as const)(
    'maps %s before and %s after to %s',
    (beforeOutcome, beforeCount, afterOutcome, afterCount, expected) => {
      const comparison = compareExternalRuns(
        run({
          runId: 'before',
          outcome: beforeOutcome,
          observedCount: beforeCount,
        }),
        run({
          runId: 'after',
          outcome: afterOutcome,
          observedCount: afterCount,
        }),
      );
      expect(comparison.primaryStatus).toBe(expected);
    },
  );

  it('omits request evidence unless both runs have comparable referenced requests', () => {
    const comparison = compareExternalRuns(
      run({ runId: 'before', outcome: 'failed', observedCount: 2 }),
      run({
        runId: 'after',
        outcome: 'passed',
        observedCount: 1,
        includeRequestEvidence: false,
      }),
    );

    expect(comparison.presentation?.successfulRequestCounts).toBeNull();
    expect(
      comparison.presentation?.evidenceTable.some(
        (row) => row.key === 'successful_matching_requests',
      ),
    ).toBe(false);
  });

  it('keeps screenshot references paired with their owning runs and handles missing images', () => {
    const comparison = compareExternalRuns(
      run({ runId: 'before', outcome: 'failed', observedCount: 2 }),
      run({
        runId: 'after',
        outcome: 'passed',
        observedCount: 1,
        includeScreenshots: false,
      }),
    );

    const finalPair = comparison.presentation?.screenshots.find(
      (pair) => pair.label === 'final-result',
    );
    expect(finalPair?.before?.runId).toBe('before');
    expect(finalPair?.after).toBeNull();
  });

  it.each([
    [
      'legacy run',
      (value: ExternalRunDetail) => ({
        ...value,
        outcomeAggregate: 'not_configured' as const,
        outcomeCheckSnapshot: { criticalAction: null, checks: [] },
        outcomeCheckResults: [],
      }),
      'outcome_checks_not_configured',
    ],
    [
      'runner error',
      (value: ExternalRunDetail) => ({
        ...value,
        status: 'runner_error' as const,
        lifecycleStatus: 'runner_error' as const,
        runnerError: {
          code: 'runner_failure' as const,
          message: 'Runner stopped.',
          failedStep: null,
          missingVariables: [],
        },
      }),
      'runner_error',
    ],
    [
      'in-progress run',
      (value: ExternalRunDetail) => ({
        ...value,
        status: 'running' as const,
        lifecycleStatus: 'running' as const,
        completedAt: null,
      }),
      'run_not_completed',
    ],
  ])('makes a %s ineligible', (_label, mutate, code) => {
    const comparison = compareExternalRuns(
      mutate(run({ runId: 'before', outcome: 'failed', observedCount: 2 })),
      run({ runId: 'after', outcome: 'passed', observedCount: 1 }),
    );

    expect(comparison.compatibility).toBe('incompatible');
    expect(comparison.presentation).toBeNull();
    expect(comparison.differences).toEqual(
      expect.arrayContaining([expect.objectContaining({ code })]),
    );
  });
});

function run(options: {
  readonly runId: string;
  readonly outcome: Exclude<OutcomeAggregate, 'not_configured'>;
  readonly observedCount: number | null;
  readonly resolvedLiteral?: string;
  readonly createdAt?: string;
  readonly includeRequestEvidence?: boolean;
  readonly includeScreenshots?: boolean;
}): ExternalRunDetail {
  const isBefore = options.runId === 'before' || options.runId === 'later';
  const createdAt =
    options.createdAt ??
    (isBefore ? '2026-07-18T00:00:00.000Z' : '2026-07-18T00:00:01.000Z');
  const status = options.outcome === 'failed' ? 'failed' : 'passed';
  const resultStatus = options.outcome;
  const screenshotIds =
    options.includeScreenshots === false
      ? []
      : ['before-disruption', 'after-disruption', 'final-result'].map(
          (label) => `${options.runId}-${label}`,
        );
  const requestCount = options.observedCount ?? 0;
  const requestIds =
    options.includeRequestEvidence === false
      ? []
      : Array.from(
          { length: requestCount },
          (_value, index) => `${options.runId}-request-${index + 1}`,
        );
  const criticalAction = {
    id: 'critical-action-1',
    journeyId: 'journey-v1',
    stepId: 'submit',
    label: 'Save profile',
    createdAt: '2026-07-17T00:00:00.000Z',
    updatedAt: '2026-07-17T00:00:00.000Z',
  };
  const check = {
    id: 'check-exactly-once',
    journeyId: 'journey-v1',
    criticalActionId: criticalAction.id,
    type: 'matching_item_appears_exactly_once' as const,
    description:
      'Exactly one profile matching the generated email should appear.',
    target: {
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
      generatedBindings: [
        {
          expression: 'unique.email' as const,
          template: '{{unique.email}}' as const,
          label: 'Unique email',
        },
      ],
    },
    binding: {
      expression: 'unique.email' as const,
      template: '{{unique.email}}' as const,
      label: 'Unique email',
    },
    createdAt: '2026-07-17T00:00:00.000Z',
  };
  const evidenceReferences = {
    triggerEventIds: [`${options.runId}-trigger`],
    requestObservationIds: requestIds,
    screenshotArtifactIds: screenshotIds,
    runnerEventIds: [`${options.runId}-evaluated`],
  };
  const result = {
    outcomeCheckResultId: `${options.runId}-result`,
    runId: options.runId,
    outcomeCheckId: check.id,
    journeyId: 'journey-v1',
    criticalActionId: criticalAction.id,
    type: check.type,
    expected: { visibleMatchCount: 1 },
    observed: { visibleMatchCount: options.observedCount },
    expectedCount: 1,
    observedCount: options.observedCount,
    status: resultStatus,
    reason:
      resultStatus === 'could_not_verify'
        ? 'The target could not be evaluated.'
        : null,
    evidenceReferences,
    templateBinding: check.binding,
    unknowns: ['Database state was not inspected.'],
    evaluatedAt: createdAt,
  };
  const snapshot = { criticalAction, checks: [check] };
  const networkObservations = requestIds.map((requestId, index) => ({
    requestId,
    method: 'POST',
    pathname: '/api/profile',
    origin: 'http://fixture.test',
    startedAtMs: index * 10,
    completedAtMs: index * 10 + 5,
    status: 201,
    failed: false,
    matched: true,
  }));
  const artifacts = screenshotIds.map((artifactId, index) => ({
    artifactId,
    runId: options.runId,
    artifactType: 'screenshot' as const,
    label: ['before-disruption', 'after-disruption', 'final-result'][index] as
      'before-disruption' | 'after-disruption' | 'final-result',
    relativePath: `screenshots/${options.runId}/${index + 1}.png`,
    mimeType: 'image/png' as const,
    sizeBytes: 100,
    checksumSha256: 'a'.repeat(64),
    captureSequence: index + 1,
    createdAt,
    metadata: { fullPage: true },
  }));
  const presentation = presentExternalRun({
    lifecycleStatus: 'completed',
    outcomeAggregate: options.outcome,
    triggerAttempts: 2,
    snapshot,
    results: [result],
    observations: networkObservations,
    assertions: [],
    events: [],
    artifacts,
    runnerError: null,
  });

  return externalRunDetailSchema.parse({
    runId: options.runId,
    experimentVersionId: `${options.runId}-experiment-version`,
    projectId: 'project-1',
    journeyId: 'journey-v1',
    status,
    lifecycleStatus: 'completed',
    outcomeAggregate: options.outcome,
    assertionAggregate: status === 'failed' ? 'failed' : 'passed',
    startedAt: createdAt,
    completedAt: new Date(Date.parse(createdAt) + 1_000).toISOString(),
    durationMs: 1_000,
    targetUrl: 'http://fixture.test/profile',
    projectName: 'Profile fixture',
    journeyName: 'Create profile',
    experimentName: 'Double submit safety',
    experimentSnapshot: {
      id: `${options.runId}-experiment-version`,
      experimentId: 'experiment-1',
      projectId: 'project-1',
      journeyId: 'journey-v1',
      name: 'Double submit safety',
      experimentType: 'impatient_user',
      version: isBefore ? 1 : 2,
      targetStepId: 'submit',
      triggerCount: 2,
      intervalMs: 0,
      networkMatcher: {
        method: 'POST',
        pathname: '/api/profile',
        host: 'fixture.test',
      },
      assertions: [
        {
          id: 'request-max-one',
          type: 'network_request_max',
          maximum: 1,
          description: 'No more than one request.',
        },
      ],
      continueAfterTarget: false,
      guided: true,
      requestSelectionProvenance: null,
      assertionSelectionProvenance: [],
      journeySnapshot: {
        id: 'journey-v1',
        projectId: 'project-1',
        name: 'Create profile',
        version: 1,
        steps: [
          {
            id: 'email',
            name: 'Fill email',
            type: 'fill',
            timestamp: 0,
            url: 'http://fixture.test/profile',
            locator: { strategy: 'data-testid', value: 'email' },
            fingerprint: null,
            value: { kind: 'safe', value: '{{unique.email}}' },
            sensitive: false,
          },
          {
            id: 'submit',
            name: 'Submit profile',
            type: 'submit',
            timestamp: 1,
            url: 'http://fixture.test/profile',
            locator: { strategy: 'data-testid', value: 'profile-form' },
            fingerprint: null,
            value: null,
            sensitive: false,
          },
        ],
        recordingMetadata: {
          recordingSessionId: null,
          recordedAt: '2026-07-17T00:00:00.000Z',
          warningCount: 0,
          normalizationRule: 'Generated identity fixture.',
        },
        createdAt: '2026-07-17T00:00:00.000Z',
      },
      createdAt: '2026-07-17T00:00:00.000Z',
    },
    resolvedValues: {
      CUSTOMER_EMAIL:
        options.resolvedLiteral ?? `${options.runId}@example.test`,
    },
    triggerAttempts: 2,
    networkObservations,
    assertions: [],
    outcomeCheckSnapshot: snapshot,
    outcomeCheckResults: [result],
    presentation,
    events: [],
    runnerError: null,
    warnings: [],
    artifacts,
    createdAt,
  });
}
