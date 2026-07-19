import { StrictMode } from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { JourneyWorkspaceScreen } from '../src/features/projects/components/journey-workspace-screen';
import { TestBuilderScreen } from '../src/features/projects/components/test-builder-screen';

const navigation = vi.hoisted(() => ({
  pathname: '/projects/project-one/tests/new',
  search: 'journeyId=journey-one&step=outcome',
  push: vi.fn(),
  replace: vi.fn(),
}));

const projectsApi = vi.hoisted(() => ({
  deleteJourney: vi.fn(),
  getProject: vi.fn(),
  listJourneys: vi.fn(),
  replayJourney: vi.fn(),
}));

const experimentApi = vi.hoisted(() => ({
  confirmAuthenticationCapture: vi.fn(),
  getProjectSettings: vi.fn(),
  startAuthenticationCapture: vi.fn(),
}));

vi.mock('next/navigation', () => ({
  usePathname: () => navigation.pathname,
  useRouter: () => ({
    push: navigation.push,
    replace: navigation.replace,
  }),
  useSearchParams: () => new URLSearchParams(navigation.search),
}));

vi.mock('../src/features/projects/api/projects', () => projectsApi);

vi.mock(
  '../src/features/projects/api/external-experiments',
  () => experimentApi,
);

vi.mock(
  '../src/features/projects/components/external-experiment-panel',
  () => ({
    ExternalExperimentPanel: (props: {
      readonly guidedDraft: {
        readonly journeyId: string;
        readonly stage: string;
      } | null;
      readonly onGuidedStageChange: (stage: 'safety') => void;
    }) => (
      <div>
        <span data-testid="hydrated-stage">{props.guidedDraft?.stage}</span>
        <span data-testid="hydrated-journey">
          {props.guidedDraft?.journeyId}
        </span>
        <button
          onClick={() => props.onGuidedStageChange('safety')}
          type="button"
        >
          Continue test setup
        </button>
      </div>
    ),
  }),
);

vi.mock('../src/features/projects/components/journey-detail', () => ({
  JourneyDetail: (props: { readonly onOpenTest?: () => void }) => (
    <button onClick={props.onOpenTest} type="button">
      Configure test
    </button>
  ),
}));

const project = {
  id: 'project-one',
  name: 'Checkout',
  targetUrl: 'http://localhost:4300/checkout',
  environment: 'local' as const,
  description: '',
  createdAt: '2026-07-19T00:00:00.000Z',
  updatedAt: '2026-07-19T00:00:00.000Z',
};

const journey = {
  id: 'journey-one',
  projectId: project.id,
  name: 'Place order',
  version: 1,
  steps: [
    {
      id: 'place-order',
      name: 'Place order',
      type: 'click' as const,
      timestamp: 1,
      url: project.targetUrl,
      locator: {
        strategy: 'role' as const,
        role: 'button',
        name: 'Place order',
      },
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

beforeEach(() => {
  vi.clearAllMocks();
  window.sessionStorage.clear();
  navigation.pathname = '/projects/project-one/tests/new';
  navigation.search = 'journeyId=journey-one&step=outcome';
  projectsApi.getProject.mockResolvedValue(project);
  projectsApi.listJourneys.mockResolvedValue([journey]);
  experimentApi.getProjectSettings.mockResolvedValue({
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
    updatedAt: '2026-07-19T00:00:00.000Z',
  });
});

describe('Configure Test navigation', () => {
  it('performs one navigation with the expected journey and step per click', async () => {
    const user = userEvent.setup();
    render(
      <JourneyWorkspaceScreen journeyId={journey.id} projectId={project.id} />,
    );

    await user.click(
      await screen.findByRole('button', { name: 'Configure test' }),
    );

    expect(navigation.push).toHaveBeenCalledTimes(1);
    expect(navigation.push).toHaveBeenCalledWith(
      `/projects/${project.id}/tests/new?journeyId=${journey.id}&step=outcome`,
    );
  });

  it('does not navigate while hydrating, idle, rerendering, or under Strict Mode', async () => {
    const view = render(
      <StrictMode>
        <TestBuilderScreen projectId={project.id} />
      </StrictMode>,
    );

    await waitFor(() =>
      expect(screen.getByTestId('hydrated-stage')).toHaveTextContent('outcome'),
    );
    expect(screen.getByTestId('hydrated-journey')).toHaveTextContent(
      journey.id,
    );
    await waitFor(() => expect(projectsApi.getProject).toHaveBeenCalledOnce());
    expect(projectsApi.listJourneys).toHaveBeenCalledOnce();
    expect(navigation.replace).not.toHaveBeenCalled();

    view.rerender(
      <StrictMode>
        <TestBuilderScreen projectId={project.id} />
      </StrictMode>,
    );
    await waitFor(() => expect(navigation.replace).not.toHaveBeenCalled());
  });

  it('updates a changed step once and hydrates back/forward changes without a router call', async () => {
    const user = userEvent.setup();
    const view = render(<TestBuilderScreen projectId={project.id} />);
    await waitFor(() =>
      expect(screen.getByTestId('hydrated-stage')).toHaveTextContent('outcome'),
    );

    await user.click(
      screen.getByRole('button', { name: 'Continue test setup' }),
    );
    expect(navigation.replace).toHaveBeenCalledTimes(1);
    expect(navigation.replace).toHaveBeenCalledWith(
      `/projects/${project.id}/tests/new?step=safety&journeyId=${journey.id}`,
      { scroll: false },
    );

    navigation.search = 'step=safety&journeyId=journey-one';
    view.rerender(<TestBuilderScreen projectId={project.id} />);
    await waitFor(() =>
      expect(screen.getByTestId('hydrated-stage')).toHaveTextContent('safety'),
    );
    expect(navigation.replace).toHaveBeenCalledTimes(1);

    navigation.search = 'step=outcome&journeyId=journey-one';
    view.rerender(<TestBuilderScreen projectId={project.id} />);
    await waitFor(() =>
      expect(screen.getByTestId('hydrated-stage')).toHaveTextContent('outcome'),
    );
    expect(navigation.replace).toHaveBeenCalledTimes(1);
  });
});
