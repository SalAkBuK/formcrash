import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type {
  ExternalRunComparisonResponse,
  ExternalRunDetail,
  ExternalRunSummary,
} from '@formcrash/contracts';
import { externalRunSummarySchema } from '@formcrash/contracts';

import { ExternalRunComparison } from '../src/features/projects/components/external-run-comparison';

const mocks = vi.hoisted(() => ({
  compareExternalRuns: vi.fn(),
  getExternalArtifactUrl: vi.fn(
    (runId: string, artifactId: string) =>
      `http://localhost:4100/api/external-runs/${runId}/artifacts/${artifactId}`,
  ),
}));

vi.mock('../src/features/projects/api/external-experiments', () => mocks);

describe('external failed-versus-fixed comparison', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.compareExternalRuns.mockResolvedValue(compatibleComparison());
  });

  it('starts from a completed run, filters obvious invalid choices, and leads with verified protection', async () => {
    const user = userEvent.setup();
    const { container } = render(
      <ExternalRunComparison
        beforeRun={beforeRun()}
        runs={[
          summary('before', '2026-07-18T00:00:00.000Z'),
          summary('after', '2026-07-18T00:00:01.000Z'),
          summary('legacy', '2026-07-18T00:00:02.000Z', {
            outcomeAggregate: 'not_configured',
          }),
          summary('running', '2026-07-18T00:00:03.000Z', {
            lifecycleStatus: 'running',
          }),
          summary('other-journey', '2026-07-18T00:00:04.000Z', {
            journeyId: 'journey-2',
          }),
        ]}
      />,
    );

    await user.click(
      screen.getByRole('button', { name: 'Compare with another run' }),
    );
    expect(
      screen.getByRole('option', { name: /After experiment/iu }),
    ).toBeVisible();
    expect(
      screen.queryByRole('option', { name: /Legacy/iu }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole('option', { name: /Running/iu }),
    ).not.toBeInTheDocument();

    await user.selectOptions(screen.getByLabelText('After fix run'), 'after');
    await user.click(
      screen.getByRole('button', { name: 'Compare exact runs' }),
    );

    const compatible = await screen.findByText('Compatible');
    const headline = screen.getByRole('heading', {
      name: 'Repeated-submission protection verified.',
    });
    expect(
      compatible.compareDocumentPosition(headline) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    expect(screen.getByRole('table')).toHaveTextContent(
      'Visible matching results',
    );
    expect(screen.getByRole('table')).toHaveTextContent('2');
    expect(screen.getByRole('table')).toHaveTextContent('1');
    expect(
      screen.getByText(
        'Exactly one profile matching the generated email should appear.',
      ),
    ).toBeVisible();
    expect(screen.getByText('{{unique.email}}')).toBeVisible();
    expect(
      screen.getByRole('img', { name: /Before fix final state/iu }),
    ).toBeVisible();
    expect(screen.getAllByText('Screenshot unavailable')).toHaveLength(4);
    expect(screen.getByText('Database state was not inspected.')).toBeVisible();
    expect(screen.getByText('Technical evidence')).toBeVisible();
    expect(container.textContent).not.toContain(
      'generated-before@example.test',
    );
    expect(mocks.compareExternalRuns).toHaveBeenCalledWith('before', 'after');
  });

  it('renders bounded incompatibility reasons and no proof conclusion', async () => {
    const user = userEvent.setup();
    mocks.compareExternalRuns.mockResolvedValue({
      compatibility: 'incompatible',
      primaryStatus: 'incompatible',
      differences: [
        {
          code: 'different_trigger_count',
          message: 'Failure trigger counts differ.',
        },
      ],
      matchedProperties: [],
      presentation: null,
    } satisfies ExternalRunComparisonResponse);
    renderComparison();

    await startComparison(user);

    expect(await screen.findByText('Incompatible')).toBeVisible();
    expect(screen.getByText('Failure trigger counts differ.')).toBeVisible();
    expect(
      screen.getByText(/did not produce a proof conclusion/iu),
    ).toBeVisible();
    expect(
      screen.queryByText('Repeated-submission protection verified.'),
    ).not.toBeInTheDocument();
  });

  it('renders loading and API error states', async () => {
    const user = userEvent.setup();
    let rejectRequest: ((reason: Error) => void) | undefined;
    mocks.compareExternalRuns.mockReturnValue(
      new Promise((_resolve, reject) => {
        rejectRequest = reject;
      }),
    );
    renderComparison();

    await user.click(
      screen.getByRole('button', { name: 'Compare with another run' }),
    );
    await user.selectOptions(screen.getByLabelText('After fix run'), 'after');
    await user.click(
      screen.getByRole('button', { name: 'Compare exact runs' }),
    );
    expect(
      screen.getByRole('button', { name: 'Checking compatibility…' }),
    ).toBeDisabled();
    rejectRequest?.(new Error('Comparison service unavailable.'));
    expect(
      await screen.findByText('Comparison service unavailable.'),
    ).toHaveAttribute('role', 'alert');
  });

  it('renders a focused empty state when no later eligible run exists', async () => {
    const user = userEvent.setup();
    render(
      <ExternalRunComparison
        beforeRun={beforeRun()}
        runs={[summary('before', '2026-07-18T00:00:00.000Z')]}
      />,
    );

    await user.click(
      screen.getByRole('button', { name: 'Compare with another run' }),
    );
    expect(
      screen.getByText(
        'No later completed run with configured Outcome Checks is available for this journey version.',
      ),
    ).toBeVisible();
    expect(
      screen.queryByRole('button', { name: 'Compare exact runs' }),
    ).not.toBeInTheDocument();
  });
});

