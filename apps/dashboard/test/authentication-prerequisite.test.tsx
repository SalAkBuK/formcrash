import { StrictMode } from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { PersistedJourney } from '@formcrash/contracts';

import { JourneyRecordingScreen } from '../src/features/projects/components/journey-recording-screen';
import { JourneyWorkspaceScreen } from '../src/features/projects/components/journey-workspace-screen';
import { OutcomeDefinitionPanel } from '../src/features/projects/components/outcome-definition-panel';

const navigation = vi.hoisted(() => ({ push: vi.fn() }));
const projectsApi = vi.hoisted(() => ({
  approveCriticalAction: vi.fn(),
  approveOutcomeCheck: vi.fn(),
  closeOutcomeCapture: vi.fn(),
  deleteOutcomeCheck: vi.fn(),
  deleteJourney: vi.fn(),
  getActiveRecording: vi.fn(),
  getActiveOutcomeCapture: vi.fn(),
  getCriticalAction: vi.fn(),
  getOutcomeCapture: vi.fn(),
  getProject: vi.fn(),
  getRecording: vi.fn(),
  listJourneys: vi.fn(),
  listOutcomeChecks: vi.fn(),
  replayJourney: vi.fn(),
  saveJourney: vi.fn(),
  startRecording: vi.fn(),
  startOutcomeCapture: vi.fn(),
  stopRecording: vi.fn(),
}));
const authenticationApi = vi.hoisted(() => ({
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
  () => authenticationApi,
);
vi.mock('../src/features/projects/components/saved-journey-detail', () => ({
  SavedJourneyDetail: ({
    journeys,
    onReplay,
  }: {
    readonly journeys: readonly PersistedJourney[];
    readonly onReplay: (journey: PersistedJourney) => void;
  }) => (
    <button onClick={() => onReplay(journeys[0]!)} type="button">
      Replay journey
    </button>
  ),
}));

const project = {
  id: 'project-auth',
  name: 'Protected checkout',
  targetUrl: 'http://localhost:4300/checkout',
  environment: 'staging' as const,
  description: '',
  createdAt: '2026-07-19T00:00:00.000Z',
  updatedAt: '2026-07-19T00:00:00.000Z',
};
const journey: PersistedJourney = {
  id: 'journey-auth',
  projectId: project.id,
  name: 'Place order',
  version: 1,
  steps: [
    {
      id: 'submit-order',
      name: 'Place order',
      type: 'submit',
      timestamp: 1,
      url: project.targetUrl,
      locator: { strategy: 'id', value: 'checkout' },
      fingerprint: null,
      value: null,
      sensitive: false,
    },
  ],
  recordingMetadata: {
    recordingSessionId: null,
    recordedAt: '2026-07-19T00:00:00.000Z',
    warningCount: 0,
    normalizationRule: 'test',
  },
  createdAt: '2026-07-19T00:00:00.000Z',
};
const settings = {
  projectId: project.id,
  variables: [],
  beforeRunHook: null,
  afterRunHook: null,
  authentication: {
    configured: false,
    available: false,
    capturedAt: null,
    missingReason: null,
    requirement: 'required' as const,
    verification: 'not_checked' as const,
    lastCheckedAt: '2026-07-19T00:00:00.000Z',
  },
  updatedAt: '2026-07-19T00:00:00.000Z',
};
const required = {
  projectId: project.id,
  status: 'invalid' as const,
  outcome: 'authentication_required' as const,
  currentUrl: 'http://localhost:4300/login',
  message: 'Sign-in is required.',
  checkedAt: '2026-07-19T00:00:00.000Z',
};
const expired = {
  ...required,
  outcome: 'authentication_expired' as const,
  message: 'The saved session expired.',
};
const authenticated = {
  projectId: project.id,
  status: 'valid' as const,
  outcome: 'authenticated' as const,
  currentUrl: project.targetUrl,
  message: 'Connected.',
  checkedAt: '2026-07-19T00:01:00.000Z',
};
const publicAccess = {
  ...authenticated,
  outcome: 'target_accessible' as const,
  message:
    'The configured URL loaded without redirecting to a recognized sign-in page. Protected areas may still require authentication.',
};
const userConfirmedPublicSettings = {
  ...settings,
  authentication: {
    ...settings.authentication,
    requirement: 'user_confirmed_public' as const,
    verification: 'not_checked' as const,
    lastCheckedAt: null,
  },
};
const capture = {
  id: 'capture-auth',
  projectId: project.id,
  status: 'awaiting_confirmation' as const,
  errorMessage: null,
  startedAt: '2026-07-19T00:00:30.000Z',
  completedAt: null,
};

beforeEach(() => {
  vi.clearAllMocks();
  projectsApi.getProject.mockResolvedValue(project);
  projectsApi.listJourneys.mockResolvedValue([journey]);
  projectsApi.getCriticalAction.mockResolvedValue({
    id: 'action-auth',
    journeyId: journey.id,
    stepId: 'submit-order',
    label: 'Place order',
    createdAt: '2026-07-19T00:00:00.000Z',
    updatedAt: '2026-07-19T00:00:00.000Z',
  });
  projectsApi.listOutcomeChecks.mockResolvedValue([]);
  projectsApi.getActiveOutcomeCapture.mockResolvedValue(null);
  projectsApi.getActiveRecording.mockResolvedValue(null);
  projectsApi.startRecording.mockResolvedValue({
    id: 'recording-auth',
    projectId: project.id,
    status: 'recording',
    steps: [],
    warnings: [],
    errorMessage: null,
    startedAt: '2026-07-19T00:02:00.000Z',
    completedAt: null,
  });
  projectsApi.replayJourney.mockResolvedValue({
    replayId: 'replay-auth',
    journeyId: journey.id,
    status: 'passed',
    failedStep: null,
    startedAt: '2026-07-19T00:02:00.000Z',
    completedAt: '2026-07-19T00:02:01.000Z',
  });
  authenticationApi.getProjectSettings.mockResolvedValue(settings);
  authenticationApi.listJourneyExternalTests.mockResolvedValue([]);
  authenticationApi.startAuthenticationCapture.mockResolvedValue(capture);
  authenticationApi.confirmAuthenticationCapture.mockResolvedValue({
    ...capture,
    status: 'completed',
    completedAt: '2026-07-19T00:01:00.000Z',
  });
  authenticationApi.continueWithoutAuthentication.mockResolvedValue(
    userConfirmedPublicSettings,
  );
});

describe('authentication prerequisites', () => {
  it('reconnects to an active recording after refresh without running authentication again', async () => {
    projectsApi.getActiveRecording.mockResolvedValue({
      id: 'recording-auth',
      projectId: project.id,
      status: 'recording',
      steps: [],
      warnings: [],
      errorMessage: null,
      startedAt: '2026-07-19T00:02:00.000Z',
      completedAt: null,
    });

    render(<JourneyRecordingScreen projectId={project.id} />);

    expect(await screen.findByText('Recording reconnected.')).toBeVisible();
    expect(
      screen.getByRole('button', { name: 'Start recording' }),
    ).toBeDisabled();
    expect(
      screen.getByRole('button', { name: 'Stop recording' }),
    ).toBeEnabled();
    expect(authenticationApi.testAuthentication).not.toHaveBeenCalled();
    expect(projectsApi.startRecording).not.toHaveBeenCalled();
  });

  it('blocks recording until capture completes and requires an explicit start', async () => {
    const user = userEvent.setup();
    authenticationApi.testAuthentication
      .mockResolvedValueOnce(required)
      .mockResolvedValueOnce(authenticated);

    render(<JourneyRecordingScreen projectId={project.id} />);
    await user.click(
      await screen.findByRole('button', { name: 'Start recording' }),
    );

    expect(await screen.findByText('Sign-in required')).toBeVisible();
    expect(projectsApi.startRecording).not.toHaveBeenCalled();
    expect(navigation.push).not.toHaveBeenCalled();

    await user.click(screen.getByRole('button', { name: 'Capture sign-in' }));
    await user.click(
      await screen.findByRole('button', { name: 'Save signed-in session' }),
    );

    expect(await screen.findByText('Authentication saved')).toBeVisible();
    expect(projectsApi.startRecording).not.toHaveBeenCalled();
    await user.click(
      screen.getAllByRole('button', { name: 'Start recording' })[0]!,
    );
    await waitFor(() =>
      expect(projectsApi.startRecording).toHaveBeenCalledOnce(),
    );
  });

  it('allows only a user-confirmed public journey and starts recording exactly once in Strict Mode', async () => {
    const user = userEvent.setup();
    authenticationApi.testAuthentication.mockResolvedValue(publicAccess);
    authenticationApi.getProjectSettings.mockResolvedValue(
      userConfirmedPublicSettings,
    );

    render(
      <StrictMode>
        <JourneyRecordingScreen projectId={project.id} />
      </StrictMode>,
    );
    await user.click(
      await screen.findByRole('button', { name: 'Start recording' }),
    );

    await waitFor(() =>
      expect(projectsApi.startRecording).toHaveBeenCalledOnce(),
    );
    expect(authenticationApi.testAuthentication).toHaveBeenCalledOnce();
  });

  it('does not infer a public decision and preserves recording for explicit retry', async () => {
    const user = userEvent.setup();
    authenticationApi.testAuthentication.mockResolvedValue(publicAccess);
    authenticationApi.getProjectSettings.mockResolvedValue({
      ...settings,
      authentication: {
        ...settings.authentication,
        requirement: 'unknown',
      },
    });

    render(<JourneyRecordingScreen projectId={project.id} />);
    await user.click(
      await screen.findByRole('button', { name: 'Start recording' }),
    );

    expect(
      await screen.findByText('Choose authentication setup'),
    ).toBeVisible();
    expect(projectsApi.startRecording).not.toHaveBeenCalled();
    expect(
      authenticationApi.continueWithoutAuthentication,
    ).not.toHaveBeenCalled();

    await user.click(
      screen.getByRole('button', { name: 'Continue without sign-in' }),
    );
    expect(await screen.findByText('Continue without sign-in?')).toBeVisible();
    expect(
      authenticationApi.continueWithoutAuthentication,
    ).not.toHaveBeenCalled();
    await user.click(
      screen.getAllByRole('button', { name: 'Continue without sign-in' })[0]!,
    );

    expect(await screen.findByText('Ready to continue')).toBeVisible();
    expect(
      authenticationApi.continueWithoutAuthentication,
    ).toHaveBeenCalledOnce();
    expect(projectsApi.startRecording).not.toHaveBeenCalled();
    await user.click(
      screen.getAllByRole('button', { name: 'Start recording' })[0]!,
    );
    await waitFor(() =>
      expect(projectsApi.startRecording).toHaveBeenCalledOnce(),
    );
  });

  it('uses valid saved authentication to proceed directly to recording', async () => {
    const user = userEvent.setup();
    authenticationApi.testAuthentication.mockResolvedValue(authenticated);
    render(<JourneyRecordingScreen projectId={project.id} />);

    await user.click(
      await screen.findByRole('button', { name: 'Start recording' }),
    );

    await waitFor(() =>
      expect(projectsApi.startRecording).toHaveBeenCalledOnce(),
    );
    expect(screen.queryByText('Sign-in required')).not.toBeInTheDocument();
  });

  it('preserves an expired replay across capture, rerender, and explicit retry', async () => {
    const user = userEvent.setup();
    authenticationApi.testAuthentication
      .mockResolvedValueOnce(expired)
      .mockResolvedValueOnce(authenticated);
    const view = render(
      <JourneyWorkspaceScreen
        journeyId={journey.id}
        projectId={project.id}
        view="replay"
      />,
    );

    await user.click(
      await screen.findByRole('button', { name: 'Replay journey' }),
    );
    expect(await screen.findByText('Authentication expired')).toBeVisible();
    expect(projectsApi.replayJourney).not.toHaveBeenCalled();
    expect(navigation.push).not.toHaveBeenCalled();

    view.rerender(
      <JourneyWorkspaceScreen
        journeyId={journey.id}
        projectId={project.id}
        view="replay"
      />,
    );
    expect(authenticationApi.testAuthentication).toHaveBeenCalledOnce();

    await user.click(
      screen.getByRole('button', { name: 'Capture sign-in again' }),
    );
    await user.click(
      await screen.findByRole('button', { name: 'Save signed-in session' }),
    );
    expect(await screen.findByText('Authentication saved')).toBeVisible();
    expect(projectsApi.replayJourney).not.toHaveBeenCalled();

    await user.click(screen.getByRole('button', { name: 'Retry replay' }));
    await waitFor(() =>
      expect(projectsApi.replayJourney).toHaveBeenCalledOnce(),
    );
    expect(navigation.push).not.toHaveBeenCalled();
  });

  it('does not start an outcome baseline before authentication succeeds', async () => {
    const user = userEvent.setup();
    authenticationApi.testAuthentication.mockResolvedValue(required);
    render(
      <OutcomeDefinitionPanel
        confirmProduction={true}
        disabled={false}
        environment="staging"
        journey={journey}
        presentation="wizard"
        runtimeValues={{}}
      />,
    );

    const baseline = await screen.findByRole('button', {
      name: 'Replay journey and choose result',
    });
    await waitFor(() => expect(baseline).toBeEnabled());
    await user.click(baseline);

    expect(await screen.findByText('Sign-in required')).toBeVisible();
    expect(projectsApi.startOutcomeCapture).not.toHaveBeenCalled();
  });

  it('clears a pending operation when the user cancels', async () => {
    const user = userEvent.setup();
    authenticationApi.testAuthentication.mockResolvedValue(required);
    render(<JourneyRecordingScreen projectId={project.id} />);

    await user.click(
      await screen.findByRole('button', { name: 'Start recording' }),
    );
    expect(await screen.findByText('Sign-in required')).toBeVisible();
    await user.click(screen.getByRole('button', { name: 'Cancel' }));

    await waitFor(() =>
      expect(screen.queryByText('Sign-in required')).not.toBeInTheDocument(),
    );
    expect(projectsApi.startRecording).not.toHaveBeenCalled();
  });
});
