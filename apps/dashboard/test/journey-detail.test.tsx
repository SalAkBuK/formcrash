import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ComponentProps } from 'react';
import type {
  CriticalAction,
  OutcomeCheck,
  PersistedJourney,
  Project,
  ProjectExecutionSettings,
} from '@formcrash/contracts';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { JourneyDetail } from '../src/features/projects/components/journey-detail';

const mocks = vi.hoisted(() => ({
  approveCriticalAction: vi.fn(),
  approveOutcomeCheck: vi.fn(),
  closeOutcomeCapture: vi.fn(),
  deleteOutcomeCheck: vi.fn(),
  getActiveOutcomeCapture: vi.fn(),
  getCriticalAction: vi.fn(),
  getOutcomeCapture: vi.fn(),
  listOutcomeChecks: vi.fn(),
  startOutcomeCapture: vi.fn(),
}));

vi.mock('../src/features/projects/api/projects', () => mocks);

const project: Project = {
  id: 'project-journey-detail',
  name: 'Customer profile fixture',
  targetUrl: 'http://localhost:4300/profile?fixture=private',
  environment: 'local',
  description: 'Controlled fixture',
  createdAt: '2026-07-16T00:00:00.000Z',
  updatedAt: '2026-07-18T00:00:00.000Z',
};

const steps: PersistedJourney['steps'] = [
  {
    id: 'navigate-profile',
    name: 'Open profile page',
    type: 'navigate',
    timestamp: 0,
    url: 'http://localhost:4300/profile?secret=hidden',
    locator: null,
    fingerprint: null,
    value: null,
    sensitive: false,
  },
  {
    id: 'fill-email',
    name: 'Enter unique email',
    type: 'fill',
    timestamp: 400,
    url: 'http://localhost:4300/profile',
    locator: { strategy: 'label', value: 'Email' },
    fingerprint: {
      tagName: 'input',
      inputType: 'email',
      dataFormcrash: null,
      dataTestId: null,
      id: 'email',
      role: 'textbox',
      accessibleName: 'Email',
      name: 'email',
      label: 'Email',
      text: null,
      cssPath: '#email',
    },
    value: { kind: 'safe', value: '{{unique.email}}' },
    sensitive: false,
  },
  {
    id: 'fill-token',
    name: 'Enter access token',
    type: 'fill',
    timestamp: 700,
    url: 'http://localhost:4300/profile',
    locator: { strategy: 'name', value: 'token' },
    fingerprint: {
      tagName: 'input',
      inputType: 'password',
      dataFormcrash: null,
      dataTestId: null,
      id: null,
      role: 'textbox',
      accessibleName: 'Token',
      name: 'token',
      label: 'Token',
      text: null,
      cssPath: 'input:nth-child(3)',
    },
    value: { kind: 'sensitive', variableName: 'PROFILE_TOKEN' },
    sensitive: true,
  },
  {
    id: 'submit-profile',
    name: 'Save profile',
    type: 'submit',
    timestamp: 900,
    url: 'http://localhost:4300/profile',
    locator: { strategy: 'data-testid', value: 'profile-form' },
    fingerprint: {
      tagName: 'form',
      inputType: null,
      dataFormcrash: null,
      dataTestId: 'profile-form',
      id: 'profile-form',
      role: 'form',
      accessibleName: 'Profile form',
      name: 'profile-form',
      label: null,
      text: null,
      cssPath: '#profile-form',
    },
    value: null,
    sensitive: false,
  },
];

const journey: PersistedJourney = {
  id: 'journey-profile-v2',
  projectId: project.id,
  name: 'Profile recovery path',
  version: 2,
  steps,
  recordingMetadata: {
    recordingSessionId: 'recording-profile-v2',
    recordedAt: '2026-07-18T09:00:00.000Z',
    warningCount: 1,
    normalizationRule: 'Input events are coalesced.',
  },
  createdAt: '2026-07-18T09:05:00.000Z',
  replayFormat: 'hybrid-v2',
  trace: {
    id: 'trace-profile-v2',
    checksumSha256: 'a'.repeat(64),
    sizeBytes: 4096,
    interactionCount: 4,
    eventCount: 18,
    pageCount: 1,
    frameCount: 1,
    videoCaptured: true,
    truncated: false,
  },
};