function renderComparison() {
  return render(
    <ExternalRunComparison
      beforeRun={beforeRun()}
      runs={[
        summary('before', '2026-07-18T00:00:00.000Z'),
        summary('after', '2026-07-18T00:00:01.000Z'),
      ]}
    />,
  );
}

async function startComparison(user: ReturnType<typeof userEvent.setup>) {
  await user.click(
    screen.getByRole('button', { name: 'Compare with another run' }),
  );
  await user.selectOptions(screen.getByLabelText('After fix run'), 'after');
  await user.click(screen.getByRole('button', { name: 'Compare exact runs' }));
}

function beforeRun(): ExternalRunDetail {
  return {
    runId: 'before',
    projectId: 'project-1',
    journeyId: 'journey-1',
    lifecycleStatus: 'completed',
    createdAt: '2026-07-18T00:00:00.000Z',
  } as ExternalRunDetail;
}

function summary(
  runId: string,
  createdAt: string,
  overrides: Partial<ExternalRunSummary> = {},
): ExternalRunSummary {
  return externalRunSummarySchema.parse({
    runId,
    experimentVersionId: `${runId}-version`,
    projectId: 'project-1',
    journeyId: 'journey-1',
    status: 'passed',
    lifecycleStatus: 'completed',
    outcomeAggregate: runId === 'before' ? 'failed' : 'passed',
    assertionAggregate: 'passed',
    startedAt: createdAt,
    completedAt: new Date(Date.parse(createdAt) + 1_000).toISOString(),
    durationMs: 1_000,
    projectName: 'Profile fixture',
    journeyName: 'Create profile',
    experimentName: `${runId[0]?.toUpperCase()}${runId.slice(1)} experiment`,
    triggerAttempts: 2,
    matchedRequestCount: 1,
    passedAssertionCount: 1,
    assertionCount: 1,
    screenshotCount: 3,
    createdAt,
    ...overrides,
  });
}

