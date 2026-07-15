import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { ExternalExperimentPanel } from '../src/features/projects/components/external-experiment-panel';

const mocks = vi.hoisted(() => ({
  clearAuthentication: vi.fn(),
  confirmAuthenticationCapture: vi.fn(),
  createExternalExperiment: vi.fn(),
  discoverRequests: vi.fn(),
  getProjectSettings: vi.fn(),
  listExternalExperiments: vi.fn(),
  runExternalExperiment: vi.fn(),
  saveProjectSettings: vi.fn(),
  startAuthenticationCapture: vi.fn(),
}));

vi.mock('../src/features/projects/api/external-experiments', () => mocks);

const project = {
  id: 'project-1',
  name: 'Authenticated fixture',
  targetUrl: 'http://localhost:4300/protected',
  description: '',
  createdAt: '2026-07-16T00:00:00.000Z',
  updatedAt: '2026-07-16T00:00:00.000Z',
};
const journey = {
  id: 'journey-1',
  projectId: project.id,
  name: 'Create profile',
  version: 1,
  steps: [
    {
      id: 'fill-name',
      name: 'Fill name',
      type: 'fill' as const,
      timestamp: 0,
      url: project.targetUrl,
      locator: { strategy: 'id' as const, value: 'name' },
      fingerprint: null,
      value: { kind: 'safe' as const, value: '{{unique.email}}' },
      sensitive: false,
    },
    {
      id: 'submit-profile',
      name: 'Submit profile',
      type: 'submit' as const,
      timestamp: 1,
      url: project.targetUrl,
      locator: { strategy: 'data-testid' as const, value: 'profile-form' },
      fingerprint: null,
      value: null,
      sensitive: false,
    },
  ],
  recordingMetadata: {
    recordingSessionId: null,
    recordedAt: '2026-07-16T00:00:00.000Z',
    warningCount: 0,
    normalizationRule: 'test',
  },
  createdAt: '2026-07-16T00:00:00.000Z',
};
const settings = {
  projectId: project.id,
  variables: [
    {
      name: 'SECRET_TOKEN',
      secret: true,
      description: 'Runtime token',
      template: null,
      environmentName: 'FORMCRASH_VAR_SECRET_TOKEN',
      configured: false,
    },
  ],
  beforeRunHook: null,
  afterRunHook: null,
  authentication: {
    configured: false,
    available: false,
    capturedAt: null,
    missingReason: null,
  },
  updatedAt: '2026-07-16T00:00:00.000Z',
};
const version = {
  id: 'version-1',
  experimentId: 'experiment-1',
  projectId: project.id,
  journeyId: journey.id,
  name: 'Impatient submit',
  experimentType: 'impatient_user' as const,
  version: 1,
  targetStepId: 'submit-profile',
  triggerCount: 2 as const,
  intervalMs: 0 as const,
  networkMatcher: {
    method: 'POST',
    pathname: '/api/profile',
    host: 'localhost:4300',
  },
  assertions: [
    {
      id: 'max-one',
      type: 'network_request_max' as const,
      maximum: 1,
      description: 'At most one request.',
    },
  ],
  continueAfterTarget: false,
  journeySnapshot: journey,
  createdAt: '2026-07-16T00:00:00.000Z',
};

beforeEach(() => {
  vi.clearAllMocks();
  mocks.getProjectSettings.mockResolvedValue(settings);
  mocks.listExternalExperiments.mockResolvedValue([version]);
  mocks.discoverRequests.mockResolvedValue({
    journeyId: journey.id,
    targetStepId: 'submit-profile',
    candidates: [
      {
        method: 'POST',
        pathname: '/api/profile',
        origin: 'http://localhost:4300',
        status: 201,
        relativeTimestampMs: 4,
        occurrences: 1,
      },
    ],
  });
  mocks.createExternalExperiment.mockResolvedValue(version);
  mocks.runExternalExperiment.mockResolvedValue({
    runId: 'run-1',
    status: 'passed',
    assertions: [
      {
        assertionResultId: 'result-1',
        assertionId: 'max-one',
        type: 'network_request_max',
        status: 'passed',
        description: 'At most one request.',
        expectedDescription: 'No more than one.',
        observedDescription: '1 matching browser request occurred.',
        evaluatedAt: '2026-07-16T00:00:01.000Z',
      },
    ],
    runnerError: null,
    warnings: [],
    networkObservations: [{ matched: true }],
    artifacts: [{ artifactId: 'screen-1' }],
  });
});

describe('external experiment dashboard workflow', () => {
  it('configures discovery, an immutable version, runtime values and a prominent result', async () => {
    const user = userEvent.setup();
    render(<ExternalExperimentPanel project={project} journeys={[journey]} />);

    expect(
      await screen.findByRole('heading', {
        name: 'Authentication and runtime inputs',
      }),
    ).toBeVisible();
    expect(screen.getByText('Create Failure Experiment')).toBeVisible();
    const target = screen.getByLabelText('Target step');
    expect(
      Array.from((target as HTMLSelectElement).options).find(
        (option) => option.value === 'fill-name',
      )?.disabled,
    ).toBe(true);

    await user.type(screen.getByLabelText('SECRET_TOKEN'), 'runtime-only');
    await user.click(screen.getByRole('button', { name: 'Discover requests' }));
    expect(
      await screen.findByRole('option', {
        name: 'POST /api/profile — 201 · 1x',
      }),
    ).toBeVisible();
    await user.selectOptions(
      screen.getByLabelText('Optional network matcher'),
      '0',
    );
    await user.click(
      screen.getByRole('button', {
        name: 'Save immutable experiment version',
      }),
    );
    await waitFor(() =>
      expect(mocks.createExternalExperiment).toHaveBeenCalledWith(
        journey.id,
        expect.objectContaining({
          targetStepId: 'submit-profile',
          triggerCount: 2,
          networkMatcher: {
            method: 'POST',
            pathname: '/api/profile',
            host: 'localhost:4300',
          },
        }),
      ),
    );

    await user.click(screen.getByRole('button', { name: 'Run' }));
    expect(
      await screen.findByRole('heading', { name: 'passed' }),
    ).toBeVisible();
    expect(screen.getByText('1/1 assertions passed')).toBeVisible();
    expect(mocks.runExternalExperiment).toHaveBeenCalledWith('version-1', {
      SECRET_TOKEN: 'runtime-only',
    });
  });
});
