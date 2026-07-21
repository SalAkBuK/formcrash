import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { JourneyWorkspaceScreen } from '../src/features/projects/components/journey-workspace-screen';

const navigation = vi.hoisted(() => ({ push: vi.fn() }));
const projectsApi = vi.hoisted(() => ({
  deleteJourney: vi.fn(),
  getProject: vi.fn(),
  listJourneys: vi.fn(),
  replayJourney: vi.fn(),
}));
const experimentApi = vi.hoisted(() => ({
  cancelAuthenticationCapture: vi.fn(),
  confirmAuthenticationCapture: vi.fn(),
  continueWithoutAuthentication: vi.fn(),
  getProjectSettings: vi.fn(),
  listJourneyExternalTests: vi.fn(),
  runExternalExperiment: vi.fn(),
  saveProductionReplayAcknowledgement: vi.fn(),
  startAuthenticationCapture: vi.fn(),
  testAuthentication: vi.fn(),
}));

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: navigation.push }),
}));
vi.mock('../src/features/projects/api/projects', () => projectsApi);
vi.mock(
  '../src/features/projects/api/external-experiments',
  () => experimentApi,
);

const project = {
  id: 'project-saved-journey',
  name: 'Towerdesk',
  targetUrl: 'https://towerdesk.example/portal',
  environment: 'production' as const,
  description: '',
  createdAt: '2026-07-20T00:00:00.000Z',
  updatedAt: '2026-07-20T00:00:00.000Z',
};
const journey = {
  id: 'journey-add-visitor',
  projectId: project.id,
  name: 'Add Visitor',
  version: 1,
  steps: [
    {
      id: 'open-visitors',
      name: 'Open Visitors',
      type: 'navigate' as const,
      timestamp: 1,
      url: 'https://towerdesk.example/portal/visitors',
      locator: null,
      fingerprint: null,
      value: null,
      sensitive: false,
    },
    {
      id: 'submit-visitor',
      name: 'Submit visitor',
      type: 'submit' as const,
      timestamp: 2,
      url: 'https://towerdesk.example/portal/visitors',
      locator: { strategy: 'css' as const, value: 'form' },
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
const settings = {
  projectId: project.id,
  variables: [],
  beforeRunHook: null,
  afterRunHook: null,
  authentication: {
    configured: true,
    available: true,
    capturedAt: '2026-07-20T00:00:00.000Z',
    missingReason: null,
  },
  productionReplayAcknowledged: true,
  productionReplayAcknowledgedAt: '2026-07-20T00:00:00.000Z',
  updatedAt: '2026-07-20T00:00:00.000Z',
};
const savedTest = {
  id: 'test-version-1',
  experimentId: 'test-double-submit',
  projectId: project.id,
  journeyId: journey.id,
  name: 'Double submit',
  experimentType: 'impatient_user' as const,
  version: 1,
  targetStepId: 'submit-visitor',
  triggerCount: 2 as const,
  intervalMs: 0 as const,
  networkMatcher: null,
  assertions: [
    {
      id: 'visible-result',
      type: 'element_visible' as const,
      description: 'The visitor result should be visible.',
      locator: { strategy: 'css' as const, value: '[data-visitor-result]' },
      targetDescription: 'Visitor result',
    },
  ],
  continueAfterTarget: false,
  guided: true,
  requestSelectionProvenance: null,
  assertionSelectionProvenance: [],
  outcomeCheckSnapshot: { criticalAction: null, checks: [] },
  journeySnapshot: journey,
  createdAt: '2026-07-20T00:30:00.000Z',
};

beforeEach(() => {
  vi.clearAllMocks();
  projectsApi.getProject.mockResolvedValue(project);
  projectsApi.listJourneys.mockResolvedValue([journey]);
  experimentApi.getProjectSettings.mockResolvedValue(settings);
  experimentApi.listJourneyExternalTests.mockResolvedValue([]);
  experimentApi.testAuthentication.mockResolvedValue({
    projectId: project.id,
    status: 'valid',
    outcome: 'authenticated',
    currentUrl: project.targetUrl,
    message: 'Connected.',
    checkedAt: '2026-07-20T00:00:00.000Z',
  });
  experimentApi.saveProductionReplayAcknowledgement.mockImplementation(
    (_projectId: string, acknowledged: boolean) =>
      Promise.resolve({
        ...settings,
        productionReplayAcknowledged: acknowledged,
        productionReplayAcknowledgedAt: acknowledged
          ? '2026-07-20T01:00:00.000Z'
          : null,
      }),
  );
});

describe('saved journey workspace', () => {
  it('keeps the overview focused on the immutable recording', async () => {
    render(
      <JourneyWorkspaceScreen journeyId={journey.id} projectId={project.id} />,
    );

    expect(
      await screen.findByRole('heading', { name: journey.name }),
    ).toBeVisible();
    expect(screen.getByText('What this journey contains')).toBeVisible();
    expect(
      screen.getAllByRole('button', { name: 'Configure test suite' })[0],
    ).toBeVisible();
    expect(screen.queryByText('Outcome Checks')).not.toBeInTheDocument();
    expect(screen.queryByText('Critical Action')).not.toBeInTheDocument();
    expect(screen.queryByText('Replay behavior')).not.toBeInTheDocument();
  });

  it('loads and updates the saved production replay acknowledgement', async () => {
    const user = userEvent.setup();
    render(
      <JourneyWorkspaceScreen
        journeyId={journey.id}
        projectId={project.id}
        view="replay"
      />,
    );

    const acknowledgement = await screen.findByRole('checkbox', {
      name: /Save my acknowledgement that normal replay can change real production data/u,
    });
    expect(acknowledgement).toBeChecked();
    expect(
      screen.getByRole('button', { name: 'Replay journey' }),
    ).toBeEnabled();

    await user.click(acknowledgement);
    await waitFor(() =>
      expect(
        experimentApi.saveProductionReplayAcknowledgement,
      ).toHaveBeenCalledWith(project.id, false),
    );
    expect(acknowledgement).not.toBeChecked();
    expect(
      screen.getByText(
        'Save the production replay acknowledgement to continue.',
      ),
    ).toBeVisible();
  });

  it('lists multiple reusable tests and runs one directly from the journey', async () => {
    const user = userEvent.setup();
    experimentApi.listJourneyExternalTests.mockResolvedValue([
      testSummary(savedTest, latestPassedRun),
      testSummary({
        ...savedTest,
        id: 'test-version-2',
        experimentId: 'test-triple-submit',
        name: 'Triple submit',
        triggerCount: 3,
        intervalMs: 100,
      }),
      testSummary({
        ...savedTest,
        id: 'test-version-3',
        experimentId: 'test-delayed-submit',
        name: 'Delayed submit',
        triggerCount: 2,
        intervalMs: 300,
      }),
    ]);
    experimentApi.runExternalExperiment.mockResolvedValue({ runId: 'run-1' });

    render(
      <JourneyWorkspaceScreen journeyId={journey.id} projectId={project.id} />,
    );

    expect(
      await screen.findByRole('heading', { name: 'Tests using this journey' }),
    ).toBeVisible();
    expect(screen.getAllByText('Double submit').length).toBeGreaterThan(0);
    expect(screen.getAllByText('Triple submit').length).toBeGreaterThan(0);
    expect(screen.getByRole('columnheader', { name: 'Recipe' })).toBeVisible();
    expect(screen.getByRole('columnheader', { name: 'Checks' })).toBeVisible();
    expect(
      screen.getByRole('columnheader', { name: 'Latest result' }),
    ).toBeVisible();
    const rows = screen.getAllByRole('row').slice(1);
    expect(within(rows[0]!).getByText('Double-click')).toBeVisible();
    expect(within(rows[1]!).getByText('Triple-click')).toBeVisible();
    expect(within(rows[2]!).getByText('Delayed repeat')).toBeVisible();
    expect(within(rows[0]!).getByText('Passed')).toBeVisible();
    expect(within(rows[1]!).getByText('Not run')).toBeVisible();
    await user.click(screen.getByRole('button', { name: 'Run Triple submit' }));

    await waitFor(() =>
      expect(experimentApi.runExternalExperiment).toHaveBeenCalledWith(
        'test-version-2',
        {},
        true,
      ),
    );
    expect(navigation.push).toHaveBeenCalledWith('/external-runs/run-1');
  });

  it('exposes clear test, edit, latest-run, and new-suite actions without duplication', async () => {
    const summary = testSummary(savedTest, latestPassedRun);
    experimentApi.listJourneyExternalTests.mockResolvedValue([summary]);

    render(
      <JourneyWorkspaceScreen journeyId={journey.id} projectId={project.id} />,
    );

    expect(
      await screen.findByRole('link', {
        name: 'Open Double submit test details',
      }),
    ).toHaveAttribute(
      'href',
      `/projects/${project.id}/tests/${savedTest.experimentId}`,
    );
    expect(screen.getByRole('link', { name: 'Edit test' })).toHaveAttribute(
      'href',
      `/projects/${project.id}/tests/${savedTest.experimentId}#edit-test`,
    );
    expect(
      screen.getByRole('link', {
        name: 'View latest run details for Double submit',
      }),
    ).toHaveAttribute('href', `/external-runs/${latestPassedRun.runId}`);
    expect(
      screen.getByRole('button', { name: 'New test suite' }),
    ).toBeVisible();
    expect(
      screen.queryByRole('button', { name: /Duplicate/u }),
    ).not.toBeInTheDocument();
    expect(experimentApi.runExternalExperiment).not.toHaveBeenCalled();
  });
});

const latestPassedRun = {
  runId: 'latest-run',
  experimentVersionId: savedTest.id,
  projectId: project.id,
  journeyId: journey.id,
  status: 'passed' as const,
  lifecycleStatus: 'completed' as const,
  outcomeAggregate: 'passed' as const,
  assertionAggregate: 'passed' as const,
  canonicalVerdict: 'passed' as const,
  verdictBasis: 'approved_outcomes_and_technical_checks' as const,
  startedAt: '2026-07-20T01:00:00.000Z',
  completedAt: '2026-07-20T01:00:01.000Z',
  durationMs: 1_000,
  projectName: project.name,
  journeyName: journey.name,
  experimentName: savedTest.name,
  triggerAttempts: 2,
  matchedRequestCount: 0,
  passedAssertionCount: 1,
  assertionCount: 1,
  screenshotCount: 1,
  createdAt: '2026-07-20T01:00:00.000Z',
};

function testSummary(
  version: Omit<typeof savedTest, 'triggerCount' | 'intervalMs'> & {
    readonly triggerCount: 2 | 3;
    readonly intervalMs: 0 | 100 | 300;
  },
  latestRun: typeof latestPassedRun | null = null,
) {
  return {
    testId: version.experimentId,
    projectId: version.projectId,
    journeyId: version.journeyId,
    name: version.name,
    experimentType: version.experimentType,
    latestVersion: version,
    versionCount: 1,
    latestRun,
    runCount: latestRun === null ? 0 : 1,
  };
}
