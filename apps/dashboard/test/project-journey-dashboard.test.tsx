import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { ProjectJourneyDashboard } from '../src/features/projects/components/project-journey-dashboard';
import { FormCrashApiError } from '../src/lib/api-client';

const mocks = vi.hoisted(() => ({
  confirmAuthenticationCapture: vi.fn(),
  createProject: vi.fn(),
  deleteJourney: vi.fn(),
  deleteProject: vi.fn(),
  getProjectSettings: vi.fn(),
  listExternalExperiments: vi.fn(),
  listExternalRuns: vi.fn(),
  getRecording: vi.fn(),
  listJourneys: vi.fn(),
  listProjects: vi.fn(),
  replayJourney: vi.fn(),
  saveJourney: vi.fn(),
  startRecording: vi.fn(),
  startAuthenticationCapture: vi.fn(),
  stopRecording: vi.fn(),
}));

vi.mock('../src/features/projects/api/projects', () => mocks);
vi.mock('../src/features/projects/api/external-experiments', () => ({
  confirmAuthenticationCapture: mocks.confirmAuthenticationCapture,
  getProjectSettings: mocks.getProjectSettings,
  listExternalExperiments: mocks.listExternalExperiments,
  listExternalRuns: mocks.listExternalRuns,
  startAuthenticationCapture: mocks.startAuthenticationCapture,
}));

const project = {
  id: 'project-external',
  name: 'Profile fixture',
  targetUrl: 'http://localhost:4300',
  environment: 'local' as const,
  description: 'Controlled fixture',
  createdAt: '2026-07-16T00:00:00.000Z',
  updatedAt: '2026-07-16T00:00:00.000Z',
};
const step = {
  id: 'step-name',
  name: 'Fill display name',
  type: 'fill' as const,
  timestamp: 100,
  url: project.targetUrl,
  locator: { strategy: 'data-formcrash' as const, value: 'display-name' },
  fingerprint: {
    tagName: 'input',
    inputType: 'text',
    dataFormcrash: 'display-name',
    dataTestId: null,
    id: 'display-name',
    role: 'textbox',
    accessibleName: 'Display name',
    name: 'displayName',
    label: 'Display name',
    text: null,
    cssPath: '#display-name',
  },
  value: { kind: 'safe' as const, value: 'Ada' },
  sensitive: false,
};
const recording = {
  id: 'recording-1',
  projectId: project.id,
  status: 'recording' as const,
  steps: [],
  warnings: [],
  errorMessage: null,
  startedAt: '2026-07-16T00:01:00.000Z',
  completedAt: null,
};
const completed = {
  ...recording,
  status: 'completed' as const,
  steps: [step],
  completedAt: '2026-07-16T00:02:00.000Z',
};
const journey = {
  id: 'journey-1',
  projectId: project.id,
  name: 'Profile journey',
  version: 1,
  steps: [step],
  recordingMetadata: {
    recordingSessionId: recording.id,
    recordedAt: recording.startedAt,
    warningCount: 0,
    normalizationRule: 'Input events are coalesced.',
  },
  createdAt: '2026-07-16T00:03:00.000Z',
};
const awaitingAuthenticationCapture = {
  id: 'capture-1',
  projectId: project.id,
  status: 'awaiting_confirmation' as const,
  errorMessage: null,
  startedAt: '2026-07-16T00:05:00.000Z',
  completedAt: null,
};

beforeEach(() => {
  vi.clearAllMocks();
  mocks.getProjectSettings.mockResolvedValue({
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
    updatedAt: '2026-07-16T00:00:00.000Z',
  });
  mocks.listExternalExperiments.mockResolvedValue([]);
  mocks.listExternalRuns.mockResolvedValue({
    items: [],
    limit: 20,
    offset: 0,
  });
  mocks.listProjects.mockResolvedValue([project]);
  mocks.deleteProject.mockResolvedValue(undefined);
  mocks.listJourneys.mockResolvedValue([]);
  mocks.startRecording.mockResolvedValue(recording);
  mocks.startAuthenticationCapture.mockResolvedValue(
    awaitingAuthenticationCapture,
  );
  mocks.confirmAuthenticationCapture.mockResolvedValue({
    ...awaitingAuthenticationCapture,
    status: 'completed',
    completedAt: '2026-07-16T00:06:00.000Z',
  });
  mocks.stopRecording.mockResolvedValue(completed);
  mocks.saveJourney.mockResolvedValue(journey);
  mocks.replayJourney.mockResolvedValue({
    replayId: 'replay-1',
    journeyId: journey.id,
    status: 'passed',
    failedStep: null,
    startedAt: '2026-07-16T00:04:00.000Z',
    completedAt: '2026-07-16T00:04:01.000Z',
  });
});

