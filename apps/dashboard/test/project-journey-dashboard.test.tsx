import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { ProjectJourneyDashboard } from '../src/features/projects/components/project-journey-dashboard';
import { FormCrashApiError } from '../src/lib/api-client';

const mocks = vi.hoisted(() => ({
  approveCriticalAction: vi.fn(),
  approveOutcomeCheck: vi.fn(),
  closeOutcomeCapture: vi.fn(),
  confirmAuthenticationCapture: vi.fn(),
  createProject: vi.fn(),
  deleteOutcomeCheck: vi.fn(),
  deleteJourney: vi.fn(),
  deleteProject: vi.fn(),
  getCriticalAction: vi.fn(),
  getActiveOutcomeCapture: vi.fn(),
  getOutcomeCapture: vi.fn(),
  getProjectSettings: vi.fn(),
  listExternalExperiments: vi.fn(),
  listExternalRuns: vi.fn(),
  getRecording: vi.fn(),
  listJourneys: vi.fn(),
  listOutcomeChecks: vi.fn(),
  listProjects: vi.fn(),
  replayJourney: vi.fn(),
  saveJourney: vi.fn(),
  startRecording: vi.fn(),
  startAuthenticationCapture: vi.fn(),
  startOutcomeCapture: vi.fn(),
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
  mocks.getCriticalAction.mockResolvedValue(null);
  mocks.getActiveOutcomeCapture.mockResolvedValue(null);
  mocks.listOutcomeChecks.mockResolvedValue([]);
  mocks.deleteOutcomeCheck.mockResolvedValue(undefined);
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
  it('summarizes the selected project from persisted project state', async () => {
    mocks.listJourneys.mockResolvedValue([journey]);
    mocks.getProjectSettings.mockResolvedValue({
      projectId: project.id,
      variables: [],
      beforeRunHook: null,
      afterRunHook: null,
      authentication: {
        configured: true,
        available: true,
        capturedAt: '2026-07-16T00:06:00.000Z',
        missingReason: null,
      },
      updatedAt: '2026-07-16T00:06:00.000Z',
    });

    render(<ProjectJourneyDashboard />);

    expect(
      await screen.findByRole('heading', { name: 'Project overview' }),
    ).toBeVisible();
    expect(await screen.findByText('1 journey')).toBeVisible();
    expect(screen.getByText('Saved state available')).toBeVisible();
    expect(
      screen.getByRole('link', { name: 'Record a journey' }),
    ).toHaveAttribute('href', '#recording-workspace');
  });

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

    expect(
      await screen.findByRole('heading', { name: 'Profile journey' }),
    ).toBeVisible();
    expect(screen.getByLabelText('Journey version')).toHaveValue(journey.id);
    expect(screen.getAllByText('1 step').length).toBeGreaterThan(0);
    await user.click(screen.getByRole('button', { name: 'Replay' }));
    expect(await screen.findByText(/Replay passed/)).toBeVisible();
    expect(mocks.saveJourney).toHaveBeenCalledWith(
      project.id,
      recording.id,
      'Profile journey',
      [step],
    );
    expect(mocks.replayJourney).toHaveBeenCalledWith(
      journey.id,
      {},
      true,
      'adaptive',
      'recorded',
    );
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
    expect(await screen.findAllByText('Needs replacement')).not.toHaveLength(0);
    expect(
      screen.getByText(/saved authentication session appears to have expired/u),
    ).toBeVisible();

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

  it('recovers an open baseline capture after dashboard refresh', async () => {
    const user = userEvent.setup();
    const submitStep = {
      ...step,
      id: 'submit-profile',
      name: 'Save profile',
      type: 'submit' as const,
      locator: { strategy: 'data-testid' as const, value: 'profile-form' },
      value: null,
    };
    const outcomeJourney = { ...journey, steps: [step, submitStep] };
    const action = {
      id: 'critical-action-1',
      journeyId: journey.id,
      stepId: submitStep.id,
      label: 'Save profile',
      createdAt: '2026-07-17T00:00:00.000Z',
      updatedAt: '2026-07-17T00:00:00.000Z',
    };
    mocks.listJourneys.mockResolvedValue([outcomeJourney]);
    mocks.getCriticalAction.mockResolvedValue(action);
    const activeCapture = {
      id: 'outcome-capture-1',
      journeyId: journey.id,
      criticalActionId: action.id,
      generatedInputs: [
        {
          stepId: step.id,
          stepName: step.name,
          expression: 'unique.name',
          template: '{{unique.name}}',
          label: 'Generated unique name',
        },
      ],
      status: 'awaiting_selection',
      selectedTarget: null,
      selectionWarnings: [],
      finalPathname: '/complete',
      errorMessage: null,
      startedAt: '2026-07-17T00:01:00.000Z',
      expiresAt: '2026-07-17T00:11:00.000Z',
      completedAt: null,
    };
    mocks.getActiveOutcomeCapture.mockResolvedValue(activeCapture);
    mocks.getOutcomeCapture.mockResolvedValue(activeCapture);

    render(<ProjectJourneyDashboard />);
    await screen.findByRole('heading', { name: outcomeJourney.name });
    const detailOutcome = document.querySelector(
      '#journey-outcome-configuration',
    );
    expect(detailOutcome).not.toBeNull();
    const outcome = within(detailOutcome as HTMLElement);
    await user.click(
      outcome.getByText('Define Critical Action and Outcome Checks'),
    );

    expect(await outcome.findByText('awaiting_selection')).toBeVisible();
    expect(outcome.getByText(/Chromium is waiting/u)).toBeVisible();
    expect(
      outcome.getByRole('button', { name: 'Start outcome baseline' }),
    ).toBeDisabled();
  });

  it('approves a Critical Action and saves a generated exactly-once Outcome Check', async () => {
    const user = userEvent.setup();
    const submitStep = {
      ...step,
      id: 'submit-profile',
      name: 'Save profile',
      type: 'submit' as const,
      timestamp: 200,
      locator: { strategy: 'data-testid' as const, value: 'profile-form' },
      fingerprint: {
        ...step.fingerprint,
        tagName: 'form',
        inputType: null,
        dataFormcrash: null,
        dataTestId: 'profile-form',
        id: 'profile-form',
        role: 'form',
        accessibleName: 'Profile form',
        name: 'profile-form',
        label: null,
        cssPath: '#profile-form',
      },
      value: null,
    };
    const outcomeJourney = {
      ...journey,
      steps: [step, submitStep],
    };
    const action = {
      id: 'critical-action-1',
      journeyId: journey.id,
      stepId: submitStep.id,
      label: 'Save profile',
      createdAt: '2026-07-17T00:00:00.000Z',
      updatedAt: '2026-07-17T00:00:00.000Z',
    };
    const target = {
      locator: {
        strategy: 'data-formcrash' as const,
        value: 'profile-result',
      },
      fingerprint: {
        tagName: 'li',
        dataFormcrash: 'profile-result',
        dataTestId: null,
        id: null,
        role: 'listitem',
        accessibleName: 'Profile {{unique.email}}',
        name: null,
        cssPath: 'li',
      },
      preview: 'Profile {{unique.email}}',
      reliability: 'high' as const,
      warnings: [],
      generatedBindings: [
        {
          expression: 'unique.email' as const,
          template: '{{unique.email}}' as const,
          label: 'Generated unique email',
        },
      ],
    };
    const capture = {
      id: 'outcome-capture-1',
      journeyId: journey.id,
      criticalActionId: action.id,
      generatedInputs: [
        {
          stepId: step.id,
          stepName: step.name,
          expression: 'unique.name' as const,
          template: '{{unique.name}}',
          label: 'Generated unique name',
        },
        {
          stepId: 'fill-email',
          stepName: 'Fill unique email',
          expression: 'unique.email' as const,
          template: '{{unique.email}}',
          label: 'Generated unique email',
        },
      ],
      status: 'selection_ready' as const,
      selectedTarget: target,
      selectionWarnings: [],
      finalPathname: '/complete',
      errorMessage: null,
      startedAt: '2026-07-17T00:01:00.000Z',
      expiresAt: '2026-07-17T00:11:00.000Z',
      completedAt: null,
    };
    const savedCheck = {
      id: 'outcome-check-1',
      journeyId: journey.id,
      criticalActionId: action.id,
      type: 'matching_item_appears_exactly_once' as const,
      description: 'Exactly one matching item should appear.',
      target,
      binding: target.generatedBindings[0]!,
      createdAt: '2026-07-17T00:02:00.000Z',
    };
    mocks.listJourneys.mockResolvedValue([outcomeJourney]);
    mocks.approveCriticalAction.mockResolvedValue(action);
    mocks.startOutcomeCapture.mockResolvedValue(capture);
    mocks.getOutcomeCapture.mockResolvedValue(capture);
    mocks.approveOutcomeCheck.mockResolvedValue(savedCheck);
    mocks.closeOutcomeCapture.mockResolvedValue({
      ...capture,
      status: 'completed',
      completedAt: '2026-07-17T00:03:00.000Z',
    });

    render(<ProjectJourneyDashboard />);
    await screen.findByRole('heading', { name: outcomeJourney.name });
    const detailOutcome = document.querySelector(
      '#journey-outcome-configuration',
    );
    expect(detailOutcome).not.toBeNull();
    const outcome = within(detailOutcome as HTMLElement);
    await user.click(
      outcome.getByText('Define Critical Action and Outcome Checks'),
    );
    expect(
      outcome.getByText(/send state-changing requests and create test data/u),
    ).toBeVisible();
    expect(
      outcome.getByText(/controlled non-production environment/u),
    ).toBeVisible();
    await user.click(
      outcome.getByRole('button', { name: 'Approve Critical Action' }),
    );
    expect(mocks.approveCriticalAction).toHaveBeenCalledWith(
      journey.id,
      submitStep.id,
      'Save profile',
    );

    await user.click(
      outcome.getByRole('button', { name: 'Start outcome baseline' }),
    );
    expect(await outcome.findByText('Profile {{unique.email}}')).toBeVisible();
    expect(outcome.getByText('Fill unique email')).toBeVisible();
    expect(
      outcome.getByText(/resolved run-specific literal.*not persisted/u),
    ).toBeVisible();
    await user.click(outcome.getByRole('button', { name: 'Approve check' }));

    expect(mocks.approveOutcomeCheck).toHaveBeenCalledWith(capture.id, {
      type: 'matching_item_appears_exactly_once',
      description: 'Exactly one matching item should appear.',
      bindingExpression: 'unique.email',
    });
    expect(
      await outcome.findByText(
        'Exactly one result matching {{unique.email}} should appear.',
      ),
    ).toBeVisible();

    await user.click(outcome.getByRole('button', { name: 'Finish capture' }));
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    await user.click(
      outcome.getByRole('button', { name: 'Remove and recapture' }),
    );
    await waitFor(() =>
      expect(mocks.deleteOutcomeCheck).toHaveBeenCalledWith(
        journey.id,
        savedCheck.id,
      ),
    );
    expect(
      await outcome.findByText('No Outcome Checks saved yet.'),
    ).toBeVisible();
  });
});