const previousVersion: PersistedJourney = {
  ...journey,
  id: 'journey-profile-v1',
  version: 1,
  createdAt: '2026-07-17T09:05:00.000Z',
  replayFormat: 'semantic-v1',
  trace: null,
};

const criticalAction: CriticalAction = {
  id: 'critical-profile',
  journeyId: journey.id,
  stepId: 'submit-profile',
  label: 'Save profile',
  createdAt: '2026-07-18T09:06:00.000Z',
  updatedAt: '2026-07-18T09:06:00.000Z',
};

const target = {
  locator: { strategy: 'data-testid' as const, value: 'profile-result' },
  fingerprint: {
    tagName: 'li',
    dataFormcrash: null,
    dataTestId: 'profile-result',
    id: null,
    role: 'listitem',
    accessibleName: 'Saved profile',
    name: null,
    cssPath: 'li',
  },
  preview: 'Saved profile',
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

const checks: readonly OutcomeCheck[] = [
  {
    id: 'check-exact',
    journeyId: journey.id,
    criticalActionId: criticalAction.id,
    type: 'matching_item_appears_exactly_once',
    description: 'One saved profile appears.',
    target,
    binding: target.generatedBindings[0]!,
    createdAt: '2026-07-18T09:07:00.000Z',
  },
  {
    id: 'check-visible',
    journeyId: journey.id,
    criticalActionId: criticalAction.id,
    type: 'visible_element_exists',
    description: 'Confirmation is visible.',
    target,
    createdAt: '2026-07-18T09:07:00.000Z',
  },
  {
    id: 'check-path',
    journeyId: journey.id,
    criticalActionId: criticalAction.id,
    type: 'final_pathname_matches',
    description: 'The browser reaches the profile page.',
    expectedPathname: '/profile/saved',
    createdAt: '2026-07-18T09:07:00.000Z',
  },
];

const settings: ProjectExecutionSettings = {
  projectId: project.id,
  variables: [
    {
      name: 'PROFILE_TOKEN',
      secret: true,
      description: 'Profile token',
      template: null,
      environmentName: 'FORMCRASH_PROFILE_TOKEN',
      configured: false,
    },
  ],
  beforeRunHook: null,
  afterRunHook: null,
  authentication: {
    configured: true,
    available: true,
    capturedAt: '2026-07-18T08:00:00.000Z',
    missingReason: null,
  },
  updatedAt: '2026-07-18T08:00:00.000Z',
};

beforeEach(() => {
  vi.clearAllMocks();
  mocks.getCriticalAction.mockResolvedValue(criticalAction);
  mocks.listOutcomeChecks.mockResolvedValue(checks);
  mocks.getActiveOutcomeCapture.mockResolvedValue(null);
});

describe('Journey Detail', () => {
  it('renders real identity, immutable version, format, ordered readable steps, and safe templates', async () => {
    renderDetail();

    expect(
      await screen.findByRole('heading', { name: journey.name }),
    ).toBeVisible();
    expect(
      screen.getByText(project.name, {
        selector: '.journey-target-context span',
      }),
    ).toBeVisible();
    expect(screen.getByText(project.targetUrl)).toBeVisible();
    expect(screen.getAllByText('hybrid-v2').length).toBeGreaterThan(0);
    expect(screen.getAllByText('4 steps').length).toBeGreaterThan(0);
    expect(screen.getByLabelText('Journey version')).toHaveValue(journey.id);

    const rows = screen
      .getAllByRole('listitem')
      .filter((item) => item.classList.contains('recorded-step-row'));
    expect(
      within(rows[0]!).getByRole('heading', { name: 'Open profile page' }),
    ).toBeVisible();
    expect(
      within(rows[3]!).getByRole('heading', { name: 'Save profile' }),
    ).toBeVisible();
    expect(screen.getAllByText('{{unique.email}}').length).toBeGreaterThan(0);
    expect(screen.getAllByText('{{var.PROFILE_TOKEN}}').length).toBeGreaterThan(
      0,
    );
    expect(screen.queryByText('secret=hidden')).not.toBeInTheDocument();
    expect(screen.queryByText('Register Visitor')).not.toBeInTheDocument();
    expect(
      screen.getAllByText('Technical step detail')[0]?.parentElement,
    ).not.toHaveAttribute('open');
  });

  it('marks the Critical Action and renders all supported Outcome Check types', async () => {
    renderDetail({
      replayValues: { [journey.id]: { PROFILE_TOKEN: 'ephemeral' } },
    });

    expect(await screen.findByText('Step 4')).toBeVisible();
    expect(screen.getAllByText('Critical Action').length).toBeGreaterThan(1);
    expect(
      screen.getAllByText('One saved profile appears.').length,
    ).toBeGreaterThan(0);
    expect(
      screen.getByText('Matching item appears exactly once'),
    ).toBeVisible();
    expect(
      screen.getAllByText('Confirmation is visible.').length,
    ).toBeGreaterThan(0);
    expect(screen.getByText('Visible element exists')).toBeVisible();
    expect(
      screen.getAllByText('The browser reaches the profile page.').length,
    ).toBeGreaterThan(0);
    expect(screen.getByText('Final pathname matches')).toBeVisible();
    expect(screen.getByText('/profile/saved')).toBeVisible();
    expect(screen.getAllByText('{{unique.email}}').length).toBeGreaterThan(0);
  });

  it('selects an exact historical version without mutating it', async () => {
    const user = userEvent.setup();
    const onSelectionChange = vi.fn();
    renderDetail({ journeys: [journey, previousVersion], onSelectionChange });

    await screen.findByText('One saved profile appears.');
    await user.selectOptions(
      screen.getByLabelText('Journey version'),
      previousVersion.id,
    );
    expect(onSelectionChange).toHaveBeenCalledWith(previousVersion.id);
    expect(
      screen.getByText(
        /Experiments reference this exact immutable journey version/,
      ),
    ).toBeVisible();
    expect(
      screen.getByRole('button', { name: 'Record new version' }),
    ).toBeVisible();
  });

  it('uses one state-driven primary action for missing Critical Action and missing Outcome Check', async () => {
    mocks.getCriticalAction.mockResolvedValueOnce(null);
    mocks.listOutcomeChecks.mockResolvedValueOnce([]);
    const { container, unmount } = renderDetail();
    expect(
      await within(container.querySelector('.journey-next-action')!).findByRole(
        'button',
        { name: 'Select Critical Action' },
      ),
    ).toHaveClass('journey-primary-action');
    expect(container.querySelectorAll('.journey-primary-action')).toHaveLength(
      1,
    );

    unmount();
    mocks.getCriticalAction.mockResolvedValueOnce(criticalAction);
    mocks.listOutcomeChecks.mockResolvedValueOnce([]);
    const second = renderDetail();
    expect(
      await within(
        second.container.querySelector('.journey-next-action')!,
      ).findByRole('button', { name: 'Define expected outcome' }),
    ).toHaveClass('journey-primary-action');
    expect(
      second.container.querySelectorAll('.journey-primary-action'),
    ).toHaveLength(1);
  });

  it('blocks replay for missing runtime data and masks the value input', async () => {
    const { container } = renderDetail();
    expect(
      await screen.findByRole('link', { name: 'Provide required test data' }),
    ).toHaveClass('journey-primary-action');
    expect(
      screen.getByLabelText(`${journey.name} PROFILE_TOKEN`),
    ).toHaveAttribute('type', 'password');
    expect(screen.getByText('1 missing')).toBeVisible();
    expect(container.querySelectorAll('.journey-primary-action')).toHaveLength(
      1,
    );
  });

  it('renders truthful hybrid, semantic, missing-trace, and video states', async () => {
    const first = renderDetail();
    expect(await screen.findAllByText('Trace available')).not.toHaveLength(0);
    expect(
      screen.getByText(
        /verifies its checksum and parses the immutable artifact before replay/,
      ),
    ).toBeVisible();
    expect(screen.getByText('View recording video')).toBeVisible();
    first.unmount();

    const second = renderDetail({
      journeys: [previousVersion],
      selectedJourneyId: previousVersion.id,
    });
    expect(await screen.findAllByText('Semantic compatible')).not.toHaveLength(
      0,
    );
    expect(
      screen.getByText(/remains supported and is not corrupt/),
    ).toBeVisible();
    second.unmount();

    const missingTrace = {
      ...journey,
      id: 'journey-missing-trace',
      trace: null,
    };
    renderDetail({
      journeys: [missingTrace],
      selectedJourneyId: missingTrace.id,
    });
    await screen.findByText('One saved profile appears.', {
      selector: '.journey-outcome-list strong',
    });
    const nextAction = screen.getByText('Next action').parentElement!;
    expect(
      nextAction.querySelector('.journey-primary-action'),
    ).toHaveTextContent('Record new version');
    expect(screen.getAllByText('Trace missing').length).toBeGreaterThan(0);
  });

  it('preserves replay mode and pacing controls and calls the existing handlers', async () => {
    const user = userEvent.setup();
    const onReplayModeChange = vi.fn();
    const onReplayPacingChange = vi.fn();
    renderDetail({ onReplayModeChange, onReplayPacingChange });
    await screen.findByText('One saved profile appears.');

    await user.selectOptions(screen.getByLabelText('Replay mode'), 'strict');
    await user.selectOptions(screen.getByLabelText('Replay pacing'), 'fast');
    expect(onReplayModeChange).toHaveBeenCalledWith('strict');
    expect(onReplayPacingChange).toHaveBeenCalledWith('fast');
    expect(
      screen.getByText(
        /Repeated-action injection timing is controlled separately/,
      ),
    ).toBeVisible();
  });

  it('shows an explicit empty state with a single record action', () => {
    const { container } = renderDetail({
      journeys: [],
      selectedJourneyId: null,
    });
    expect(
      screen.getByRole('heading', { name: 'No saved journey' }),
    ).toBeVisible();
    expect(screen.getByRole('link', { name: 'Record journey' })).toBeVisible();
    expect(container.querySelectorAll('.journey-primary-action')).toHaveLength(
      1,
    );
  });
});

function renderDetail(
  overrides: Partial<ComponentProps<typeof JourneyDetail>> = {},
) {
  const props: ComponentProps<typeof JourneyDetail> = {
    authCapture: null,
    authMessage: null,
    authenticationRequired: false,
    busy: null,
    executionSettings: settings,
    journeys: [journey],
    loading: false,
    onAuthenticationConfirm: vi.fn(),
    onAuthenticationStart: vi.fn(),
    onDelete: vi.fn(),
    onProductionConfirmationChange: vi.fn(),
    onReplay: vi.fn(),
    onReplayModeChange: vi.fn(),
    onReplayPacingChange: vi.fn(),
    onRuntimeValueChange: vi.fn(),
    onSelectionChange: vi.fn(),
    productionReplayConfirmed: true,
    project,
    replayMode: 'adaptive',
    replayPacing: 'recorded',
    replayResult: null,
    replayValues: {},
    selectedJourneyId: journey.id,
    ...overrides,
  };
  return render(<JourneyDetail {...props} />);
}
