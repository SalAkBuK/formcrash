import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { TestDetailScreen } from '../src/features/projects/components/test-detail-screen';

const navigation = vi.hoisted(() => ({
  push: vi.fn(),
  replace: vi.fn(),
}));

const api = vi.hoisted(() => ({
  createExternalExperimentVersion: vi.fn(),
  deleteExternalTest: vi.fn(),
  getExternalTestDetail: vi.fn(),
  getProjectSettings: vi.fn(),
  runExternalExperiment: vi.fn(),
  saveProductionReplayAcknowledgement: vi.fn(),
}));

const projects = vi.hoisted(() => ({ getProject: vi.fn() }));

vi.mock('next/navigation', () => ({
  useRouter: () => navigation,
}));
vi.mock('../src/features/projects/api/external-experiments', () => api);
vi.mock('../src/features/projects/api/projects', () => projects);

const project = {
  id: 'project-one',
  name: 'Checkout',
  targetUrl: 'http://localhost:4300/checkout',
  environment: 'local' as const,
  description: '',
  createdAt: '2026-07-20T00:00:00.000Z',
  updatedAt: '2026-07-20T00:00:00.000Z',
};

const journey = {
  id: 'journey-one',
  projectId: project.id,
  name: 'Place order',
  version: 1,
  steps: [
    {
      id: 'place-order',
      name: 'Place order',
      type: 'click' as const,
      timestamp: 1,
      url: project.targetUrl,
      locator: {
        strategy: 'role' as const,
        role: 'button',
        name: 'Place order',
      },
      fingerprint: null,
      value: null,
      sensitive: false,
    },
  ],
  recordingMetadata: {
    recordingSessionId: null,
    recordedAt: '2026-07-20T00:00:00.000Z',
    warningCount: 0,
    normalizationRule: 'test',
  },
  createdAt: '2026-07-20T00:00:00.000Z',
};

const versionOne = {
  id: 'version-one',
  experimentId: 'stable-test-one',
  projectId: project.id,
  journeyId: journey.id,
  name: 'Double submit',
  experimentType: 'impatient_user' as const,
  version: 1,
  targetStepId: 'place-order',
  triggerCount: 2 as const,
  intervalMs: 0 as const,
  networkMatcher: null,
  assertions: [],
  continueAfterTarget: false,
  guided: true,
  requestSelectionProvenance: null,
  assertionSelectionProvenance: [],
  outcomeCheckSnapshot: {
    criticalAction: {
      id: 'critical-action-one',
      journeyId: journey.id,
      stepId: 'place-order',
      label: 'Place order',
      createdAt: '2026-07-20T00:00:00.000Z',
      updatedAt: '2026-07-20T00:00:00.000Z',
    },
    checks: [
      {
        id: 'outcome-one',
        journeyId: journey.id,
        criticalActionId: 'critical-action-one',
        type: 'final_pathname_matches' as const,
        description: 'The receipt page should be visible.',
        expectedPathname: '/receipt',
        createdAt: '2026-07-20T00:00:00.000Z',
      },
    ],
  },
  journeySnapshot: journey,
  createdAt: '2026-07-20T00:00:00.000Z',
};

const versionTwo = {
  ...versionOne,
  id: 'version-two',
  version: 2,
  triggerCount: 3 as const,
  intervalMs: 300 as const,
  createdAt: '2026-07-20T00:01:00.000Z',
};

const latestRun = {
  runId: 'run-one',
  experimentVersionId: versionOne.id,
  projectId: project.id,
  journeyId: journey.id,
  status: 'passed' as const,
  lifecycleStatus: 'completed' as const,
  outcomeAggregate: 'passed' as const,
  assertionAggregate: 'not_configured' as const,
  canonicalVerdict: 'passed' as const,
  verdictBasis: 'approved_outcomes_only' as const,
  startedAt: '2026-07-20T00:02:00.000Z',
  completedAt: '2026-07-20T00:02:01.000Z',
  durationMs: 1_000,
  projectName: project.name,
  journeyName: journey.name,
  experimentName: versionOne.name,
  triggerAttempts: 2,
  matchedRequestCount: 0,
  passedAssertionCount: 0,
  assertionCount: 0,
  screenshotCount: 1,
  createdAt: '2026-07-20T00:02:00.000Z',
};

