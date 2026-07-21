import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import {
  externalRunDetailSchema,
  type ExternalRunDetail,
} from '@formcrash/contracts';

import { ExternalRunResult } from '../src/features/projects/components/external-run-result';

vi.mock('../src/features/projects/api/external-experiments', () => ({
  getExternalArtifactUrl: (runId: string, artifactId: string) =>
    `http://localhost:4100/api/external-runs/${runId}/artifacts/${artifactId}`,
}));

describe('external run outcome-first result', () => {
  it('leads with the failed exact-once outcome and keeps technical evidence secondary', async () => {
    const user = userEvent.setup();
    const { container } = render(<ExternalRunResult result={run('failed')} />);

    const headline = screen.getByRole('heading', {
      name: 'Failed: The expected result appeared twice instead of once.',
    });
    const explanation = screen.getByRole('heading', {
      name: 'Why this run failed',
    });
    expect(
      headline.compareDocumentPosition(explanation) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    expect(
      screen.getByText(
        '2 matching results appeared; the Test expected exactly one.',
      ),
    ).toBeVisible();
    expect(
      screen.getByText(
        'FormCrash checked the visible page and observed browser requests. It did not inspect database records or hidden backend side effects.',
      ),
    ).toBeVisible();
    expect(
      screen.getByRole('img', { name: 'before-disruption screenshot' }),
    ).toBeVisible();
    expect(
      screen.queryByRole('heading', { name: 'Expected versus observed' }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole('heading', { name: 'Individual Outcome Checks' }),
    ).not.toBeInTheDocument();

    const technicalEvidence = screen.getByText('Technical evidence');
    expect(technicalEvidence).toBeVisible();
    expect(screen.getByText('assertion-1')).not.toBeVisible();
    await user.click(technicalEvidence);
    expect(screen.getByText('assertion-1')).toBeVisible();
    expect(
      screen.getByRole('heading', { name: 'Technical assertions' }),
    ).toBeVisible();
    expect(container.textContent).not.toContain(
      'actual-generated-email@example.test',
    );
    expect(container.textContent).not.toContain('two database records');
  });

  it('explains a safe repeated submission without repeating the approved outcome details', () => {
    render(<ExternalRunResult result={run('passed')} />);

    expect(
      screen.getByRole('heading', {
        name: 'Passed: Repeated submissions were handled safely.',
      }),
    ).toBeVisible();
    expect(
      screen.getByText('Exactly one matching result appeared in the page.'),
    ).toBeVisible();
    expect(
      screen.getByRole('heading', { name: 'Why this run passed' }),
    ).toBeVisible();
    expect(
      screen.getByText(
        '1 of 1 matching requests succeeded. No matching request returned a server error.',
      ),
    ).toBeVisible();
  });

  it('shows a failed overall verdict when the browser outcome passes but a required technical check fails', () => {
    render(<ExternalRunResult result={run('technical_failed')} />);

    expect(
      screen.getByRole('heading', {
        name: 'Failed: 1 of 2 repeated requests returned HTTP 500.',
      }),
    ).toBeVisible();
    expect(
      screen.getByRole('heading', { name: 'Why this run failed' }),
    ).toBeVisible();
    expect(screen.getByText('Visible application result')).toBeVisible();
    expect(screen.getByText('Repeated-request handling')).toBeVisible();
    expect(
      screen.getByText(
        '1 of 2 matching requests returned HTTP 500. A repeated attempt should be ignored or rejected intentionally—not reported as an internal server error.',
      ),
    ).toBeVisible();
    expect(
      screen.getByText(
        /The Run failed because the backend reported an internal server error instead of handling the repeated attempt safely\./u,
      ),
    ).toBeVisible();
    expect(
      screen.queryByRole('heading', {
        name: 'Passed: The intended result occurred exactly once.',
      }),
    ).not.toBeInTheDocument();
  });

  it('keeps legacy runs readable and handles missing screenshots', async () => {
    const user = userEvent.setup();
    render(<ExternalRunResult result={run('legacy')} />);

    expect(
      screen.getByRole('heading', {
        name: 'Passed — technical checks only',
      }),
    ).toBeVisible();
    expect(
      screen.getByText(
        'No approved Outcome Checks were configured for this immutable run snapshot. This verdict is supported by technical checks only.',
      ),
    ).toBeVisible();
    expect(
      screen.getByText('No screenshot evidence is available for this run.'),
    ).toBeVisible();
    expect(
      screen.queryByRole('heading', { name: 'Individual Outcome Checks' }),
    ).not.toBeInTheDocument();
    await user.click(screen.getByText('Technical evidence'));
    expect(screen.getByText('assertion-1')).toBeVisible();
  });

  it('keeps runner failures distinct from application outcome failures', () => {
    render(<ExternalRunResult result={run('runner_error')} />);

    expect(
      screen.getByRole('heading', {
        name: 'FormCrash could not complete the journey.',
      }),
    ).toBeVisible();
    expect(
      screen.getAllByText('The saved journey step did not complete.').length,
    ).toBeGreaterThan(0);
    expect(
      screen.queryByText(
        'Failed: The expected result appeared twice instead of once.',
      ),
    ).not.toBeInTheDocument();
  });
});

function run(
  kind: 'failed' | 'passed' | 'technical_failed' | 'legacy' | 'runner_error',
): ExternalRunDetail {
  const hasOutcome = kind !== 'legacy';
  const isRunnerError = kind === 'runner_error';
  const observedCount =
    kind === 'failed'
      ? 2
      : kind === 'passed' || kind === 'technical_failed'
        ? 1
        : null;
  const outcomeStatus = isRunnerError
    ? 'could_not_verify'
    : kind === 'failed'
      ? 'failed'
      : 'passed';
  const primaryStatus =
    kind === 'legacy'
      ? 'not_configured'
      : isRunnerError
        ? 'runner_error'
        : kind === 'failed'
          ? 'failed'
          : 'passed';
  const check = exactOnceCheck();
  const result = hasOutcome
    ? outcomeResult(outcomeStatus, observedCount)
    : null;
  const artifacts =
    kind === 'legacy' ? [] : [screenshot('before-disruption', 1)];
  const headline =
    kind === 'failed'
      ? 'Failed: The expected result appeared twice instead of once.'
      : kind === 'passed' || kind === 'technical_failed'
        ? 'Passed: The intended result occurred exactly once.'
        : kind === 'legacy'
          ? 'This run has technical evidence, but no approved Outcome Check was configured.'
          : 'FormCrash could not complete the journey.';

  return externalRunDetailSchema.parse({
    runId: 'run-1',
    experimentVersionId: 'version-1',
    projectId: 'project-1',
    journeyId: 'journey-1',
    status: isRunnerError
      ? 'runner_error'
      : kind === 'failed'
        ? 'failed'
        : 'passed',
    lifecycleStatus: isRunnerError ? 'runner_error' : 'completed',
    outcomeAggregate: kind === 'legacy' ? 'not_configured' : outcomeStatus,
    assertionAggregate: isRunnerError
      ? 'could_not_verify'
      : kind === 'technical_failed'
        ? 'failed'
        : 'passed',
    startedAt: '2026-07-18T00:00:00.000Z',
    completedAt: '2026-07-18T00:00:01.000Z',
    durationMs: 1_000,
    targetUrl: 'http://localhost:4300/protected',
    projectName: 'Fixture project',
    journeyName: 'Create profile v1',
    experimentName: 'Repeated profile save',
    experimentSnapshot: experimentSnapshot(),
    resolvedValues: {},
    triggerAttempts: isRunnerError ? 0 : 2,
    networkObservations:
      kind === 'technical_failed'
        ? [requestObservation(), serverErrorObservation()]
        : [requestObservation()],
    assertions: [technicalAssertion(kind === 'technical_failed')],
    outcomeCheckSnapshot: {
      criticalAction: hasOutcome ? criticalAction() : null,
      checks: hasOutcome ? [check] : [],
    },
    outcomeCheckResults: result === null ? [] : [result],
    presentation: {
      primaryStatus,
      headline,
      outcomeSummary: isRunnerError
        ? 'The saved journey step did not complete.'
        : kind === 'legacy'
          ? 'Technical assertions and captured evidence remain available below, but they do not establish an approved application outcome.'
          : kind === 'failed'
            ? '1 of 1 approved Outcome Check failed.'
            : 'All 1 approved Outcome Check passed.',
      approvedExpectedOutcomeDescription: hasOutcome ? check.description : null,
      expectedCondition: hasOutcome
        ? {
            kind: 'visible_match_count',
            count: 1,
            description: 'Exactly 1 visible matching result.',
          }
        : null,
      observedCondition: hasOutcome
        ? {
            kind: 'visible_match_count',
            count: observedCount,
            description:
              observedCount === null
                ? 'The journey did not complete.'
                : `${observedCount} visible matching result${observedCount === 1 ? '' : 's'}.`,
          }
        : null,
      templateBinding: hasOutcome ? check.binding : null,
      observations:
        observedCount === null
          ? []
          : [
              {
                kind: 'action',
                text: 'FormCrash triggered "Save profile" twice.',
                evidenceReferences: references(),
              },
              {
                kind: 'browser',
                text: `${observedCount === 1 ? 'One' : 'Two'} visible result${observedCount === 1 ? '' : 's'} matched the approved generated identity.`,
                evidenceReferences: references(),
              },
            ],
      conclusion:
        kind === 'legacy' || isRunnerError
          ? null
          : kind === 'failed'
            ? 'The approved exact-once outcome failed because two visible results matched the generated identity.'
            : 'The approved exact-once browser-visible outcome passed.',
      whyItMatters:
        kind === 'failed'
          ? 'Repeated submission can leave the user with duplicate visible results for one intended action.'
          : null,
      unknowns: hasOutcome
        ? [
            'FormCrash did not inspect the application database or hidden backend state.',
          ]
        : [],
      protectionSuggestions:
        kind === 'failed'
          ? [
              {
                area: 'frontend',
                text: 'Prevent additional submission synchronously when the first submission begins.',
              },
              {
                area: 'backend',
                text: 'Use idempotency or an appropriate business-level uniqueness rule.',
              },
            ]
          : [],
      evidenceReferences: result?.evidenceReferences ?? emptyReferences(),
      technicalDetailsAvailable: {
        assertions: true,
        requests: true,
        events: true,
        screenshots: artifacts.length > 0,
      },
      checks:
        result === null
          ? []
          : [
              {
                outcomeCheckId: check.id,
                type: check.type,
                approvedDescription: check.description,
                status: outcomeStatus,
                headline:
                  kind === 'failed'
                    ? 'Failed: The expected result appeared twice instead of once.'
                    : kind === 'passed'
                      ? 'Passed: The intended result occurred exactly once.'
                      : 'Could not verify the approved outcome.',
                expectedCondition: {
                  kind: 'visible_match_count',
                  count: 1,
                  description: 'Exactly 1 visible matching result.',
                },
                observedCondition: {
                  kind: 'visible_match_count',
                  count: observedCount,
                  description:
                    observedCount === null
                      ? 'The journey did not complete.'
                      : `${observedCount} visible matching result${observedCount === 1 ? '' : 's'}.`,
                },
                templateBinding: check.binding,
                reason: result.reason,
                evidenceReferences: result.evidenceReferences,
              },
            ],
    },
    events: [
      {
        eventId: 'event-1',
        runId: 'run-1',
        eventType: 'experiment.triggered',
        sequence: 1,
        relativeTimestampMs: 10,
        recordedAt: '2026-07-18T00:00:00.010Z',
        schemaVersion: 1,
        payload: {},
      },
    ],
    runnerError: isRunnerError
      ? {
          code: 'journey_step_failed',
          message: 'The saved journey step did not complete.',
          failedStep: null,
          missingVariables: [],
        }
      : null,
    warnings: [],
    artifacts,
    createdAt: '2026-07-18T00:00:00.000Z',
  });
}

function experimentSnapshot() {
  return {
    id: 'version-1',
    experimentId: 'experiment-1',
    projectId: 'project-1',
    journeyId: 'journey-1',
    name: 'Repeated profile save',
    experimentType: 'impatient_user' as const,
    version: 1,
    targetStepId: 'save-profile',
    triggerCount: 2 as const,
    intervalMs: 0 as const,
    networkMatcher: {
      method: 'POST',
      pathname: '/api/profile',
      host: 'localhost:4300',
    },
    assertions: [
      {
        id: 'assertion-1',
        type: 'network_success_max' as const,
        maximum: 1,
        description: 'At most one request succeeds.',
      },
    ],
    continueAfterTarget: false,
    guided: true,
    requestSelectionProvenance: null,
    assertionSelectionProvenance: [],
    outcomeCheckSnapshot: { criticalAction: null, checks: [] },
    journeySnapshot: {
      id: 'journey-1',
      projectId: 'project-1',
      name: 'Create profile v1',
      version: 1,
      steps: [
        {
          id: 'save-profile',
          name: 'Save profile',
          type: 'submit' as const,
          timestamp: 0,
          url: 'http://localhost:4300/protected',
          locator: { strategy: 'data-testid' as const, value: 'profile-form' },
          fingerprint: null,
          value: null,
          sensitive: false,
        },
      ],
      recordingMetadata: {
        recordingSessionId: null,
        recordedAt: '2026-07-18T00:00:00.000Z',
        warningCount: 0,
        normalizationRule: 'test',
      },
      createdAt: '2026-07-18T00:00:00.000Z',
    },
    createdAt: '2026-07-18T00:00:00.000Z',
  };
}

function exactOnceCheck() {
  return {
    id: 'check-1',
    journeyId: 'journey-1',
    criticalActionId: 'critical-action-1',
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
    },
    binding: {
      expression: 'unique.email' as const,
      template: '{{unique.email}}' as const,
      label: 'Unique email',
    },
    createdAt: '2026-07-18T00:00:00.000Z',
  };
}

function outcomeResult(
  status: 'passed' | 'failed' | 'could_not_verify',
  observedCount: number | null,
) {
  return {
    outcomeCheckResultId: 'outcome-result-1',
    runId: 'run-1',
    outcomeCheckId: 'check-1',
    journeyId: 'journey-1',
    criticalActionId: 'critical-action-1',
    type: 'matching_item_appears_exactly_once' as const,
    expected: { visibleMatchCount: 1, template: '{{unique.email}}' },
    observed: { visibleMatchCount: observedCount },
    expectedCount: 1,
    observedCount,
    status,
    reason:
      status === 'passed'
        ? null
        : status === 'failed'
          ? 'Expected exactly one visible matching item; observed 2.'
          : 'The journey did not complete.',
    evidenceReferences: references(),
    templateBinding: {
      expression: 'unique.email' as const,
      template: '{{unique.email}}' as const,
      label: 'Unique email',
    },
    unknowns: [
      'FormCrash did not inspect the application database or hidden backend state.',
    ],
    evaluatedAt: '2026-07-18T00:00:01.000Z',
  };
}

function technicalAssertion(failed = false) {
  return failed
    ? {
        assertionResultId: 'assertion-result-1',
        assertionId: 'assertion-1',
        type: 'network_no_server_errors' as const,
        status: 'failed' as const,
        description: 'No matching response returns HTTP 5xx.',
        expectedDescription: 'No matching response returns HTTP 5xx.',
        observedDescription: '1 matching response returned HTTP 5xx.',
        evaluatedAt: '2026-07-18T00:00:01.000Z',
      }
    : {
        assertionResultId: 'assertion-result-1',
        assertionId: 'assertion-1',
        type: 'network_success_max' as const,
        status: 'passed' as const,
        description: 'At most one request succeeds.',
        expectedDescription: 'No more than 1 matching request succeeds.',
        observedDescription: '1 matching request succeeded.',
        evaluatedAt: '2026-07-18T00:00:01.000Z',
      };
}

function requestObservation() {
  return {
    requestId: 'request-1',
    method: 'POST',
    pathname: '/api/profile',
    origin: 'http://localhost:4300',
    startedAtMs: 10,
    completedAtMs: 20,
    status: 201,
    failed: false,
    matched: true,
  };
}

function serverErrorObservation() {
  return {
    requestId: 'request-2',
    method: 'POST',
    pathname: '/api/profile',
    origin: 'http://localhost:4300',
    startedAtMs: 11,
    completedAtMs: 21,
    status: 500,
    failed: false,
    matched: true,
  };
}

function screenshot(label: 'before-disruption', captureSequence: number) {
  return {
    artifactId: 'screen-1',
    runId: 'run-1',
    artifactType: 'screenshot' as const,
    label,
    relativePath: `artifacts/run-1/${label}.png`,
    mimeType: 'image/png' as const,
    sizeBytes: 10,
    checksumSha256: 'a'.repeat(64),
    captureSequence,
    createdAt: '2026-07-18T00:00:01.000Z',
    metadata: {},
  };
}

function criticalAction() {
  return {
    id: 'critical-action-1',
    journeyId: 'journey-1',
    stepId: 'save-profile',
    label: 'Save profile',
    createdAt: '2026-07-18T00:00:00.000Z',
    updatedAt: '2026-07-18T00:00:00.000Z',
  };
}

function references() {
  return {
    triggerEventIds: ['event-1'],
    requestObservationIds: ['request-1'],
    screenshotArtifactIds: ['screen-1'],
    runnerEventIds: [],
  };
}

function emptyReferences() {
  return {
    triggerEventIds: [],
    requestObservationIds: [],
    screenshotArtifactIds: [],
    runnerEventIds: [],
  };
}
