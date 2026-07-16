import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { CreateExternalExperimentRequest } from '@formcrash/contracts';

import { ExternalExperimentPanel } from '../src/features/projects/components/external-experiment-panel';

const mocks = vi.hoisted(() => ({
  clearAuthentication: vi.fn(),
  confirmAuthenticationCapture: vi.fn(),
  createExternalExperiment: vi.fn(),
  deleteExternalExperimentVersion: vi.fn(),
  deleteExternalRun: vi.fn(),
  discoverRequests: vi.fn(),
  getExternalArtifactUrl: vi.fn(),
  getExternalRun: vi.fn(),
  getProjectSettings: vi.fn(),
  listExternalExperiments: vi.fn(),
  listExternalRuns: vi.fn(),
  runExternalExperiment: vi.fn(),
  saveProjectSettings: vi.fn(),
  startAuthenticationCapture: vi.fn(),
  testAuthentication: vi.fn(),
}));

vi.mock('../src/features/projects/api/external-experiments', () => mocks);

const project = {
  id: 'project-1',
  name: 'Authenticated fixture',
  targetUrl: 'http://localhost:4300/protected',
  environment: 'staging' as const,
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
      fingerprint: {
        tagName: 'input',
        inputType: 'text',
        dataFormcrash: null,
        dataTestId: null,
        id: 'name',
        role: 'textbox',
        accessibleName: 'Name',
        name: 'name',
        label: 'Name',
        text: null,
        cssPath: '#name',
      },
      value: { kind: 'safe' as const, value: 'Ada' },
      sensitive: false,
    },
    {
      id: 'fill-token',
      name: 'Fill token',
      type: 'fill' as const,
      timestamp: 0.5,
      url: project.targetUrl,
      locator: { strategy: 'id' as const, value: 'token' },
      fingerprint: null,
      value: {
        kind: 'sensitive' as const,
        variableName: 'SECRET_TOKEN',
      },
      sensitive: true,
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
  guided: false,
  requestSelectionProvenance: null,
  journeySnapshot: journey,
  createdAt: '2026-07-16T00:00:00.000Z',
};

beforeEach(() => {
  vi.clearAllMocks();
  mocks.getExternalArtifactUrl.mockReturnValue(
    'http://localhost:4100/api/external-runs/run-1/artifacts/screen-1',
  );
  mocks.getProjectSettings.mockResolvedValue(settings);
  mocks.listExternalExperiments.mockResolvedValue([version]);
  mocks.listExternalRuns.mockResolvedValue({
    items: [],
    limit: 20,
    offset: 0,
  });
  mocks.discoverRequests.mockResolvedValue({
    discoveryId: '11111111-2222-4333-8444-555555555555',
    discoveredAt: '2026-07-16T00:00:00.000Z',
    journeyId: journey.id,
    targetStepId: 'submit-profile',
    candidates: [
      {
        candidateId: 'request-111111111111111111111111',
        rank: 2,
        score: 33,
        classification: 'background_refresh',
        confidence: 'review',
        recommended: false,
        reasons: [
          {
            code: 'read_only_method',
            label: 'GET is normally read-only.',
            scoreImpact: -25,
          },
          {
            code: 'background_refresh',
            label: 'Request resembles a list refresh.',
            scoreImpact: -30,
          },
        ],
        method: 'GET',
        pathname: '/api/profile',
        origin: 'http://localhost:4300',
        status: 200,
        failed: false,
        relativeTimestampMs: 2,
        occurrences: 1,
      },
      {
        candidateId: 'request-222222222222222222222222',
        rank: 1,
        score: 108,
        classification: 'likely_business_mutation',
        confidence: 'high',
        recommended: true,
        reasons: [
          {
            code: 'mutation_method',
            label: 'POST can change server state.',
            scoreImpact: 50,
          },
          {
            code: 'same_origin',
            label: 'Request uses the target application origin.',
            scoreImpact: 20,
          },
        ],
        method: 'POST',
        pathname: '/api/profile',
        origin: 'http://localhost:4300',
        status: 201,
        failed: false,
        relativeTimestampMs: 4,
        occurrences: 1,
      },
    ],
    recommendation: {
      outcome: 'recommended',
      recommendedCandidateId: 'request-222222222222222222222222',
      explanation:
        'FormCrash found one same-origin successful state-changing request with a clear evidence lead.',
    },
  });
  mocks.createExternalExperiment.mockResolvedValue(version);
  const runResult = {
    runId: 'run-1',
    experimentVersionId: version.id,
    projectId: project.id,
    journeyId: journey.id,
    status: 'passed',
    startedAt: '2026-07-16T00:00:00.000Z',
    completedAt: '2026-07-16T00:00:01.000Z',
    durationMs: 1_000,
    targetUrl: project.targetUrl,
    projectName: project.name,
    journeyName: journey.name,
    experimentName: version.name,
    experimentSnapshot: version,
    resolvedValues: {},
    triggerAttempts: 2,
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
    networkObservations: [
      {
        requestId: 'request-1',
        method: 'POST',
        pathname: '/api/profile',
        origin: 'http://localhost:4300',
        startedAtMs: 10,
        completedAtMs: 20,
        status: 201,
        failed: false,
        matched: true,
      },
    ],
    events: [],
    artifacts: [
      {
        artifactId: 'screen-1',
        runId: 'run-1',
        artifactType: 'screenshot',
        label: 'final-result',
        relativePath: 'artifacts/run-1/final-result.png',
        mimeType: 'image/png',
        sizeBytes: 10,
        checksumSha256: 'a'.repeat(64),
        captureSequence: 1,
        createdAt: '2026-07-16T00:00:01.000Z',
        metadata: {},
      },
    ],
    createdAt: '2026-07-16T00:00:00.000Z',
  };
  mocks.getExternalRun.mockResolvedValue(runResult);
  mocks.runExternalExperiment.mockResolvedValue(runResult);
});

