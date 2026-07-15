import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { ProjectJourneyDashboard } from '../src/features/projects/components/project-journey-dashboard';

const mocks = vi.hoisted(() => ({
  createProject: vi.fn(),
  getRecording: vi.fn(),
  listJourneys: vi.fn(),
  listProjects: vi.fn(),
  replayJourney: vi.fn(),
  saveJourney: vi.fn(),
  startRecording: vi.fn(),
  stopRecording: vi.fn(),
}));

vi.mock('../src/features/projects/api/projects', () => mocks);

const project = {
  id: 'project-external',
  name: 'Profile fixture',
  targetUrl: 'http://localhost:4300',
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

beforeEach(() => {
  vi.clearAllMocks();
  mocks.listProjects.mockResolvedValue([project]);
  mocks.listJourneys.mockResolvedValue([]);
  mocks.startRecording.mockResolvedValue(recording);
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
  });

  it('shows the controlled-environment warning and explicit unsupported list', async () => {
    render(<ProjectJourneyDashboard />);
    expect(
      await screen.findByText(/Controlled environments only/),
    ).toBeVisible();
    expect(screen.getByText('Unsupported actions')).toBeVisible();
  });
});