function compatibleComparison(): ExternalRunComparisonResponse {
  const emptyEvidence = {
    triggerEventIds: [],
    requestObservationIds: [],
    screenshotArtifactIds: [],
    runnerEventIds: [],
  };
  return {
    compatibility: 'compatible',
    primaryStatus: 'protection_verified',
    differences: [],
    matchedProperties: [
      { key: 'project', label: 'Project', value: 'Profile fixture' },
      {
        key: 'journey_version',
        label: 'Journey version',
        value: 'Create profile v1',
      },
    ],
    presentation: {
      primaryStatus: 'protection_verified',
      headline: 'Repeated-submission protection verified.',
      summary:
        'The same controlled repeated-action experiment failed before the fix and passed after the fix.',
      beforeRun: {
        runId: 'before',
        experimentVersionId: 'before-version',
        label: 'Before fix',
        createdAt: '2026-07-18T00:00:00.000Z',
        completedAt: '2026-07-18T00:00:01.000Z',
        outcomeAggregate: 'failed',
        assertionAggregate: 'failed',
      },
      afterRun: {
        runId: 'after',
        experimentVersionId: 'after-version',
        label: 'After fix',
        createdAt: '2026-07-18T00:00:01.000Z',
        completedAt: '2026-07-18T00:00:02.000Z',
        outcomeAggregate: 'passed',
        assertionAggregate: 'passed',
      },
      criticalAction: {
        id: 'critical-action',
        stepId: 'submit',
        label: 'Save profile',
        recordedStepName: 'Submit profile',
      },
      failureRecipe: {
        type: 'impatient_user',
        targetStepId: 'submit',
        targetStepName: 'Submit profile',
        triggerCount: 2,
        intervalMs: 0,
        continueAfterTarget: false,
      },
      checks: [
        {
          identity: 'check-identity',
          outcomeCheckId: 'check-1',
          type: 'matching_item_appears_exactly_once',
          approvedDescription:
            'Exactly one profile matching the generated email should appear.',
          expectedCondition: {
            kind: 'visible_match_count',
            count: 1,
            description: 'Exactly 1 visible matching result.',
          },
          beforeStatus: 'failed',
          afterStatus: 'passed',
          beforeObservedCondition: {
            kind: 'visible_match_count',
            count: 2,
            description: '2 visible matching results.',
          },
          afterObservedCondition: {
            kind: 'visible_match_count',
            count: 1,
            description: '1 visible matching result.',
          },
          templateBinding: {
            expression: 'unique.email',
            template: '{{unique.email}}',
            label: 'Unique email',
          },
          beforeEvidenceReferences: emptyEvidence,
          afterEvidenceReferences: emptyEvidence,
        },
      ],
      evidenceTable: [
        {
          key: 'critical_action_triggers',
          label: 'Critical-action triggers',
          before: 2,
          after: 2,
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
        { key: 'outcome', label: 'Outcome', before: 'Failed', after: 'Passed' },
      ],
      successfulRequestCounts: null,
      technicalAssertionAggregates: { before: 'failed', after: 'passed' },
      screenshots: [
        { label: 'before-disruption', before: null, after: null },
        { label: 'after-disruption', before: null, after: null },
        {
          label: 'final-result',
          before: {
            artifactId: 'before-final',
            runId: 'before',
            label: 'final-result',
            createdAt: '2026-07-18T00:00:01.000Z',
          },
          after: {
            artifactId: 'after-final',
            runId: 'after',
            label: 'final-result',
            createdAt: '2026-07-18T00:00:02.000Z',
          },
        },
      ],
      configurationIdentity: {
        algorithm: 'sha256',
        fingerprint: 'a'.repeat(64),
      },
      observed: [
        'The Critical Action was triggered 2 times before and 2 times after.',
      ],
      conclusion:
        'The same repeated-submission experiment produced duplicate visible results before the fix and exactly one visible result after the fix.',
      unknowns: [
        'Database state was not inspected.',
        'Hidden backend records or side effects were not evaluated.',
        'FormCrash did not prove which frontend or backend code change caused the result.',
      ],
    },
  };
}
