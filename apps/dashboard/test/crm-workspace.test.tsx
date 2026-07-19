import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { ProjectListScreen } from '../src/features/projects/components/project-list-screen';
import { ProjectWorkspaceLayout } from '../src/features/projects/components/project-workspace-layout';
import { readGuidedTestDraft } from '../src/features/projects/components/test-builder-screen';

const navigation = vi.hoisted(() => ({
  pathname: '/projects/project-one/journeys',
  push: vi.fn(),
  replace: vi.fn(),
}));
const api = vi.hoisted(() => ({
  createProject: vi.fn(),
  deleteProject: vi.fn(),
  getProject: vi.fn(),
  listProjects: vi.fn(),
}));

vi.mock('next/navigation', () => ({
  usePathname: () => navigation.pathname,
  useRouter: () => ({ push: navigation.push, replace: navigation.replace }),
  useSearchParams: () => new URLSearchParams(),
}));
vi.mock('../src/features/projects/api/projects', async (importOriginal) => ({
  ...(await importOriginal()),
  createProject: api.createProject,
  deleteProject: api.deleteProject,
  getProject: api.getProject,
  listProjects: api.listProjects,
}));

const first = {
  id: 'project-one',
  name: 'Account portal',
  targetUrl: 'http://localhost:4300',
  environment: 'local' as const,
  description: 'Controlled account fixture',
  createdAt: '2026-07-19T00:00:00.000Z',
  updatedAt: '2026-07-19T00:00:00.000Z',
};
const second = {
  ...first,
  id: 'project-two',
  name: 'Checkout staging',
  targetUrl: 'https://staging.example.test',
  environment: 'staging' as const,
};

beforeEach(() => {
  vi.clearAllMocks();
  window.sessionStorage.clear();
  api.getProject.mockResolvedValue(first);
  api.listProjects.mockResolvedValue([first, second]);
});

describe('CRM project workspace', () => {
  it('renders durable project tabs and marks the matching nested route current', async () => {
    navigation.pathname = '/projects/project-one/journeys/journey-one/replay';
    render(
      <ProjectWorkspaceLayout projectId={first.id}>
        <main>Nested route</main>
      </ProjectWorkspaceLayout>,
    );

    expect(
      await screen.findByRole('heading', { name: first.name }),
    ).toBeVisible();
    expect(screen.getByRole('link', { name: 'Journeys' })).toHaveAttribute(
      'aria-current',
      'page',
    );
    expect(screen.getByRole('link', { name: 'Tests' })).toHaveAttribute(
      'href',
      `/projects/${first.id}/tests`,
    );
    expect(screen.getByRole('main')).toHaveTextContent('Nested route');
  });

  it('switches projects through a real project selector', async () => {
    const user = userEvent.setup();
    render(
      <ProjectWorkspaceLayout projectId={first.id}>
        <main>Overview</main>
      </ProjectWorkspaceLayout>,
    );
    await user.selectOptions(
      await screen.findByLabelText('Switch project'),
      second.id,
    );
    expect(navigation.push).toHaveBeenCalledWith(`/projects/${second.id}`);
  });

  it('filters the project directory without hiding canonical links', async () => {
    const user = userEvent.setup();
    render(<ProjectListScreen />);
    await screen.findByText(first.name);
    await user.type(screen.getByPlaceholderText('Search projects'), 'checkout');
    await waitFor(() =>
      expect(screen.queryByText(first.name)).not.toBeInTheDocument(),
    );
    expect(
      screen.getByRole('link', { name: /Checkout staging/ }),
    ).toHaveAttribute('href', `/projects/${second.id}`);
  });

  it('sanitizes restored Guided Test drafts and rejects unsafe value modes', () => {
    const key = `formcrash:guided-test-draft:v1:${first.id}`;
    window.sessionStorage.setItem(
      key,
      JSON.stringify({
        version: 1,
        projectId: first.id,
        journeyId: 'journey-one',
        stage: 'review',
        recipeId: 'duplicate_action',
        replayPacing: 'recorded',
        experimentName: 'Duplicate submit',
        stepValueModes: { email: 'unique_email' },
        runtimeValues: { PASSWORD: 'must-not-restore' },
        productionConfirmed: true,
        authentication: { cookie: 'must-not-restore' },
      }),
    );

    const restored = readGuidedTestDraft(first.id);
    expect(restored).toEqual({
      version: 1,
      projectId: first.id,
      journeyId: 'journey-one',
      stage: 'review',
      recipeId: 'duplicate_action',
      replayPacing: 'recorded',
      experimentName: 'Duplicate submit',
      stepValueModes: { email: 'unique_email' },
    });
    expect(restored).not.toHaveProperty('runtimeValues');
    expect(restored).not.toHaveProperty('productionConfirmed');

    window.sessionStorage.setItem(
      key,
      JSON.stringify({ ...restored, stepValueModes: { email: 'custom' } }),
    );
    expect(readGuidedTestDraft(first.id)).toBeNull();
    expect(window.sessionStorage.getItem(key)).toBeNull();
  });
});
