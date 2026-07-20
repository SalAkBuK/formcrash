import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type {
  ExternalExperimentVersion,
  ExternalRunSummary,
  PersistedJourney,
  Project,
  ProjectExecutionSettings,
} from '@formcrash/contracts';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { ProjectOverviewScreen } from '../src/features/projects/components/project-overview-screen';
import { ProjectRunsScreen } from '../src/features/projects/components/project-runs-screen';
import { ProjectScenariosScreen } from '../src/features/projects/components/project-scenarios-screen';
import { ProjectSettingsScreen } from '../src/features/projects/components/project-settings-screen';
import type {
  ProjectCrmData,
  ScenarioLineage,
} from '../src/features/projects/components/crm-project-data';

const navigation = vi.hoisted(() => ({ push: vi.fn() }));
const projectsApi = vi.hoisted(() => ({ getProject: vi.fn() }));
const experimentApi = vi.hoisted(() => ({
  clearAuthentication: vi.fn(),
  compareExternalRuns: vi.fn(),
  confirmAuthenticationCapture: vi.fn(),
  continueWithoutAuthentication: vi.fn(),
  getProjectSettings: vi.fn(),
  listExternalRuns: vi.fn(),
  listProjectExternalExperiments: vi.fn(),
  saveProjectSettings: vi.fn(),
  startAuthenticationCapture: vi.fn(),
  testAuthentication: vi.fn(),
}));
const crmApi = vi.hoisted(() => ({
  loadProjectCrmData: vi.fn(),
  loadScenarioLineages: vi.fn(),
}));

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: navigation.push }),
}));
vi.mock('../src/features/projects/api/projects', async (importOriginal) => ({
  ...(await importOriginal()),
  getProject: projectsApi.getProject,
}));
vi.mock(
  '../src/features/projects/api/external-experiments',
  async (importOriginal) => ({
    ...(await importOriginal()),
    ...experimentApi,
  }),
);
vi.mock(
  '../src/features/projects/components/crm-project-data',
  async (importOriginal) => ({
    ...(await importOriginal()),
    loadProjectCrmData: crmApi.loadProjectCrmData,
    loadScenarioLineages: crmApi.loadScenarioLineages,
  }),
);

const project: Project = {
  id: 'project-one',
  name: 'Account portal',
  targetUrl: 'http://localhost:4300',
  environment: 'local',
  description: 'Controlled account fixture',
  createdAt: '2026-07-01T00:00:00.000Z',
  updatedAt: '2026-07-05T00:00:00.000Z',
};
const selectedJourney: PersistedJourney = {
  id: 'journey-v2',
  projectId: project.id,
  name: 'Register visitor',
  version: 2,
  steps: [],
  recordingMetadata: {
    recordingSessionId: null,
    recordedAt: '2026-07-02T00:00:00.000Z',
    warningCount: 0,
    normalizationRule: 'test',
  },
  createdAt: '2026-07-02T00:00:00.000Z',
};
const configuration: ExternalExperimentVersion = {
  id: 'configuration-v1',
  experimentId: 'configuration',
  projectId: project.id,
  journeyId: selectedJourney.id,
  name: 'Duplicate registration',
  experimentType: 'impatient_user',
  version: 1,
  targetStepId: 'submit',
  triggerCount: 2,
  intervalMs: 100,
  networkMatcher: null,
  assertions: [],
  continueAfterTarget: false,
  guided: true,
  requestSelectionProvenance: null,
  assertionSelectionProvenance: [],
  journeySnapshot: selectedJourney,
  createdAt: '2026-07-03T00:00:00.000Z',
};
const persistedRun: ExternalRunSummary = {
  runId: 'run-one',
  experimentVersionId: configuration.id,
  projectId: project.id,
  journeyId: selectedJourney.id,
  status: 'failed',
  lifecycleStatus: 'completed',
  outcomeAggregate: 'failed',
  assertionAggregate: 'failed',
  startedAt: '2026-07-04T00:00:00.000Z',
  completedAt: '2026-07-04T00:00:01.000Z',
  durationMs: 1000,
  projectName: project.name,
  journeyName: selectedJourney.name,
  experimentName: configuration.name,
  triggerAttempts: 2,
  matchedRequestCount: 2,
  passedAssertionCount: 0,
  assertionCount: 1,
  screenshotCount: 3,
  createdAt: '2026-07-04T00:00:00.000Z',
};
const settings: ProjectExecutionSettings = {
  projectId: project.id,
  variables: [
    {
      name: 'TEST_EMAIL',
      secret: true,
      description: 'Disposable account',
      template: '{{unique.email}}',
      environmentName: 'FORMCRASH_TEST_EMAIL',
      configured: false,
    },
  ],
  beforeRunHook: {
    method: 'POST',
    url: 'http://localhost:4300/reset',
    headers: { Authorization: 'Bearer hidden-hook-value' },
    body: null,
    timeoutMs: 5000,
  },
  afterRunHook: null,
  authentication: {
    configured: true,
    available: true,
    capturedAt: '2026-07-01T00:00:00.000Z',
    missingReason: null,
    requirement: 'required',
    verification: 'valid',
    lastCheckedAt: '2026-07-01T00:00:00.000Z',
  },
  updatedAt: '2026-07-01T00:00:00.000Z',
};

