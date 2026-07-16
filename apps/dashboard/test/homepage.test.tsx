import { render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import HomePage from '../src/app/page';

const mocks = vi.hoisted(() => ({
  getRecentRuns: vi.fn(),
  push: vi.fn(),
  startSampleRun: vi.fn(),
}));

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: mocks.push }),
}));

vi.mock('../src/features/run-history/api/get-runs', () => ({
  getRecentRuns: mocks.getRecentRuns,
}));

vi.mock('../src/features/sample-run/api/start-sample-run', () => ({
  startSampleRun: mocks.startSampleRun,
}));

describe('dashboard homepage', () => {
  beforeEach(() => {
    mocks.getRecentRuns.mockResolvedValue({ items: [], limit: 12, offset: 0 });
  });

  it('uses the bundled sample as the primary path without asking for a recording', async () => {
    render(<HomePage />);

    expect(
      await screen.findByRole('button', {
        name: 'Run Sample Experiment — Vulnerable',
      }),
    ).toBeVisible();
    expect(
      screen.getByRole('link', { name: 'Test Your Application' }),
    ).toHaveAttribute('href', '/projects');
    expect(screen.queryByText('Start recording')).not.toBeInTheDocument();
  });
});
