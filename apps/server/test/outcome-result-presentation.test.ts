import { describe, expect, it } from 'vitest';

import type {
  ExternalNetworkObservation,
  ExternalOutcomeCheckResult,
  OutcomeCheck,
  OutcomeCheckRunSnapshot,
} from '@formcrash/contracts';

import { presentExternalRun } from '../src/runner/outcomes/outcome-result-presentation.js';

const evaluatedAt = '2026-07-18T00:00:01.000Z';
const createdAt = '2026-07-18T00:00:00.000Z';
const evidenceReferences = {
  triggerEventIds: ['trigger-1', 'trigger-2'],
  requestObservationIds: ['request-1', 'request-2'],
  screenshotArtifactIds: ['screen-1'],
  runnerEventIds: ['runner-1'],
};

describe('external outcome result presentation', () => {
  it.each([
    [
      2,
      'failed',
      'Failed: The expected result appeared twice instead of once.',
    ],
    [0, 'failed', 'Failed: The expected result did not appear.'],
    [1, 'passed', 'Passed: The intended result occurred exactly once.'],
  ] as const)(
    'presents an exact-once observed count of %s',
    (observedCount, status, headline) => {
      const check = exactOnceCheck();
      const presentation = present({
        checks: [check],
        results: [result(check, status, observedCount)],
        outcomeAggregate: status,
      });

      expect(presentation).toMatchObject({
        primaryStatus: status,
        headline,
        approvedExpectedOutcomeDescription:
          'Exactly one profile matching the generated email should appear.',
        expectedCondition: { kind: 'visible_match_count', count: 1 },
        observedCondition: {
          kind: 'visible_match_count',
          count: observedCount,
        },
        checks: [
          {
            type: 'matching_item_appears_exactly_once',
            templateBinding: { template: '{{unique.email}}' },
          },
        ],
      });
    },
  );

  it.each([
    [
      visibleCheck(),
      1,
      'passed',
      'Passed: The expected confirmation was visible.',
    ],
    [
      visibleCheck(),
      0,
      'failed',
      'Failed: The expected confirmation was not visible.',
    ],
    [
      pathnameCheck(),
      null,
      'passed',
      'Passed: The journey ended at the expected pathname.',
    ],
    [
      pathnameCheck(),
      null,
      'failed',
      'Failed: The journey ended on a different page.',
    ],
  ] as const)(
    'uses bounded wording for $type with $status',
    (check, observedCount, status, headline) => {
      const presentation = present({
        checks: [check],
        results: [result(check, status, observedCount)],
        outcomeAggregate: status,
      });

      expect(presentation.headline).toBe(headline);
      if (check.type === 'final_pathname_matches') {
        expect(presentation.expectedCondition).toMatchObject({
          kind: 'pathname',
          pathname: '/profiles',
        });
        expect(presentation.observedCondition).toMatchObject({
          kind: 'pathname',
          pathname: status === 'passed' ? '/profiles' : '/other',
        });
      }
    },
  );

  it('keeps could-not-verify, not-configured, and runner-error distinct', () => {
    const check = exactOnceCheck();
    const unavailable = result(check, 'could_not_verify', null);
    const couldNotVerify = present({
      checks: [check],
      results: [unavailable],
      outcomeAggregate: 'could_not_verify',
    });
    const notConfigured = present({
      checks: [],
      results: [],
      outcomeAggregate: 'not_configured',
    });
    const runnerError = present({
      checks: [check],
      results: [unavailable],
      outcomeAggregate: 'could_not_verify',
      lifecycleStatus: 'runner_error',
      runnerError: {
        code: 'journey_step_failed',
        message: 'The saved journey step did not complete.',
        failedStep: null,
        missingVariables: [],
      },
    });

    expect(couldNotVerify).toMatchObject({
      primaryStatus: 'could_not_verify',
      headline:
        'FormCrash completed the experiment but could not reliably verify the expected outcome.',
    });
    expect(notConfigured).toMatchObject({
      primaryStatus: 'not_configured',
      headline:
        'This run has technical evidence, but no approved Outcome Check was configured.',
      checks: [],
    });
    expect(runnerError).toMatchObject({
      primaryStatus: 'runner_error',
      headline: 'FormCrash could not complete the journey.',
      outcomeSummary: 'The saved journey step did not complete.',
    });
  });

  it('uses the aggregate while ordering exact-once before confirmation and pathname checks', () => {
    const exact = exactOnceCheck();
    const visible = visibleCheck();
    const pathname = pathnameCheck();
    const allPassing = present({
      checks: [pathname, visible, exact],
      results: [
        result(pathname, 'passed', null),
        result(visible, 'passed', 1),
        result(exact, 'passed', 1),
      ],
      outcomeAggregate: 'passed',
    });
    const oneFailing = present({
      checks: [exact, visible],
      results: [result(exact, 'passed', 1), result(visible, 'failed', 0)],
      outcomeAggregate: 'failed',
    });
    const oneUnavailable = present({
      checks: [exact, pathname],
      results: [
        result(exact, 'passed', 1),
        result(pathname, 'could_not_verify', null),
      ],
      outcomeAggregate: 'could_not_verify',
    });

    expect(allPassing.primaryStatus).toBe('passed');
    expect(allPassing.checks.map((check) => check.type)).toEqual([
      'matching_item_appears_exactly_once',
      'visible_element_exists',
      'final_pathname_matches',
    ]);
    expect(oneFailing).toMatchObject({
      primaryStatus: 'failed',
      headline: 'Failed: The expected confirmation was not visible.',
    });
    expect(oneUnavailable.primaryStatus).toBe('could_not_verify');
  });

  it('describes only supported visible/request evidence and never claims database state or root cause', () => {
    const generatedLiteral =
      'actual-unique-email-should-not-appear@example.test';
    const check = exactOnceCheck();
    const unsafeObservedDescription = result(check, 'failed', 2, {
      description: `Two rows matched ${generatedLiteral}`,
    });
    const presentation = present({
      checks: [check],
      results: [unsafeObservedDescription],
      outcomeAggregate: 'failed',
      observations: [request('request-1'), request('request-2')],
    });
    const serialized = JSON.stringify(presentation);

    expect(presentation.observations.map((item) => item.text)).toEqual(
      expect.arrayContaining([
        'FormCrash triggered "Save profile" twice.',
        'Two matching requests completed successfully.',
        'Two visible results matched the approved generated identity.',
      ]),
    );
    expect(presentation.whyItMatters).toBe(
      'Repeated submission can leave the user with duplicate visible results for one intended action.',
    );
    expect(presentation.protectionSuggestions).toHaveLength(2);
    expect(presentation.unknowns).toContain(
      'FormCrash did not inspect the application database or hidden backend state.',
    );
    expect(serialized).not.toContain(generatedLiteral);
    expect(serialized).not.toContain('two database records');
    expect(serialized.toLowerCase()).not.toContain('root cause');
    expect(serialized).toContain('{{unique.email}}');
  });

  it('omits request statements when no referenced request evidence is available', () => {
    const check = exactOnceCheck();
    const withoutRequests = {
      ...result(check, 'passed', 1),
      evidenceReferences: {
        ...evidenceReferences,
        requestObservationIds: [],
      },
    };
    const presentation = present({
      checks: [check],
      results: [withoutRequests],
      outcomeAggregate: 'passed',
      observations: [request('request-1')],
    });

    expect(
      presentation.observations.some((item) => item.kind === 'request'),
    ).toBe(false);
  });
});