describe('external project journey workflow', () => {
  it('selects and bulk deletes multiple projects', async () => {
    const user = userEvent.setup();
    const sample = {
      ...project,
      id: 'project-sample-checkout',
      name: 'Sample Checkout',
    };
    const firstExtra = {
      ...project,
      id: 'extra-one',
      name: 'Extra one',
    };
    const secondExtra = {
      ...project,
      id: 'extra-two',
      name: 'Extra two',
    };
    mocks.listProjects
      .mockResolvedValueOnce([sample, firstExtra, secondExtra])
      .mockResolvedValueOnce([sample]);
    vi.spyOn(window, 'confirm').mockReturnValue(true);

    render(<ProjectJourneyDashboard />);
    await screen.findByText('Saved targets');
    await user.click(screen.getByLabelText('Select all'));
    await user.click(
      screen.getByRole('button', { name: 'Delete selected (2)' }),
    );

    expect(mocks.deleteProject).toHaveBeenNthCalledWith(1, firstExtra.id, true);
    expect(mocks.deleteProject).toHaveBeenNthCalledWith(
      2,
      secondExtra.id,
      true,
    );
    expect(
      screen.queryByRole('button', { name: 'Delete selected (2)' }),
    ).not.toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: /Sample Checkout/ }),
    ).toBeVisible();
  });

  it('deletes an extra project after confirmation', async () => {
    const user = userEvent.setup();
    const extra = {
      ...project,
      id: 'extra-project',
      name: 'Extra target',
    };
    mocks.listProjects
      .mockResolvedValueOnce([project, extra])
      .mockResolvedValueOnce([project]);
    vi.spyOn(window, 'confirm').mockReturnValue(true);

    render(<ProjectJourneyDashboard />);
    await screen.findByText('Saved targets');
    await user.click(
      screen.getByRole('button', { name: 'Delete Extra target extra-pr' }),
    );

    expect(mocks.deleteProject).toHaveBeenCalledWith(extra.id, true);
    expect(
      screen.queryByRole('button', {
        name: 'Delete Extra target extra-pr',
      }),
    ).not.toBeInTheDocument();
  });

  it('creates a project and resets the form after the asynchronous request', async () => {
    const user = userEvent.setup();
    const created = {
      ...project,
      id: 'project-towerdesk',
      name: 'Towerdesk',
      targetUrl: 'https://towerdesk.netlify.app/',
      environment: 'production' as const,
      description: '',
    };
    mocks.createProject.mockResolvedValue(created);
    mocks.listProjects
      .mockResolvedValueOnce([project])
      .mockResolvedValueOnce([project, created]);

    render(<ProjectJourneyDashboard />);
    await screen.findByText('Saved targets');

    const nameInput = screen.getByLabelText('Project name');
    const targetInput = screen.getByLabelText('Target URL');
    await user.type(nameInput, created.name);
    await user.type(targetInput, created.targetUrl);
    await user.click(screen.getByRole('button', { name: 'Create project' }));

    expect(
      await screen.findByRole('heading', { name: created.name }),
    ).toBeVisible();
    expect(nameInput).toHaveValue('');
    expect(targetInput).toHaveValue('');
    expect(mocks.createProject).toHaveBeenCalledWith({
      name: created.name,
      targetUrl: created.targetUrl,
      environment: 'production',
      description: '',
    });
  });

  it('starts, stops, reviews, saves, and replays a captured journey', async () => {
    const user = userEvent.setup();
    render(<ProjectJourneyDashboard />);

    expect((await screen.findAllByText(project.targetUrl))[0]).toBeVisible();
    await user.click(screen.getByRole('button', { name: 'Start recording' }));
    expect(await screen.findByText('recording')).toBeVisible();
    await user.click(screen.getByRole('button', { name: 'Stop recording' }));

    expect(
      await screen.findByRole('heading', { name: 'Inspect before saving' }),
    ).toBeVisible();
    expect(screen.getByText('data-formcrash="display-name"')).toBeVisible();
    const name = screen.getByLabelText('Journey name');
    await user.clear(name);
    await user.type(name, 'Profile journey');
    mocks.listJourneys.mockResolvedValue([journey]);
    await user.click(screen.getByRole('button', { name: 'Save journey' }));

    expect(await screen.findByText('Version 1 · 1 steps')).toBeVisible();
    await user.click(screen.getByRole('button', { name: 'Replay' }));
    expect(await screen.findByText(/Replay passed/)).toBeVisible();
    expect(mocks.saveJourney).toHaveBeenCalledWith(
      project.id,
      recording.id,
      'Profile journey',
      [step],
    );
    expect(mocks.replayJourney).toHaveBeenCalledWith(journey.id, {}, true);
  });

  it('shows the controlled-environment warning and explicit unsupported list', async () => {
    render(<ProjectJourneyDashboard />);
    expect(
      await screen.findByText(/Controlled environments only/),
    ).toBeVisible();
    expect(screen.getByText('Unsupported actions')).toBeVisible();
  });

  it('offers direct authentication recapture when replay detects an expired session', async () => {
    const user = userEvent.setup();
    mocks.listJourneys.mockResolvedValue([journey]);
    mocks.replayJourney.mockRejectedValueOnce(
      new FormCrashApiError(
        409,
        'AUTHENTICATION_REQUIRED',
        'The saved authentication session appears to have expired.',
      ),
    );

    render(<ProjectJourneyDashboard />);

    await user.click(await screen.findByRole('button', { name: 'Replay' }));
    expect(await screen.findByText('Saved session expired')).toBeVisible();

    await user.click(screen.getByRole('button', { name: 'Sign in again' }));
    expect(mocks.startAuthenticationCapture).toHaveBeenCalledWith(project.id);
    await user.click(
      await screen.findByRole('button', {
        name: 'I am signed in — save session',
      }),
    );

    expect(mocks.confirmAuthenticationCapture).toHaveBeenCalledWith(
      project.id,
      awaitingAuthenticationCapture.id,
    );
    expect(
      await screen.findByText(/Authentication was recaptured/),
    ).toBeVisible();
  });
});