beforeEach(() => {
  vi.clearAllMocks();
  projectsApi.getProject.mockResolvedValue(project);
  experimentApi.getProjectSettings.mockResolvedValue(settings);
  experimentApi.listExternalRuns.mockResolvedValue({
    items: [persistedRun],
    limit: 100,
    offset: 0,
  });
  experimentApi.listProjectExternalExperiments.mockResolvedValue([
    configuration,
  ]);
  experimentApi.compareExternalRuns.mockResolvedValue({
    compatibility: 'compatible',
  });
  experimentApi.saveProjectSettings.mockResolvedValue(settings);
  experimentApi.clearAuthentication.mockResolvedValue({
    ...settings,
    authentication: {
      configured: false,
      available: false,
      capturedAt: null,
      missingReason: null,
    },
  });
  experimentApi.startAuthenticationCapture.mockResolvedValue({
    id: 'capture-one',
    projectId: project.id,
    status: 'awaiting_confirmation',
    errorMessage: null,
    startedAt: '2026-07-01T00:00:00.000Z',
    completedAt: null,
  });
  experimentApi.testAuthentication.mockResolvedValue({
    projectId: project.id,
    status: 'valid',
    currentUrl: project.targetUrl,
    message: 'Authentication is valid.',
    checkedAt: '2026-07-01T00:00:00.000Z',
  });
  crmApi.loadScenarioLineages.mockResolvedValue([scenario()]);
  crmApi.loadProjectCrmData.mockResolvedValue(projectData());
});

