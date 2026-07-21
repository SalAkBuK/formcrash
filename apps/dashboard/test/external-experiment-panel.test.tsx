import { StrictMode } from 'react';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type {
  AssertionRecommendationSet,
  CreateExternalExperimentRequest,
  RequestDiscoveryResult,
} from '@formcrash/contracts';

import { ExternalExperimentPanel } from '../src/features/projects/components/external-experiment-panel';
import { FormCrashApiError } from '../src/lib/api-client';

const mocks = vi.hoisted(() => ({
  cancelAuthenticationCapture: vi.fn(),
  clearAuthentication: vi.fn(),
  confirmAuthenticationCapture: vi.fn(),
  continueWithoutAuthentication: vi.fn(),
  createExternalExperiment: vi.fn(),
  createExternalExperimentSuite: vi.fn(),
  deleteExternalExperimentVersion: vi.fn(),
  deleteExternalRun: vi.fn(),
  discoverRequests: vi.fn(),
  getExternalArtifactUrl: vi.fn(),
  getExternalRun: vi.fn(),
  getProjectSettings: vi.fn(),
  getActiveOutcomeCapture: vi.fn(),
  getCriticalAction: vi.fn(),
  getOutcomeCapture: vi.fn(),
  listOutcomeChecks: vi.fn(),
  approveCriticalAction: vi.fn(),
  approveOutcomeCheck: vi.fn(),
  closeOutcomeCapture: vi.fn(),
  deleteOutcomeCheck: vi.fn(),
  startOutcomeCapture: vi.fn(),
  listExternalExperiments: vi.fn(),
  listNetworkEvidenceCandidates: vi.fn(),
  listExternalRuns: vi.fn(),
  runExternalExperiment: vi.fn(),
  saveProductionReplayAcknowledgement: vi.fn(),
  saveProjectSettings: vi.fn(),
  startAuthenticationCapture: vi.fn(),
  testAuthentication: vi.fn(),
}));

vi.mock('../src/features/projects/api/external-experiments', () => mocks);
vi.mock('../src/features/projects/api/projects', () => mocks);

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
  outcomeCheckSnapshot: { criticalAction: null, checks: [] },
  journeySnapshot: journey,
  createdAt: '2026-07-16T00:00:00.000Z',
};

const awaitingAuthenticationCapture = {
  id: 'auth-capture-1',
  projectId: project.id,
  status: 'awaiting_confirmation' as const,
  errorMessage: null,
  startedAt: '2026-07-16T00:05:00.000Z',
  completedAt: null,
};

const criticalAction = {
  id: 'critical-action-1',
  journeyId: journey.id,
  stepId: 'submit-profile',
  label: 'Submit profile',
  createdAt: '2026-07-16T00:00:00.000Z',
  updatedAt: '2026-07-16T00:00:00.000Z',
};

const outcomeCheck = {
  id: 'outcome-check-1',
  journeyId: journey.id,
  criticalActionId: criticalAction.id,
  type: 'final_pathname_matches' as const,
  description: 'The profile page should appear.',
  expectedPathname: '/profiles/created',
  createdAt: '2026-07-16T00:00:00.000Z',
};