describe('external experiment dashboard workflow', () => {
  it('shows a concrete first-test tutorial when no journey exists', async () => {
    render(<ExternalExperimentPanel project={project} journeys={[]} />);

    expect(
      await screen.findByRole('heading', {
        name: 'Set up your first guided test',
      }),
    ).toBeVisible();
    expect(
      screen.getByRole('link', { name: 'Go to journey recording' }),
    ).toHaveAttribute('href', '#recording-workspace');
    expect(
      screen.getByRole('button', { name: 'Set up authentication' }),
    ).toBeVisible();
  });

  it('guides a user from a journey to a recommended test and explains the result', async () => {
    const user = userEvent.setup();
    render(<ExternalExperimentPanel project={project} journeys={[journey]} />);

    expect(
      await screen.findByRole('heading', {
        name: 'Test a recorded action without configuring the technical details',
      }),
    ).toBeVisible();
    expect(screen.getByLabelText('Guided target action')).toHaveValue(
      'submit-profile',
    );
    expect(
      screen.getByText('1 required runtime value(s) are missing'),
    ).toBeVisible();
    expect(
      screen.getByRole('button', { name: 'Analyze action' }),
    ).toBeDisabled();
    expect(screen.getByText('Accidental double-click')).toBeVisible();
    expect(screen.getByText('Impatient triple-click')).toBeVisible();
    expect(screen.getByText('Server duplicate handling')).toBeVisible();
    await user.click(screen.getByText('Server duplicate handling'));

    await user.type(
      screen.getByLabelText('Guided SECRET_TOKEN'),
      'runtime-only',
    );
    expect(screen.getByText('Required runtime values are ready')).toBeVisible();
    await user.click(screen.getByRole('button', { name: 'Analyze action' }));

    await waitFor(() =>
      expect(mocks.discoverRequests).toHaveBeenCalledWith(
        journey.id,
        'submit-profile',
        { SECRET_TOKEN: 'runtime-only' },
        true,
        {
          normalizeJourney: true,
          stepValueOverrides: {
            'fill-name': '{{unique.name}}',
          },
        },
      ),
    );
    expect(
      await screen.findByText('Likely create request — Recommended'),
    ).toBeVisible();
    expect(screen.getByText('POST /api/profile')).toBeVisible();
    expect(
      screen.getByText('No more than two matching requests are sent.'),
    ).toBeVisible();
    expect(
      screen.getByText('No matching response returns HTTP 5xx.'),
    ).toBeVisible();
    expect(
      screen.getByText('No more than one matching request succeeds.'),
    ).toBeVisible();
    expect(
      screen.getByText('Every matching response uses 201 or 409.'),
    ).toBeVisible();

    await user.click(
      screen.getByRole('button', {
        name: 'Save and run recommended test',
      }),
    );

    await waitFor(() =>
      expect(mocks.createExternalExperiment).toHaveBeenCalledWith(
        journey.id,
        expect.objectContaining({
          targetStepId: 'submit-profile',
          triggerCount: 2,
          intervalMs: 300,
          continueAfterTarget: false,
          guided: true,
          normalizeJourney: true,
          stepValueOverrides: {
            'fill-name': '{{unique.name}}',
          },
          networkMatcher: {
            method: 'POST',
            pathname: '/api/profile',
            host: 'localhost:4300',
          },
          assertions: [
            expect.objectContaining({
              type: 'network_request_max',
              maximum: 2,
            }),
            expect.objectContaining({
              type: 'network_success_max',
              maximum: 1,
            }),
            expect.objectContaining({ type: 'network_no_server_errors' }),
            expect.objectContaining({
              type: 'network_all_status',
              allowedStatuses: [201, 409],
            }),
          ],
        }),
      ),
    );
    expect(lastCreatedExperiment()).toMatchObject({
      requestSelectionProvenance: {
        selectionMode: 'confirmed_recommendation',
        discoveryId: '11111111-2222-4333-8444-555555555555',
        discoveryOutcome: 'recommended',
        selectedCandidateId: 'request-222222222222222222222222',
        userOverrodeRecommendation: false,
      },
    });
    expect(mocks.runExternalExperiment).toHaveBeenCalledWith(
      'version-1',
      {
        SECRET_TOKEN: 'runtime-only',
      },
      true,
    );
    expect(
      await screen.findByText(
        'The action handled the repeated trigger safely.',
      ),
    ).toBeVisible();
    expect(screen.getByText('1/1 assertions passed')).toBeVisible();
  });

  it('configures discovery, an immutable version, runtime values and a prominent result', async () => {
    const user = userEvent.setup();
    render(<ExternalExperimentPanel project={project} journeys={[journey]} />);

    await user.click(
      await screen.findByRole('tab', {
        name: /Advanced/,
      }),
    );
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
    expect(
      screen.getByRole('button', {
        name: 'Save immutable experiment version',
      }),
    ).toBeDisabled();
    expect(
      screen.getByText(/Network assertions cannot run without a matcher/),
    ).toBeVisible();

    await user.type(screen.getByLabelText('SECRET_TOKEN'), 'runtime-only');
    await user.click(screen.getByRole('button', { name: 'Discover requests' }));
    expect(
      await screen.findByRole('option', {
        name: 'POST /api/profile — 201 · 1x · score 108',
      }),
    ).toBeVisible();
    await user.selectOptions(
      screen.getByLabelText('Required network matcher'),
      '1',
    );
    await user.click(screen.getByRole('button', { name: 'Add assertion' }));
    await user.selectOptions(
      screen.getByLabelText('Assertion 2 type'),
      'network_no_server_errors',
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
          assertions: [
            expect.objectContaining({ type: 'network_request_max' }),
            expect.objectContaining({ type: 'network_no_server_errors' }),
          ],
        }),
      ),
    );

    await user.click(screen.getByRole('button', { name: 'Run' }));
    expect(
      await screen.findByRole('heading', { name: 'passed' }),
    ).toBeVisible();
    expect(screen.getByText('1/1 assertions passed')).toBeVisible();
    expect(screen.getByText('POST /api/profile')).toBeVisible();
    expect(
      screen.getByRole('img', { name: 'final-result screenshot' }),
    ).toBeVisible();
    expect(screen.getByText('Final application state')).toBeVisible();
    expect(
      screen.getByText(
        'The stable page state preserved when FormCrash evaluates and records the result.',
      ),
    ).toBeVisible();
    expect(
      screen.getByRole('link', {
        name: 'Open final application state screenshot',
      }),
    ).toHaveAttribute(
      'href',
      'http://localhost:4100/api/external-runs/run-1/artifacts/screen-1',
    );
    expect(mocks.runExternalExperiment).toHaveBeenCalledWith(
      'version-1',
      {
        SECRET_TOKEN: 'runtime-only',
      },
      true,
    );
  });

  it('requires an explicit Guided choice when the server reports ambiguous mutations', async () => {
    mocks.discoverRequests.mockResolvedValueOnce({
      discoveryId: 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee',
      discoveredAt: '2026-07-16T00:00:00.000Z',
      journeyId: journey.id,
      targetStepId: 'submit-profile',
      candidates: [
        {
          candidateId: 'request-aaaaaaaaaaaaaaaaaaaaaaaa',
          rank: 1,
          score: 108,
          classification: 'likely_business_mutation',
          confidence: 'ambiguous',
          recommended: false,
          reasons: [
            {
              code: 'mutation_method',
              label: 'POST can change server state.',
              scoreImpact: 50,
            },
          ],
          method: 'POST',
          pathname: '/api/profile',
          origin: 'http://localhost:4300',
          status: 201,
          failed: false,
          relativeTimestampMs: 4,
          occurrences: 1,
        },
        {
          candidateId: 'request-bbbbbbbbbbbbbbbbbbbbbbbb',
          rank: 2,
          score: 104,
          classification: 'likely_business_mutation',
          confidence: 'ambiguous',
          recommended: false,
          reasons: [
            {
              code: 'mutation_method',
              label: 'POST can change server state.',
              scoreImpact: 50,
            },
          ],
          method: 'POST',
          pathname: '/api/invitations',
          origin: 'http://localhost:4300',
          status: 201,
          failed: false,
          relativeTimestampMs: 5,
          occurrences: 1,
        },
      ],
      recommendation: {
        outcome: 'ambiguous',
        recommendedCandidateId: null,
        explanation:
          'Multiple plausible state-changing requests have similar evidence.',
      },
    });
    const user = userEvent.setup();
    render(<ExternalExperimentPanel project={project} journeys={[journey]} />);

    await user.type(
      await screen.findByLabelText('Guided SECRET_TOKEN'),
      'runtime-only',
    );
    await user.click(screen.getByRole('button', { name: 'Analyze action' }));

    expect(await screen.findByText('Ambiguous requests')).toBeVisible();
    const profile = screen.getByRole('radio', {
      name: /POST \/api\/profile/,
    });
    const invitation = screen.getByRole('radio', {
      name: /POST \/api\/invitations/,
    });
    expect(profile).not.toBeChecked();
    expect(invitation).not.toBeChecked();
    expect(
      screen.queryByRole('button', {
        name: /Save and run/,
      }),
    ).not.toBeInTheDocument();

    await user.click(invitation);
    await user.click(
      screen.getByRole('button', { name: 'Save and run selected test' }),
    );

    await waitFor(() =>
      expect(mocks.createExternalExperiment).toHaveBeenCalledWith(
        journey.id,
        expect.objectContaining({
          networkMatcher: {
            method: 'POST',
            pathname: '/api/invitations',
            host: 'localhost:4300',
          },
        }),
      ),
    );
    expect(lastCreatedExperiment()).toMatchObject({
      requestSelectionProvenance: {
        selectionMode: 'manual_override',
        discoveryOutcome: 'ambiguous',
        selectedCandidateId: 'request-bbbbbbbbbbbbbbbbbbbbbbbb',
        recommendedMatcher: null,
        userOverrodeRecommendation: false,
      },
    });
  });

  it('does not fabricate a Guided request matcher when discovery has no suitable candidate', async () => {
    mocks.discoverRequests.mockResolvedValueOnce({
      discoveryId: 'bbbbbbbb-cccc-4ddd-8eee-ffffffffffff',
      discoveredAt: '2026-07-16T00:00:00.000Z',
      journeyId: journey.id,
      targetStepId: 'submit-profile',
      candidates: [],
      recommendation: {
        outcome: 'no_candidate',
        recommendedCandidateId: null,
        explanation: 'No browser request was observed after the action.',
      },
    });
    const user = userEvent.setup();
    render(<ExternalExperimentPanel project={project} journeys={[journey]} />);

    await user.type(
      await screen.findByLabelText('Guided SECRET_TOKEN'),
      'runtime-only',
    );
    await user.click(screen.getByRole('button', { name: 'Analyze action' }));

    expect(
      await screen.findByRole('heading', {
        name: 'No suitable request was observed',
      }),
    ).toBeVisible();
    expect(
      screen.queryByRole('button', { name: /Save and run/ }),
    ).not.toBeInTheDocument();
    expect(
      screen.getAllByRole('button', { name: 'Open Advanced mode' }).length,
    ).toBeGreaterThan(0);
  });

  it('persists an Advanced manual override instead of silently keeping the recommendation', async () => {
    const user = userEvent.setup();
    render(<ExternalExperimentPanel project={project} journeys={[journey]} />);

    await user.click(
      await screen.findByRole('tab', {
        name: /Advanced/,
      }),
    );
    await user.type(screen.getByLabelText('SECRET_TOKEN'), 'runtime-only');
    await user.click(screen.getByRole('button', { name: 'Discover requests' }));
    await user.selectOptions(
      await screen.findByLabelText('Required network matcher'),
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
          networkMatcher: {
            method: 'GET',
            pathname: '/api/profile',
            host: 'localhost:4300',
          },
        }),
      ),
    );
    expect(lastCreatedExperiment()).toMatchObject({
      requestSelectionProvenance: {
        selectionMode: 'manual_override',
        discoveryOutcome: 'recommended',
        selectedCandidateId: 'request-111111111111111111111111',
        recommendedMatcher: {
          method: 'POST',
          pathname: '/api/profile',
          host: 'localhost:4300',
        },
        userOverrodeRecommendation: true,
      },
    });
  });
});

function lastCreatedExperiment(): CreateExternalExperimentRequest {
  const input = mocks.createExternalExperiment.mock.calls.at(-1)?.[1] as
    CreateExternalExperimentRequest | undefined;
  if (input === undefined) throw new Error('No experiment was created.');
  return input;
}
