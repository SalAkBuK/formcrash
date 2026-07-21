import { render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { ExternalRunDetailRoute } from '../src/features/projects/components/external-run-detail-route';

const api = vi.hoisted(() => ({
  getExternalRun: vi.fn(),
  listExternalRuns: vi.fn(),
}));

vi.mock('../src/features/projects/api/external-experiments', () => api);
vi.mock('../src/features/projects/components/external-run-result', () => ({
  ExternalRunResult: () => <div>Run result</div>,
}));
vi.mock('../src/features/projects/components/external-run-comparison', () => ({
  ExternalRunComparison: () => <div>Run comparison</div>,
}));

describe('saved Run record navigation', () => {
  beforeEach(() => {
    api.getExternalRun.mockReset();
    api.listExternalRuns.mockReset();
    api.getExternalRun.mockResolvedValue({
      runId: 'run-12345678',
      projectId: 'project-one',
      journeyId: 'journey-one',
      experimentSnapshot: { experimentId: 'stable-test-one' },
    });
    api.listExternalRuns.mockResolvedValue({ items: [] });
  });

  it('links the Run back to its Project, Journey, and stable Test', async () => {
    render(<ExternalRunDetailRoute runId="run-12345678" />);

    expect(await screen.findByText('Run result')).toBeVisible();
    expect(screen.getByRole('link', { name: 'Journey' })).toHaveAttribute(
      'href',
      '/projects/project-one/journeys/journey-one',
    );
    expect(screen.getByRole('link', { name: 'Test detail' })).toHaveAttribute(
      'href',
      '/projects/project-one/tests/stable-test-one',
    );
    expect(screen.getByRole('link', { name: 'Project runs' })).toHaveAttribute(
      'href',
      '/projects/project-one/runs',
    );
  });
});