beforeEach(() => {
  vi.clearAllMocks();
  mocks.testAuthentication.mockResolvedValue({
    projectId: project.id,
    status: 'valid',
    outcome: 'authenticated',
    currentUrl: project.targetUrl,
    message: 'Connected.',
    checkedAt: '2026-07-16T00:00:00.000Z',
  });
  mocks.getExternalArtifactUrl.mockReturnValue(
    'http://localhost:4100/api/external-runs/run-1/artifacts/screen-1',
  );
  mocks.getProjectSettings.mockResolvedValue(settings);
  mocks.saveProductionReplayAcknowledgement.mockImplementation(
    (_projectId: string, acknowledged: boolean) =>
      Promise.resolve({
        ...settings,
        productionReplayAcknowledged: acknowledged,
        productionReplayAcknowledgedAt: acknowledged
          ? '2026-07-16T00:00:00.000Z'
          : null,
      }),
  );
  mocks.getCriticalAction.mockResolvedValue(criticalAction);
  mocks.listOutcomeChecks.mockResolvedValue([outcomeCheck]);
  mocks.getActiveOutcomeCapture.mockResolvedValue(null);
  mocks.getOutcomeCapture.mockResolvedValue({
    id: 'outcome-capture-1',
    journeyId: journey.id,
    criticalActionId: criticalAction.id,
    generatedInputs: [],
    status: 'awaiting_selection',
    selectedTarget: null,
    selectionWarnings: [],
    finalPathname: '/profiles/created',
    errorMessage: null,
    startedAt: '2026-07-16T00:00:00.000Z',
    expiresAt: '2026-07-16T00:10:00.000Z',
    completedAt: null,
  });
  mocks.startAuthenticationCapture.mockResolvedValue(
    awaitingAuthenticationCapture,
  );
  mocks.confirmAuthenticationCapture.mockResolvedValue({
    ...awaitingAuthenticationCapture,
    status: 'completed',
    completedAt: '2026-07-16T00:06:00.000Z',
  });
  mocks.listExternalExperiments.mockResolvedValue([version]);
  mocks.listNetworkEvidenceCandidates.mockResolvedValue({
    items: [],
    source: null,
    explanation: 'No bounded evidence is available.',
  });
  mocks.listExternalRuns.mockResolvedValue({
    items: [],
    limit: 20,
    offset: 0,
  });
  mocks.discoverRequests.mockResolvedValue(
    withAssertionRecommendations({
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
    }),
  );
  mocks.createExternalExperiment.mockResolvedValue(version);
  mocks.createExternalExperimentSuite.mockImplementation(
    async (
      journeyId: string,
      input: { readonly tests: readonly CreateExternalExperimentRequest[] },
    ) => {
      const first = await mocks.createExternalExperiment(
        journeyId,
        input.tests[0]!,
      );
      return input.tests.map((test, index) => ({
        ...first,
        id: `${first.id}-suite-${index + 1}`,
        experimentId: `${first.experimentId}-suite-${index + 1}`,
        name: test.name,
        triggerCount: test.triggerCount,
        intervalMs: test.intervalMs,
        assertions: test.assertions,
      }));
    },
  );
  const runResult = {
    runId: 'run-1',
    experimentVersionId: version.id,
    projectId: project.id,
    journeyId: journey.id,
    status: 'passed',
    lifecycleStatus: 'completed',
    outcomeAggregate: 'not_configured',
    assertionAggregate: 'passed',
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
    outcomeCheckSnapshot: { criticalAction: null, checks: [] },
    outcomeCheckResults: [],
    presentation: {
      primaryStatus: 'not_configured',
      headline:
        'This run has technical evidence, but no approved Outcome Check was configured.',
      outcomeSummary:
        'Technical assertions and captured evidence remain available below, but they do not establish an approved application outcome.',
      approvedExpectedOutcomeDescription: null,
      expectedCondition: null,
      observedCondition: null,
      templateBinding: null,
      observations: [],
      conclusion: null,
      whyItMatters: null,
      unknowns: [],
      protectionSuggestions: [],
      evidenceReferences: {
        triggerEventIds: [],
        requestObservationIds: [],
        screenshotArtifactIds: [],
        runnerEventIds: [],
      },
      technicalDetailsAvailable: {
        assertions: true,
        requests: true,
        events: false,
        screenshots: true,
      },
      checks: [],
    },
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
  it('presents and initializes one high-confidence action once under Strict Mode', async () => {
    const user = userEvent.setup();
    const productionProject = {
      ...project,
      environment: 'production' as const,
    };
    const placeOrderStep = {
      ...journey.steps[0]!,
      id: 'place-order',
      name: 'Stable recorded checkout description',
      type: 'click' as const,
      timestamp: 8,
      url: 'http://localhost:4300/checkout',
      locator: {
        strategy: 'role' as const,
        role: 'button',
        name: 'Place order',
      },
      fingerprint: {
        ...journey.steps[0]!.fingerprint!,
        tagName: 'button',
        inputType: null,
        role: 'button',
        accessibleName: 'Place order',
        label: 'Checkout action',
        text: 'Place order',
      },
      value: null,
    };
    const checkoutJourney = {
      ...journey,
      id: 'journey-checkout',
      name: 'Checkout order',
      steps: [
        ...Array.from({ length: 7 }, (_, index) => ({
          ...journey.steps[0]!,
          id: `setup-${index + 1}`,
          name: `Checkout setup ${index + 1}`,
          type: 'navigate' as const,
          timestamp: index,
          url: 'http://localhost:4300/checkout',
          locator: null,
          fingerprint: null,
          value: null,
        })),
        placeOrderStep,
      ],
    };
    const savedAction = {
      ...criticalAction,
      journeyId: checkoutJourney.id,
      stepId: placeOrderStep.id,
      label: 'Place order',
    };
    mocks.getCriticalAction.mockResolvedValue(null);
    mocks.listOutcomeChecks.mockResolvedValue([]);
    mocks.approveCriticalAction.mockResolvedValue(savedAction);
    const checkoutCapture = {
      id: 'checkout-capture',
      journeyId: checkoutJourney.id,
      criticalActionId: savedAction.id,
      generatedInputs: [],
      status: 'awaiting_selection' as const,
      selectedTarget: null,
      selectionWarnings: [],
      finalPathname: '/checkout/complete',
      errorMessage: null,
      startedAt: '2026-07-16T00:00:00.000Z',
      expiresAt: '2026-07-16T00:10:00.000Z',
      completedAt: null,
    };
    mocks.startOutcomeCapture.mockResolvedValue(checkoutCapture);
    mocks.getOutcomeCapture.mockResolvedValue(checkoutCapture);

    render(
      <StrictMode>
        <ExternalExperimentPanel
          project={productionProject}
          journeys={[checkoutJourney]}
        />
      </StrictMode>,
    );
    await user.click(
      await screen.findByRole('tab', { name: /Critical Action/u }),
    );

    expect(
      screen.getByRole('heading', { name: 'What should FormCrash test?' }),
    ).toBeVisible();
    expect(
      screen.getByText(
        /replays every earlier journey step normally—including navigation and switching buildings/u,
      ),
    ).toBeVisible();
    expect(screen.getByLabelText('Selected action details')).toHaveTextContent(
      'How this test will run',
    );
    expect(screen.getByLabelText('Selected action details')).toHaveTextContent(
      'Replay the first 7 journey steps normally',
    );
    expect(screen.getByLabelText('Selected action details')).toHaveTextContent(
      'activates the selected control',
    );
    expect(screen.getByLabelText('Selected action details')).toHaveTextContent(
      'The selected action happens on Checkout page',
    );
    expect(screen.getByText('Rename this action in results')).toBeVisible();
    expect(
      screen.queryByText(/\(click\)|Recorded click or submit/u),
    ).toBeNull();

    await user.click(
      screen.getByRole('button', { name: 'Confirm this action' }),
    );
    await waitFor(() =>
      expect(mocks.approveCriticalAction).toHaveBeenCalledOnce(),
    );
    expect(mocks.approveCriticalAction).toHaveBeenCalledWith(
      checkoutJourney.id,
      placeOrderStep.id,
      'Place order',
    );

    const baseline = screen.getByRole('button', {
      name: 'Replay journey and choose result',
    });
    expect(baseline).toBeDisabled();
    const outcomeConfiguration = document.querySelector(
      '#guided-outcome-configuration',
    );
    expect(outcomeConfiguration).not.toBeNull();
    const productionConfirmation = within(
      outcomeConfiguration as HTMLElement,
    ).getByRole('checkbox', {
      name: /I confirm this test may change production data/u,
    });
    expect(productionConfirmation).toBeVisible();
    await user.click(productionConfirmation);
    await waitFor(() => expect(baseline).toBeEnabled());
    await user.click(baseline);
    await waitFor(() =>
      expect(mocks.startOutcomeCapture).toHaveBeenCalledOnce(),
    );
    expect(mocks.getProjectSettings).toHaveBeenCalledTimes(2);
    expect(mocks.testAuthentication).toHaveBeenCalledOnce();
    expect(mocks.listExternalRuns).not.toHaveBeenCalled();
    expect(mocks.listExternalExperiments).not.toHaveBeenCalled();
    expect(mocks.getCriticalAction).toHaveBeenCalledOnce();
    expect(mocks.listOutcomeChecks).toHaveBeenCalledOnce();
    expect(mocks.getActiveOutcomeCapture).toHaveBeenCalledOnce();
    expect(mocks.startOutcomeCapture).toHaveBeenCalledWith(
      checkoutJourney.id,
      {},
      true,
    );
    await user.click(
      screen.getByRole('button', { name: 'Use final page instead' }),
    );
    expect(
      screen.getByRole('tab', { name: /Outcome Checks/u }),
    ).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByText('Final pathname:', { exact: false })).toBeVisible();
    expect(screen.getByRole('button', { name: 'Approve check' })).toBeEnabled();
  });

  it('shows a concrete first-test tutorial when no journey exists', async () => {
    render(<ExternalExperimentPanel project={project} journeys={[]} />);

    expect(
      await screen.findByRole('heading', {
        name: 'Set up your first test',
      }),
    ).toBeVisible();
    expect(
      screen.getByRole('link', { name: 'Go to journey recording' }),
    ).toHaveAttribute('href', '#recording-workspace');
    expect(
      screen.getByRole('link', { name: 'Set up authentication' }),
    ).toHaveAttribute('href', `/projects/${project.id}/settings`);
  });

  it('presents one step-by-step setup flow without mode choices', async () => {
    render(<ExternalExperimentPanel project={project} journeys={[journey]} />);

    expect(
      await screen.findByRole('heading', {
        name: 'Define the outcome, check safety, then save',
      }),
    ).toBeVisible();
    expect(
      screen.getByRole('navigation', { name: 'Test setup progress' }),
    ).toBeVisible();
    expect(
      screen.queryByRole('tablist', { name: 'Test mode' }),
    ).not.toBeInTheDocument();
    expect(screen.queryByText('Recommended')).not.toBeInTheDocument();
    expect(screen.queryByText('Advanced')).not.toBeInTheDocument();
  });

  it('reaches review without a request-discovery replay', async () => {
    const user = userEvent.setup();
    mocks.testAuthentication.mockResolvedValue({
      projectId: project.id,
      status: 'invalid',
      outcome: 'authentication_required',
      currentUrl: 'http://localhost:4300/login',
      message: 'Sign-in required.',
      checkedAt: '2026-07-16T00:00:00.000Z',
    });
    render(<ExternalExperimentPanel project={project} journeys={[journey]} />);

    await user.click(
      await screen.findByRole('button', {
        name: 'Continue to Safety & Data',
      }),
    );
    await user.type(
      await screen.findByLabelText('Runtime SECRET_TOKEN'),
      'runtime-only',
    );
    await user.click(screen.getByRole('button', { name: 'Review & Save' }));

    expect(
      await screen.findByRole('heading', { name: 'Review & Save' }),
    ).toBeVisible();
    expect(mocks.discoverRequests).not.toHaveBeenCalled();
  });

  it('saves without an authentication preflight or a run', async () => {
    const user = userEvent.setup();
    mocks.testAuthentication.mockResolvedValueOnce({
      projectId: project.id,
      status: 'invalid',
      outcome: 'authentication_expired',
      currentUrl: 'http://localhost:4300/login',
      message: 'Expired.',
      checkedAt: '2026-07-16T00:01:00.000Z',
    });
    render(<ExternalExperimentPanel project={project} journeys={[journey]} />);

    await user.click(
      await screen.findByRole('button', {
        name: 'Continue to Safety & Data',
      }),
    );
    await user.type(
      await screen.findByLabelText('Runtime SECRET_TOKEN'),
      'runtime-only',
    );
    await user.click(screen.getByRole('button', { name: 'Review & Save' }));
    await screen.findByRole('heading', { name: 'Review & Save' });
    await user.click(
      screen.getByRole('button', {
        name: 'Save 3-Test suite',
      }),
    );

    await waitFor(() =>
      expect(mocks.createExternalExperiment).toHaveBeenCalledOnce(),
    );
    expect(mocks.testAuthentication).not.toHaveBeenCalled();
    expect(mocks.runExternalExperiment).not.toHaveBeenCalled();
  });

  it('blocks the first step while Outcome Checks are empty and exposes the existing capture entry', async () => {
    const user = userEvent.setup();
    mocks.listOutcomeChecks.mockResolvedValue([]);

    render(<ExternalExperimentPanel project={project} journeys={[journey]} />);

    expect(
      screen.getByRole('button', { name: 'Continue to Safety & Data' }),
    ).toBeDisabled();
    expect(
      await screen.findByText('Save at least one valid Outcome Check.'),
    ).toBeVisible();
    await user.click(
      await screen.findByRole('tab', { name: /Outcome Checks/u }),
    );
    expect(
      await screen.findByText('No Outcome Checks saved yet.'),
    ).toBeVisible();
    await user.click(screen.getByRole('tab', { name: /Critical Action/u }));
    expect(
      screen.getByRole('button', {
        name: 'Replay journey and choose result',
      }),
    ).toBeVisible();
  });

  it('renders loading and error states without inventing Outcome Check metadata', async () => {
    let rejectChecks!: (reason: unknown) => void;
    mocks.listOutcomeChecks.mockImplementation(
      () =>
        new Promise((_resolve, reject) => {
          rejectChecks = reject;
        }),
    );

    render(<ExternalExperimentPanel project={project} journeys={[journey]} />);

    expect(
      (await screen.findAllByText(/Loading the saved Critical Action/u))[0],
    ).toBeVisible();
    rejectChecks(new Error('Outcome service unavailable'));
    expect(
      await screen.findByText(
        'Saved Outcome Check configuration could not be loaded.',
      ),
    ).toBeVisible();
    expect(
      screen.queryByText(/confidence|provenance/u),
    ).not.toBeInTheDocument();
  });

  it('contains baseline runner failures and removes terminal escape noise', async () => {
    const user = userEvent.setup();
    mocks.listOutcomeChecks.mockResolvedValue([]);
    mocks.getActiveOutcomeCapture.mockResolvedValue({
      id: 'failed-outcome-capture',
      journeyId: journey.id,
      criticalActionId: criticalAction.id,
      generatedInputs: [],
      status: 'runner_error',
      selectedTarget: null,
      selectionWarnings: [],
      finalPathname: null,
      errorMessage:
        'page.goto: Target page, context or browser has been closed\nCall log: \u001b[2m - navigating to "https://example.test"\u001b[22m',
      startedAt: '2026-07-16T00:00:00.000Z',
      expiresAt: '2026-07-16T00:10:00.000Z',
      completedAt: '2026-07-16T00:01:00.000Z',
    });

    render(<ExternalExperimentPanel project={project} journeys={[journey]} />);
    await user.click(
      await screen.findByRole('tab', { name: /Critical Action/u }),
    );

    expect(
      await screen.findByText('Saved journey could not complete'),
    ).toBeVisible();
    expect(screen.getByText('Replay stopped')).toBeVisible();
    expect(
      screen.getByText(/controlled browser closed before the saved journey/u),
    ).toBeVisible();
    expect(document.body.textContent).not.toContain(String.fromCharCode(27));
    await user.click(screen.getByText('Technical runner detail'));
    expect(
      screen.getByText(
        'page.goto: Target page, context or browser has been closed',
      ),
    ).toBeVisible();
  });

  it('explains outcome selection without assuming a tenant workflow', async () => {
    const user = userEvent.setup();
    mocks.listOutcomeChecks.mockResolvedValue([]);

    render(<ExternalExperimentPanel project={project} journeys={[journey]} />);
    await user.click(
      await screen.findByRole('tab', { name: /Critical Action/u }),
    );

    expect(
      screen.getByText(/click the visible result that proves the journey/u),
    ).toBeVisible();
    expect(screen.queryByText(/tenant row/u)).not.toBeInTheDocument();
  });

  it('explains ambiguous replay targets without workflow-specific jargon', async () => {
    const user = userEvent.setup();
    mocks.listOutcomeChecks.mockResolvedValue([]);
    mocks.getActiveOutcomeCapture.mockResolvedValue({
      id: 'ambiguous-outcome-capture',
      journeyId: journey.id,
      criticalActionId: criticalAction.id,
      generatedInputs: [],
      status: 'runner_error',
      selectedTarget: null,
      selectionWarnings: [],
      finalPathname: null,
      errorMessage:
        'locator.click: Error: strict mode violation: getByText resolved to 2 elements',
      startedAt: '2026-07-16T00:00:00.000Z',
      expiresAt: '2026-07-16T00:10:00.000Z',
      completedAt: '2026-07-16T00:01:00.000Z',
    });

    render(<ExternalExperimentPanel project={project} journeys={[journey]} />);
    await user.click(
      await screen.findByRole('tab', { name: /Critical Action/u }),
    );

    expect(
      screen.getByText(/stopped before clicking the wrong control/u),
    ).toBeVisible();
    expect(
      within(screen.getByRole('alert')).queryByText(/tenant|building/u),
    ).not.toBeInTheDocument();
  });

  it('warns that target data may already have changed when result selection fails after replay', async () => {
    const user = userEvent.setup();
    mocks.listOutcomeChecks.mockResolvedValue([]);
    mocks.getActiveOutcomeCapture.mockResolvedValue({
      id: 'failed-outcome-selector',
      journeyId: journey.id,
      criticalActionId: criticalAction.id,
      generatedInputs: [],
      status: 'runner_error',
      selectedTarget: null,
      selectionWarnings: [],
      finalPathname: '/portal/residents',
      errorMessage:
        'Baseline replay completed, but Outcome Check selection could not start. The Critical Action may already have changed target data. frame.evaluate: ReferenceError: __name is not defined',
      startedAt: '2026-07-16T00:00:00.000Z',
      expiresAt: '2026-07-16T00:10:00.000Z',
      completedAt: '2026-07-16T00:01:00.000Z',
    });

    render(<ExternalExperimentPanel project={project} journeys={[journey]} />);
    await user.click(
      await screen.findByRole('tab', { name: /Critical Action/u }),
    );

    expect(
      await screen.findByText('Journey completed, but result selection failed'),
    ).toBeVisible();
    expect(
      screen.getByText(
        'The saved journey completed and may already have changed target data, but FormCrash could not start result selection. Do not immediately replay the mutation; review the target data first.',
      ),
    ).toBeVisible();
    expect(screen.queryByText('Saved journey could not complete')).toBeNull();
  });

  it('offers another selection or final-page recovery for a rejected result', async () => {
    const user = userEvent.setup();
    mocks.listOutcomeChecks.mockResolvedValue([]);
    mocks.getActiveOutcomeCapture.mockResolvedValue({
      id: 'rejected-outcome-selection',
      journeyId: journey.id,
      criticalActionId: criticalAction.id,
      generatedInputs: [],
      status: 'selection_rejected',
      selectedTarget: null,
      selectionWarnings: [
        {
          code: 'dynamic_locator',
          message:
            'The selected result could not be bound to a generated journey value.',
        },
      ],
      finalPathname: '/portal/residents',
      errorMessage: null,
      startedAt: '2026-07-16T00:00:00.000Z',
      expiresAt: '2026-07-16T00:10:00.000Z',
      completedAt: null,
    });

    render(<ExternalExperimentPanel project={project} journeys={[journey]} />);
    await user.click(
      await screen.findByRole('tab', { name: /Critical Action/u }),
    );

    expect(
      await screen.findByText('This result cannot be saved as selected.'),
    ).toBeVisible();
    expect(screen.getByText(/click a different stable row/u)).toBeVisible();
    await user.click(
      screen.getByRole('button', { name: 'Use captured final page' }),
    );
    expect(
      screen.getByRole('tab', { name: /Outcome Checks/u }),
    ).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByRole('button', { name: 'Approve check' })).toBeEnabled();
  });

  it('keeps authentication unknown, redacts values, and persists production confirmation', async () => {
    const user = userEvent.setup();
    const productionProject = {
      ...project,
      environment: 'production' as const,
    };

    render(
      <ExternalExperimentPanel
        project={productionProject}
        journeys={[journey]}
      />,
    );
    await user.click(
      await screen.findByRole('button', {
        name: 'Continue to Safety & Data',
      }),
    );

    expect(
      screen.getByText(
        'No saved authentication. FormCrash may discover during replay that authentication is required.',
      ),
    ).toBeVisible();
    const runtimeInput = screen.getByLabelText('Runtime SECRET_TOKEN');
    expect(runtimeInput).toHaveAttribute('type', 'password');
    await user.type(runtimeInput, 'production-secret');
    expect(screen.queryByText('production-secret')).not.toBeInTheDocument();
    const continueButton = screen.getByRole('button', {
      name: 'Review & Save',
    });
    expect(continueButton).toBeEnabled();
    await user.click(
      screen.getByRole('checkbox', {
        name: /I confirm this test may change production data/u,
      }),
    );
    expect(mocks.saveProductionReplayAcknowledgement).toHaveBeenCalledWith(
      project.id,
      true,
    );
    expect(continueButton).toBeEnabled();
  });

  it('prevents duplicate save submissions while test creation is pending', async () => {
    const user = userEvent.setup();
    const journeyWithoutRuntime = {
      ...journey,
      steps: journey.steps.filter((step) => step.id !== 'fill-token'),
    };
    let resolveCreation!: (created: typeof version) => void;
    mocks.createExternalExperiment.mockImplementation(
      () =>
        new Promise((resolve) => {
          resolveCreation = resolve;
        }),
    );

    render(
      <ExternalExperimentPanel
        project={project}
        journeys={[journeyWithoutRuntime]}
      />,
    );
    await user.click(
      await screen.findByRole('button', {
        name: 'Continue to Safety & Data',
      }),
    );
    const continueButton = screen.getByRole('button', {
      name: 'Review & Save',
    });
    await waitFor(() => expect(continueButton).toBeEnabled());
    await user.click(continueButton);
    const saveButton = await screen.findByRole('button', {
      name: 'Save 3-Test suite',
    });
    await user.click(saveButton);
    await user.click(saveButton);

    expect(mocks.createExternalExperiment).toHaveBeenCalledTimes(1);
    expect(
      screen.getByRole('button', { name: 'Saving Test suite…' }),
    ).toBeDisabled();
    resolveCreation(version);
    expect(
      await screen.findByText(/Three Tests saved as Version 1/u),
    ).toBeVisible();
    expect(mocks.runExternalExperiment).not.toHaveBeenCalled();
  });

  it('shows a clear conflict when a test name already exists', async () => {
    const user = userEvent.setup();
    mocks.createExternalExperiment.mockRejectedValueOnce(
      new FormCrashApiError(
        409,
        'TEST_NAME_EXISTS',
        'A test named "Accidental double-click: Submit profile" already exists for this journey.',
      ),
    );

    render(<ExternalExperimentPanel project={project} journeys={[journey]} />);
    await user.click(
      await screen.findByRole('button', {
        name: 'Continue to Safety & Data',
      }),
    );
    await user.type(
      await screen.findByLabelText('Runtime SECRET_TOKEN'),
      'runtime-only',
    );
    await user.click(screen.getByRole('button', { name: 'Review & Save' }));

    await user.click(
      await screen.findByRole('button', {
        name: 'Save 3-Test suite',
      }),
    );

    expect(
      await screen.findByText(/already exists for this journey/u),
    ).toBeVisible();
    expect(mocks.createExternalExperiment).toHaveBeenCalledOnce();
    expect(mocks.runExternalExperiment).not.toHaveBeenCalled();
  });

  it('saves generated and custom values without a discovery replay', async () => {
    const user = userEvent.setup();
    const parkingJourney = {
      ...journey,
      id: 'journey-parking',
      name: 'Add parking slot',
      steps: [
        journey.steps[0]!,
        {
          id: 'fill-parking-slot',
          name: 'Fill Parking Slot',
          type: 'fill' as const,
          timestamp: 1,
          url: project.targetUrl,
          locator: { strategy: 'id' as const, value: 'parking-slot' },
          fingerprint: {
            tagName: 'input',
            inputType: 'text',
            dataFormcrash: null,
            dataTestId: null,
            id: 'parking-slot',
            role: 'textbox',
            accessibleName: 'Parking Slot',
            name: 'parkingSlot',
            label: 'Parking Slot',
            text: null,
            cssPath: '#parking-slot',
          },
          value: { kind: 'safe' as const, value: 'TT-101' },
          sensitive: false,
        },
        ...journey.steps.slice(1),
      ],
    };

    render(
      <ExternalExperimentPanel project={project} journeys={[parkingJourney]} />,
    );
    await user.click(
      await screen.findByRole('button', {
        name: 'Continue to Safety & Data',
      }),
    );
    await user.type(
      await screen.findByLabelText('Runtime SECRET_TOKEN'),
      'runtime-only',
    );
    await user.selectOptions(
      screen.getByLabelText('Fill Parking Slot value source'),
      'custom',
    );
    const customValue = screen.getByLabelText('Fill Parking Slot custom value');
    await user.clear(customValue);
    await user.type(customValue, 'P-204');
    await user.click(screen.getByRole('button', { name: 'Review & Save' }));
    await user.click(
      await screen.findByRole('button', {
        name: 'Save 3-Test suite',
      }),
    );

    await waitFor(() =>
      expect(mocks.createExternalExperiment).toHaveBeenCalledOnce(),
    );
    expect(lastCreatedExperiment().stepValueOverrides).toMatchObject({
      'fill-name': '{{unique.name}}',
      'fill-parking-slot': 'P-204',
    });
    expect(mocks.discoverRequests).not.toHaveBeenCalled();
  });

  it('guides a user from a journey to a recommended test and explains the result', async () => {
    const user = userEvent.setup();
    render(<ExternalExperimentPanel project={project} journeys={[journey]} />);

    expect(
      await screen.findByRole('heading', {
        name: 'Define the outcome, check safety, then save',
      }),
    ).toBeVisible();
    await user.click(
      await screen.findByRole('tab', { name: /Outcome Checks/u }),
    );
    expect(
      await screen.findByText(
        'The journey should finish at /profiles/created.',
      ),
    ).toBeVisible();
    expect(screen.queryByText(/confidence/u)).not.toBeInTheDocument();
    await user.click(
      screen.getByRole('button', { name: 'Continue to Safety & Data' }),
    );
    expect(screen.getByText('Accidental double-click')).toBeVisible();
    expect(screen.getByText('Impatient triple-click')).toBeVisible();
    expect(screen.getByText('Delayed repeated action')).toBeVisible();

    await user.type(
      screen.getByLabelText('Runtime SECRET_TOKEN'),
      'runtime-only',
    );
    await user.click(screen.getByText('Fast'));
    await user.click(screen.getByRole('button', { name: 'Review & Save' }));

    expect(mocks.discoverRequests).not.toHaveBeenCalled();
    expect(
      await screen.findByRole('heading', { name: 'Review & Save' }),
    ).toBeVisible();
    expect(screen.getByText(/save Double-click, Triple-click/u)).toBeVisible();
    expect(
      screen.getAllByText('The journey should finish at /profiles/created.')
        .length,
    ).toBeGreaterThan(0);
    expect(screen.queryByText('runtime-only')).not.toBeInTheDocument();
    await user.click(
      screen.getByRole('button', {
        name: 'Save 3-Test suite',
      }),
    );

    await waitFor(() =>
      expect(mocks.createExternalExperimentSuite).toHaveBeenCalledWith(
        journey.id,
        expect.objectContaining({
          tests: expect.arrayContaining([
            expect.objectContaining({ triggerCount: 2, intervalMs: 0 }),
            expect.objectContaining({ triggerCount: 3, intervalMs: 100 }),
            expect.objectContaining({ triggerCount: 2, intervalMs: 300 }),
          ]),
        }),
      ),
    );
    const guidedCreated = lastCreatedExperiment();
    expect(guidedCreated.requestSelectionProvenance).toBeNull();
    expect(guidedCreated.assertions).toEqual([]);
    expect(guidedCreated.assertionSelectionProvenance).toEqual([]);
    expect(mocks.runExternalExperiment).not.toHaveBeenCalled();
    expect(
      await screen.findByText(/Three Tests saved as Version 1/u),
    ).toBeVisible();
  });

  it('approves recording-time evidence without replay and saves enforced network checks', async () => {
    mocks.listNetworkEvidenceCandidates.mockResolvedValueOnce({
      source: 'recording',
      explanation:
        'Sanitized mutation candidates were captured during the original recording.',
      items: [
        {
          candidateId: 'request-999999999999999999999999',
          rank: 1,
          score: 58,
          classification: 'likely_business_mutation',
          confidence: 'review',
          recommended: false,
          reasons: [
            {
              code: 'mutation_method',
              label: 'POST can change server state.',
              scoreImpact: 50,
            },
          ],
          source: 'recording',
          sourceRunId: null,
          actionStepId: 'submit-profile',
          method: 'POST',
          origin: 'https://api.example.test',
          host: 'api.example.test',
          pathname: '/v1/profiles',
          status: 201,
          failed: false,
          relativeTimestampMs: 18,
          occurrences: 1,
          observedAt: '2026-07-16T00:00:01.000Z',
        },
      ],
    });
    const user = userEvent.setup();
    render(<ExternalExperimentPanel project={project} journeys={[journey]} />);

    await user.click(
      await screen.findByRole('button', {
        name: 'Continue to Safety & Data',
      }),
    );
    await user.click(
      await screen.findByRole('button', { name: 'Use this request' }),
    );
    await user.type(
      screen.getByLabelText('Runtime SECRET_TOKEN'),
      'runtime-only',
    );
    await user.click(screen.getByRole('button', { name: 'Review & Save' }));
    await user.click(screen.getByRole('button', { name: 'Save 3-Test suite' }));

    await waitFor(() =>
      expect(mocks.createExternalExperiment).toHaveBeenCalledOnce(),
    );
    const created = lastCreatedExperiment();
    expect(created.networkMatcher).toEqual({
      method: 'POST',
      pathname: '/v1/profiles',
      host: 'api.example.test',
    });
    expect(created.networkEvidenceProvenance).toMatchObject({
      source: 'recording',
      candidateId: 'request-999999999999999999999999',
    });
    expect(created.assertions.map((assertion) => assertion.type)).toEqual([
      'network_request_max',
      'network_success_max',
      'network_no_server_errors',
    ]);
    expect(mocks.discoverRequests).not.toHaveBeenCalled();
  });

  it('does not require a cross-origin request confirmation replay', async () => {
    mocks.discoverRequests.mockResolvedValueOnce(
      withAssertionRecommendations({
        discoveryId: '99999999-aaaa-4bbb-8ccc-dddddddddddd',
        discoveredAt: '2026-07-16T00:00:00.000Z',
        journeyId: journey.id,
        targetStepId: 'submit-profile',
        candidates: [
          {
            candidateId: 'request-999999999999999999999999',
            rank: 1,
            score: 74,
            classification: 'likely_business_mutation',
            confidence: 'review',
            recommended: false,
            reasons: [
              {
                code: 'mutation_method',
                label: 'POST can change server state.',
                scoreImpact: 50,
              },
              {
                code: 'cross_origin',
                label: 'Request uses a different origin.',
                scoreImpact: -20,
              },
              {
                code: 'successful_status',
                label: 'HTTP 201 is a successful response.',
                scoreImpact: 15,
              },
            ],
            method: 'POST',
            pathname: '/api/org/buildings/building-1/residents',
            origin: 'https://api.towerdeskpro.com',
            status: 201,
            failed: false,
            relativeTimestampMs: 4,
            occurrences: 1,
          },
        ],
        recommendation: {
          outcome: 'review',
          recommendedCandidateId: null,
          explanation:
            'One cross-origin business mutation requires confirmation.',
        },
      }),
    );
    const user = userEvent.setup();
    const panel = (
      <StrictMode>
        <ExternalExperimentPanel project={project} journeys={[journey]} />
      </StrictMode>
    );
    const view = render(panel);

    await user.click(
      await screen.findByRole('button', {
        name: 'Continue to Safety & Data',
      }),
    );
    await user.type(
      await screen.findByLabelText('Runtime SECRET_TOKEN'),
      'runtime-only',
    );
    await user.click(screen.getByRole('button', { name: 'Review & Save' }));

    expect(
      await screen.findByRole('heading', {
        name: 'Review & Save',
      }),
    ).toBeVisible();
    expect(mocks.discoverRequests).not.toHaveBeenCalled();
    expect(mocks.createExternalExperiment).not.toHaveBeenCalled();

    view.rerender(panel);
    expect(mocks.discoverRequests).not.toHaveBeenCalled();

    await user.click(
      screen.getByRole('button', {
        name: 'Save 3-Test suite',
      }),
    );
    await waitFor(() =>
      expect(mocks.createExternalExperiment).toHaveBeenCalledOnce(),
    );
    expect(lastCreatedExperiment()).toMatchObject({
      networkMatcher: null,
      requestSelectionProvenance: null,
    });
    expect(lastCreatedExperiment().assertionSelectionProvenance).toEqual([]);
  });

  it('does not pause the standard flow for ambiguous request selection', async () => {
    mocks.discoverRequests.mockResolvedValueOnce(
      withAssertionRecommendations({
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
      }),
    );
    const user = userEvent.setup();
    render(<ExternalExperimentPanel project={project} journeys={[journey]} />);

    await user.click(
      await screen.findByRole('button', {
        name: 'Continue to Safety & Data',
      }),
    );
    await user.type(
      await screen.findByLabelText('Runtime SECRET_TOKEN'),
      'runtime-only',
    );
    await user.click(screen.getByRole('button', { name: 'Review & Save' }));
    expect(
      await screen.findByRole('heading', {
        name: 'Review & Save',
      }),
    ).toBeVisible();
    expect(
      screen.queryByRole('button', { name: 'Use POST /api/profile' }),
    ).not.toBeInTheDocument();
    expect(mocks.createExternalExperiment).not.toHaveBeenCalled();
    expect(mocks.discoverRequests).not.toHaveBeenCalled();
    expect(screen.queryByText('Advanced')).not.toBeInTheDocument();
  });

  it('does not require a request matcher when Outcome Checks are available', async () => {
    mocks.discoverRequests.mockResolvedValueOnce(
      withAssertionRecommendations({
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
      }),
    );
    const user = userEvent.setup();
    render(<ExternalExperimentPanel project={project} journeys={[journey]} />);

    await user.click(
      await screen.findByRole('button', {
        name: 'Continue to Safety & Data',
      }),
    );
    await user.type(
      await screen.findByLabelText('Runtime SECRET_TOKEN'),
      'runtime-only',
    );
    await user.click(screen.getByRole('button', { name: 'Review & Save' }));
    expect(
      await screen.findByRole('heading', { name: 'Review & Save' }),
    ).toBeVisible();
    expect(
      screen.queryByRole('button', { name: 'Use this request' }),
    ).not.toBeInTheDocument();
    expect(mocks.createExternalExperiment).not.toHaveBeenCalled();
    expect(mocks.discoverRequests).not.toHaveBeenCalled();
    expect(screen.queryByText('Advanced')).not.toBeInTheDocument();
  });
});