function present(
  overrides: Partial<Parameters<typeof presentExternalRun>[0]> & {
    readonly checks: readonly OutcomeCheck[];
    readonly results: readonly ExternalOutcomeCheckResult[];
  },
) {
  const {
    checks,
    results,
    snapshot: snapshotOverride,
    ...inputOverrides
  } = overrides;
  const snapshot: OutcomeCheckRunSnapshot = {
    criticalAction: {
      id: 'critical-action-1',
      journeyId: 'journey-1',
      stepId: 'save-profile',
      label: 'Save profile',
      createdAt,
      updatedAt: createdAt,
    },
    checks: [...checks],
  };
  return presentExternalRun({
    lifecycleStatus: 'completed',
    outcomeAggregate: 'passed',
    triggerAttempts: 2,
    results,
    observations: [],
    assertions: [],
    events: [],
    artifacts: [],
    runnerError: null,
    ...inputOverrides,
    snapshot: snapshotOverride ?? snapshot,
  });
}

function exactOnceCheck(): OutcomeCheck {
  return {
    id: 'check-exact',
    journeyId: 'journey-1',
    criticalActionId: 'critical-action-1',
    type: 'matching_item_appears_exactly_once',
    description:
      'Exactly one profile matching the generated email should appear.',
    target: target(),
    binding: {
      expression: 'unique.email',
      template: '{{unique.email}}',
      label: 'Unique email',
    },
    createdAt,
  };
}