describe('CRM project surfaces', () => {
  it('renders the focused Overview with real status, recent records, and no KPI metrics', async () => {
    render(<ProjectOverviewScreen projectId={project.id} />);

    expect(
      await screen.findByRole('heading', { name: 'Overview' }),
    ).toBeVisible();
    expect(
      screen.getByRole('link', { name: 'Run Scenario Again' }),
    ).toHaveAttribute(
      'href',
      `/projects/${project.id}/tests/${configuration.id}`,
    );
    expect(screen.getAllByText('Signed in').length).toBeGreaterThan(0);
    expect(screen.getAllByText(selectedJourney.name).length).toBeGreaterThan(0);
    expect(screen.getByText('Project controls')).toBeVisible();
    expect(screen.queryByLabelText('Project metrics')).not.toBeInTheDocument();
    expect(
      screen.queryByText(/security score|notification/i),
    ).not.toBeInTheDocument();
    expect(screen.getAllByRole('main')).toHaveLength(1);
    expect(screen.getAllByText('Signed in').length).toBeGreaterThan(0);
    expect(screen.getByRole('button', { name: 'Test session' })).toBeVisible();
  });

  it('surfaces required authentication and capture on the project overview', async () => {
    crmApi.loadProjectCrmData.mockResolvedValue({
      ...projectData(),
      settings: {
        status: 'available',
        value: {
          ...settings,
          authentication: {
            configured: false,
            available: false,
            capturedAt: null,
            missingReason: null,
            requirement: 'required',
            verification: 'not_checked',
            lastCheckedAt: '2026-07-01T00:00:00.000Z',
          },
        },
      },
    });

    render(<ProjectOverviewScreen projectId={project.id} />);

    expect(
      (await screen.findAllByText('Sign-in required')).length,
    ).toBeGreaterThan(0);
    expect(
      screen.getByText(
        'Required before FormCrash can record or replay protected journeys.',
      ),
    ).toBeVisible();
    expect(
      screen.getByRole('button', { name: 'Capture sign-in' }),
    ).toBeVisible();
  });

  it('requires an explicit confirmation before continuing without sign-in', async () => {
    const user = userEvent.setup();
    const publicSettings: ProjectExecutionSettings = {
      ...settings,
      authentication: {
        configured: false,
        available: false,
        capturedAt: null,
        missingReason: null,
        requirement: 'user_confirmed_public',
        verification: 'not_checked',
        lastCheckedAt: null,
      },
    };
    crmApi.loadProjectCrmData.mockResolvedValue({
      ...projectData(),
      settings: {
        status: 'available',
        value: {
          ...publicSettings,
          authentication: {
            ...publicSettings.authentication,
            requirement: 'unknown',
            verification: 'not_checked',
          },
        },
      },
    });
    experimentApi.continueWithoutAuthentication.mockResolvedValue(
      publicSettings,
    );

    render(<ProjectOverviewScreen projectId={project.id} />);
    expect(
      (await screen.findAllByText('Not configured')).length,
    ).toBeGreaterThan(0);
    expect(
      screen.getByText('Does the journey you want to test require sign-in?'),
    ).toBeVisible();
    expect(
      screen.getByRole('button', { name: 'Capture sign-in' }),
    ).toBeVisible();
    await user.click(
      await screen.findByRole('button', {
        name: 'Continue without sign-in',
      }),
    );

    expect(await screen.findByText('Continue without sign-in?')).toBeVisible();
    expect(experimentApi.continueWithoutAuthentication).not.toHaveBeenCalled();
    await user.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(experimentApi.continueWithoutAuthentication).not.toHaveBeenCalled();

    await user.click(
      screen.getByRole('button', { name: 'Continue without sign-in' }),
    );
    await user.click(
      screen.getAllByRole('button', { name: 'Continue without sign-in' })[0]!,
    );

    expect(
      (await screen.findAllByText('Continuing without sign-in')).length,
    ).toBeGreaterThan(0);
    expect(experimentApi.continueWithoutAuthentication).toHaveBeenCalledOnce();
    expect(
      screen.getByRole('button', { name: 'Capture sign-in' }),
    ).toBeVisible();
  });

  it('treats a legacy inferred public state as not configured', async () => {
    crmApi.loadProjectCrmData.mockResolvedValue({
      ...projectData(),
      settings: {
        status: 'available',
        value: {
          ...settings,
          authentication: {
            configured: false,
            available: false,
            capturedAt: null,
            missingReason: null,
            requirement: 'not_required',
            verification: 'valid',
            lastCheckedAt: '2026-07-01T01:00:00.000Z',
          },
        },
      },
    });

    render(<ProjectOverviewScreen projectId={project.id} />);

    expect(
      (await screen.findAllByText('Not configured')).length,
    ).toBeGreaterThan(0);
    expect(screen.queryByText('Not required')).not.toBeInTheDocument();
    expect(experimentApi.testAuthentication).not.toHaveBeenCalled();
  });

  it('renders Scenario columns and preserves partial rows truthfully', async () => {
    crmApi.loadScenarioLineages.mockResolvedValue([
      {
        ...scenario(),
        criticalAction: { status: 'unavailable', reason: 'Unavailable' },
        configurationDataAvailable: false,
        runDataAvailable: false,
        setupState: 'unavailable',
      },
    ]);
    render(<ProjectScenariosScreen projectId={project.id} />);

    expect(
      await screen.findByRole('heading', { name: 'Scenarios' }),
    ).toBeVisible();
    const table = screen.getByRole('table');
    expect(within(table).getByText('Recorded-flow version')).toBeVisible();
    expect(within(table).getByText('Critical Action')).toBeVisible();
    expect(within(table).getByText('Outcome Checks')).toBeVisible();
    expect(within(table).getAllByText('Unavailable').length).toBeGreaterThan(1);
    expect(screen.getByText(/Some derived Scenario fields/)).toBeVisible();
    expect(screen.getByRole('link', { name: 'Open' })).toHaveAttribute(
      'href',
      `/projects/${project.id}/journeys/${selectedJourney.id}`,
    );
  });

  it('renders a truthful empty Scenario state', async () => {
    crmApi.loadScenarioLineages.mockResolvedValue([]);
    render(<ProjectScenariosScreen projectId={project.id} />);
    expect(await screen.findByText('No Scenarios recorded')).toBeVisible();
    expect(
      screen.getAllByRole('link', { name: 'Record Scenario' }),
    ).not.toHaveLength(0);
  });

  it('renders persisted Runs with Scenario terminology and canonical result links', async () => {
    render(<ProjectRunsScreen projectId={project.id} />);

    expect(await screen.findByRole('heading', { name: 'Runs' })).toBeVisible();
    expect(screen.getByText('Recorded-flow version')).toBeVisible();
    expect(screen.getByText('Version 2')).toBeVisible();
    expect(screen.getAllByText('Failed').at(-1)).toBeVisible();
    expect(screen.getAllByRole('link', { name: 'Inspect' })[0]).toHaveAttribute(
      'href',
      `/external-runs/${persistedRun.runId}`,
    );
    expect(screen.queryByText('Journey')).not.toBeInTheDocument();
  });

  it('shows comparison availability only after the existing comparator confirms it', async () => {
    const older = {
      ...persistedRun,
      runId: 'run-older',
      startedAt: '2026-07-03T00:00:00.000Z',
    };
    experimentApi.listExternalRuns.mockResolvedValue({
      items: [persistedRun, older],
      limit: 100,
      offset: 0,
    });
    render(<ProjectRunsScreen projectId={project.id} />);

    expect(await screen.findByText('Available')).toBeVisible();
    expect(experimentApi.compareExternalRuns).toHaveBeenCalledWith(
      older.runId,
      persistedRun.runId,
    );
  });

  it('keeps Settings actions, read-only target state, and secret-safe summaries', async () => {
    const user = userEvent.setup();
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    render(<ProjectSettingsScreen projectId={project.id} />);

    expect(
      await screen.findByRole('heading', { name: 'Settings' }),
    ).toBeVisible();
    expect(
      screen.getByText('Read-only · no project update API is available'),
    ).toBeVisible();
    expect(screen.getByText('Saved authentication available')).toBeVisible();
    expect(
      screen.getByRole('button', { name: 'Recapture authentication' }),
    ).toBeVisible();
    expect(screen.getByRole('button', { name: 'Test session' })).toBeVisible();
    expect(screen.getByRole('button', { name: 'Clear session' })).toBeVisible();
    expect(screen.getByText('Exclusive ownership')).toBeVisible();
    expect(screen.getByText('Unsupported boundary')).toBeVisible();
    expect(document.body.textContent).not.toContain('hidden-hook-value');

    await user.click(screen.getByText('Edit preparation hook JSON'));
    expect(
      screen.getByLabelText<HTMLTextAreaElement>('Preparation hook JSON').value,
    ).toContain('hidden-hook-value');
    await user.click(screen.getByRole('button', { name: 'Save settings' }));
    await waitFor(() =>
      expect(experimentApi.saveProjectSettings).toHaveBeenCalled(),
    );

    await user.click(screen.getByRole('button', { name: 'Test session' }));
    await waitFor(() =>
      expect(experimentApi.testAuthentication).toHaveBeenCalled(),
    );
    await user.click(screen.getByRole('button', { name: 'Clear session' }));
    await waitFor(() =>
      expect(experimentApi.clearAuthentication).toHaveBeenCalled(),
    );
  });
});

function scenario(): ScenarioLineage {
  return {
    name: selectedJourney.name,
    versions: [selectedJourney],
    selectedJourney,
    criticalAction: {
      status: 'available',
      value: {
        id: 'critical-one',
        journeyId: selectedJourney.id,
        stepId: 'submit',
        label: 'Submit form',
        createdAt: '2026-07-01T00:00:00.000Z',
        updatedAt: '2026-07-01T00:00:00.000Z',
      },
    },
    outcomeChecks: { status: 'available', value: [{}] as never[] },
    configurations: [configuration],
    configurationDataAvailable: true,
    configurationCount: 1,
    latestCompatibleRun: persistedRun,
    runDataAvailable: true,
    setupState: 'ready',
    updatedAt: persistedRun.startedAt,
  };
}

function projectData(): ProjectCrmData {
  return {
    project,
    settings: { status: 'available', value: settings },
    journeys: { status: 'available', value: [selectedJourney] },
    experiments: { status: 'available', value: [configuration] },
    runs: { status: 'available', value: [persistedRun] },
    scenarios: { status: 'available', value: [scenario()] },
    lastActivity: persistedRun.startedAt,
  };
}