function lastCreatedExperiment(): CreateExternalExperimentRequest {
  const input = mocks.createExternalExperiment.mock.calls.at(-1)?.[1] as
    CreateExternalExperimentRequest | undefined;
  if (input === undefined) throw new Error('No experiment was created.');
  return input;
}

function withAssertionRecommendations(
  discovery: Omit<
    RequestDiscoveryResult,
    'normalAction' | 'assertionRecommendationSets'
  >,
): RequestDiscoveryResult {
  const sets: AssertionRecommendationSet[] = discovery.candidates.map(
    (candidate, candidateIndex) => {
      const confidence: 'high' | 'review' =
        candidate.confidence === 'high' ? 'high' : 'review';
      const defaultEnabled = confidence === 'high';
      const recommendations =
        candidate.classification === 'likely_business_mutation'
          ? [
              {
                recommendationId: `assertion-rec-${String(candidateIndex + 1).repeat(24)}`,
                assertion: {
                  id: `assertion-draft-${String(candidateIndex + 1).repeat(24)}`,
                  type: 'network_request_max' as const,
                  maximum: 2,
                  description: 'No more than two matching requests are sent.',
                },
                category: 'request_count' as const,
                confidence,
                defaultEnabled,
                reasonCode: 'repeated_action_request_limit',
                explanation:
                  'The server observed one mutation during the normal action.',
                evidence: {
                  evidenceIds: [candidate.candidateId],
                  source: 'request_discovery' as const,
                },
              },
              {
                recommendationId: `assertion-rec-${String(candidateIndex + 3).repeat(24)}`,
                assertion: {
                  id: `assertion-draft-${String(candidateIndex + 3).repeat(24)}`,
                  type: 'network_success_max' as const,
                  maximum: 1,
                  description: 'No more than one matching request succeeds.',
                },
                category: 'response_outcome' as const,
                confidence,
                defaultEnabled,
                reasonCode: 'repeated_action_success_limit',
                explanation:
                  'The server observed one successful normal mutation.',
                evidence: {
                  evidenceIds: [candidate.candidateId],
                  source: 'request_discovery' as const,
                },
              },
              {
                recommendationId: `assertion-rec-${String(candidateIndex + 5).repeat(24)}`,
                assertion: {
                  id: `assertion-draft-${String(candidateIndex + 5).repeat(24)}`,
                  type: 'network_no_server_errors' as const,
                  description: 'No matching response returns HTTP 5xx.',
                },
                category: 'server_error' as const,
                confidence,
                defaultEnabled,
                reasonCode: 'repeated_action_no_server_error',
                explanation: 'The recipe should not cause a server error.',
                evidence: {
                  evidenceIds: [candidate.candidateId],
                  source: 'recipe' as const,
                },
              },
              {
                recommendationId: `assertion-rec-${String(candidateIndex + 7).repeat(24)}`,
                assertion: {
                  id: `assertion-draft-${String(candidateIndex + 7).repeat(24)}`,
                  type: 'network_all_status' as const,
                  allowedStatuses: [201, 409],
                  description: 'Every matching response uses 201 or 409.',
                },
                category: 'response_outcome' as const,
                confidence,
                defaultEnabled,
                reasonCode: 'observed_response_status',
                explanation: 'The server observed HTTP 201.',
                evidence: {
                  evidenceIds: [candidate.candidateId],
                  source: 'request_discovery' as const,
                },
              },
            ]
          : [];
      return {
        recipeType: 'duplicate_action' as const,
        selectedRequestCandidateId: candidate.candidateId,
        recommendations,
        limitations: [],
      };
    },
  );
  return {
    ...discovery,
    normalAction: {
      targetControlLocator: null,
      targetWasDisabledDuringPending: null,
      finalPathname: '/protected',
      elements: [],
    },
    assertionRecommendationSets: [
      ...sets,
      {
        recipeType: 'duplicate_action',
        selectedRequestCandidateId: null,
        recommendations: [],
        limitations: ['No selected mutation request.'],
      },
    ],
  };
}