beforeEach(() => {
  vi.clearAllMocks();
  projects.getProject.mockResolvedValue(project);
  api.getProjectSettings.mockResolvedValue({
    projectId: project.id,
    variables: [],
    beforeRunHook: null,
    afterRunHook: null,
    authentication: {
      configured: false,
      available: false,
      capturedAt: null,
      missingReason: null,
    },
    updatedAt: '2026-07-20T00:00:00.000Z',
  });
  api.getExternalTestDetail.mockResolvedValue({
    testId: versionOne.experimentId,
    projectId: project.id,
    journeyId: journey.id,
    name: versionOne.name,
    experimentType: versionOne.experimentType,
    latestVersion: versionOne,
    versionCount: 1,
    latestRun,
    runCount: 1,
    versions: [versionOne],
    runs: [latestRun],
  });
  api.createExternalExperimentVersion.mockResolvedValue(versionTwo);
  api.deleteExternalTest.mockResolvedValue(undefined);
});

describe('stable test detail and immutable editing', () => {
  it('redirects a historical version link to the stable test route', async () => {
    render(<TestDetailScreen testId={versionOne.id} projectId={project.id} />);

    expect(await screen.findByText('Double submit')).toBeVisible();
    expect(
      screen.getByRole('link', {
        name: 'Open Place order journey version 1',
      }),
    ).toHaveAttribute('href', `/projects/${project.id}/journeys/${journey.id}`);
    expect(navigation.replace).toHaveBeenCalledWith(
      `/projects/${project.id}/tests/${versionOne.experimentId}`,
    );
    expect(screen.getByText('Immutable configurations')).toBeVisible();
    expect(
      screen.getByText('The receipt page should be visible.'),
    ).toBeVisible();
    expect(screen.getByText('1 saved run')).toBeVisible();
    expect(screen.getByRole('link', { name: 'Passed' })).toHaveAttribute(
      'href',
      `/external-runs/${latestRun.runId}`,
    );
  });

  it('edits by creating the next version without changing identity or running', async () => {
    const user = userEvent.setup();
    render(
      <TestDetailScreen
        testId={versionOne.experimentId}
        projectId={project.id}
      />,
    );

    await user.click(await screen.findByRole('button', { name: 'Edit test' }));
    await user.selectOptions(
      screen.getByLabelText('Edited trigger count'),
      '3',
    );
    await user.selectOptions(
      screen.getByLabelText('Edited trigger interval'),
      '300',
    );
    await user.click(screen.getByText(/Technical checks \(optional\)/u));
    await user.click(
      screen.getByRole('button', { name: 'Add technical check' }),
    );
    await user.type(
      screen.getByLabelText('Technical check 1 text'),
      'Order saved',
    );
    await user.click(screen.getByRole('button', { name: 'Save new version' }));

    await waitFor(() =>
      expect(api.createExternalExperimentVersion).toHaveBeenCalledWith(
        versionOne.experimentId,
        expect.objectContaining({
          triggerCount: 3,
          intervalMs: 300,
          assertions: [
            expect.objectContaining({
              type: 'text_appeared',
              text: 'Order saved',
            }),
          ],
        }),
      ),
    );
    expect(api.runExternalExperiment).not.toHaveBeenCalled();
    expect(navigation.replace).toHaveBeenCalledWith(
      `/projects/${project.id}/tests/${versionOne.experimentId}`,
    );
    expect((await screen.findAllByText('Version 2')).length).toBeGreaterThan(0);
  });

  it('regenerates approved recipe checks when an edit changes trigger timing', async () => {
    const approvedVersion = {
      ...versionOne,
      networkMatcher: {
        method: 'POST',
        pathname: '/api/orders',
        host: 'localhost:4300',
      },
      assertions: [
        {
          id: 'recipe-network-duplicate_action-request-max',
          type: 'network_request_max' as const,
          maximum: 2,
          description: 'No more than two requests.',
        },
        {
          id: 'recipe-network-duplicate_action-success-max',
          type: 'network_success_max' as const,
          maximum: 1,
          description: 'At most one success.',
        },
        {
          id: 'recipe-network-duplicate_action-no-5xx',
          type: 'network_no_server_errors' as const,
          description: 'No server errors.',
        },
      ],
      networkEvidenceProvenance: {
        source: 'recording' as const,
        sourceRunId: null,
        actionStepId: 'place-order',
        candidateId: 'request-0123456789abcdef01234567',
        candidateScore: 90,
        candidateConfidence: 'high' as const,
        recommendationReasons: [
          {
            code: 'mutation_method' as const,
            label: 'POST can change state.',
            scoreImpact: 50,
          },
        ],
        matcher: {
          method: 'POST',
          pathname: '/api/orders',
          host: 'localhost:4300',
        },
        observedStatus: 201,
        observedFailed: false,
        relativeTimestampMs: 12,
        observedAt: '2026-07-20T00:00:00.000Z',
        approvedAt: '2026-07-20T00:01:00.000Z',
      },
    };
    api.getExternalTestDetail.mockResolvedValueOnce({
      testId: approvedVersion.experimentId,
      projectId: project.id,
      journeyId: journey.id,
      name: approvedVersion.name,
      experimentType: approvedVersion.experimentType,
      latestVersion: approvedVersion,
      versionCount: 1,
      latestRun,
      runCount: 1,
      versions: [approvedVersion],
      runs: [latestRun],
    });
    api.createExternalExperimentVersion.mockResolvedValueOnce({
      ...approvedVersion,
      id: 'approved-version-two',
      version: 2,
      triggerCount: 3,
      intervalMs: 100,
    });
    const user = userEvent.setup();
    render(
      <TestDetailScreen
        testId={approvedVersion.experimentId}
        projectId={project.id}
      />,
    );

    await user.click(await screen.findByRole('button', { name: 'Edit test' }));
    await user.selectOptions(
      screen.getByLabelText('Edited trigger count'),
      '3',
    );
    await user.selectOptions(
      screen.getByLabelText('Edited trigger interval'),
      '100',
    );
    await user.click(screen.getByRole('button', { name: 'Save new version' }));

    await waitFor(() =>
      expect(api.createExternalExperimentVersion).toHaveBeenCalledWith(
        approvedVersion.experimentId,
        expect.objectContaining({
          triggerCount: 3,
          intervalMs: 100,
          assertions: [
            expect.objectContaining({
              type: 'network_request_max',
              maximum: 3,
            }),
            expect.objectContaining({
              type: 'network_success_max',
              maximum: 1,
            }),
            expect.objectContaining({ type: 'network_no_server_errors' }),
          ],
          networkEvidenceProvenance: approvedVersion.networkEvidenceProvenance,
        }),
      ),
    );
  });

  it('deletes the stable test and all of its immutable history', async () => {
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(true);
    const user = userEvent.setup();
    render(
      <TestDetailScreen
        testId={versionOne.experimentId}
        projectId={project.id}
      />,
    );

    await user.click(await screen.findByText('Test administration'));
    await user.click(screen.getByRole('button', { name: 'Delete test' }));

    expect(confirm).toHaveBeenCalledWith(
      expect.stringContaining(
        'Delete test "Double submit" and all 1 saved version, 1 run, and screenshots?',
      ),
    );
    await waitFor(() =>
      expect(api.deleteExternalTest).toHaveBeenCalledWith(
        versionOne.experimentId,
      ),
    );
    expect(navigation.push).toHaveBeenCalledWith(
      `/projects/${project.id}/tests`,
    );
  });
});