function visibleCheck(): OutcomeCheck {
  return {
    id: 'check-visible',
    journeyId: 'journey-1',
    criticalActionId: 'critical-action-1',
    type: 'visible_element_exists',
    description: 'A profile result should be visible.',
    target: target(),
    createdAt,
  };
}

function pathnameCheck(): OutcomeCheck {
  return {
    id: 'check-pathname',
    journeyId: 'journey-1',
    criticalActionId: 'critical-action-1',
    type: 'final_pathname_matches',
    description: 'The profile pathname should remain visible.',
    expectedPathname: '/profiles',
    createdAt,
  };
}

function target() {
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
    preview: 'Profile generated email',
    reliability: 'high' as const,
    warnings: [],
    generatedBindings: [
      {
        expression: 'unique.email' as const,
        template: '{{unique.email}}' as const,
        label: 'Unique email',
      },
    ],
  };
}

function result(
  check: OutcomeCheck,
  status: ExternalOutcomeCheckResult['status'],
  observedCount: number | null,
  observedOverrides: Record<string, unknown> = {},
): ExternalOutcomeCheckResult {
  const pathname =
    check.type === 'final_pathname_matches'
      ? status === 'passed'
        ? '/profiles'
        : '/other'
      : undefined;
  return {
    outcomeCheckResultId: `result-${check.id}`,
    runId: 'run-1',
    outcomeCheckId: check.id,
    journeyId: 'journey-1',
    criticalActionId: 'critical-action-1',
    type: check.type,
    expected:
      check.type === 'final_pathname_matches'
        ? { pathname: '/profiles' }
        : check.type === 'matching_item_appears_exactly_once'
          ? { visibleMatchCount: 1, template: '{{unique.email}}' }
          : { visible: true },
    observed:
      pathname === undefined
        ? { visibleMatchCount: observedCount, ...observedOverrides }
        : { pathname, ...observedOverrides },
    expectedCount:
      check.type === 'matching_item_appears_exactly_once' ? 1 : null,
    observedCount,
    status,
    reason:
      status === 'passed'
        ? null
        : status === 'could_not_verify'
          ? 'The approved browser-visible condition could not be evaluated reliably.'
          : 'The approved browser-visible condition did not match.',
    evidenceReferences,
    templateBinding:
      check.type === 'matching_item_appears_exactly_once'
        ? check.binding
        : null,
    unknowns: [
      'FormCrash evaluated browser-visible state only; backend side effects were not inspected.',
    ],
    evaluatedAt,
  };
}

function request(requestId: string): ExternalNetworkObservation {
  return {
    requestId,
    method: 'POST',
    pathname: '/api/profile',
    origin: 'http://127.0.0.1:4300',
    startedAtMs: 10,
    completedAtMs: 20,
    status: 201,
    failed: false,
    matched: true,
  };
}
