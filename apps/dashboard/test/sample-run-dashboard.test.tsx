import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { SampleRunDashboard } from '../src/features/sample-run/components/sample-run-dashboard';
import { FormCrashApiError } from '../src/lib/api-client';
import { buildRunSummary } from './fixtures';

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

describe('SampleRunDashboard', () => {
  beforeEach(() => {
    mocks.getRecentRuns.mockResolvedValue({ items: [], limit: 12, offset: 0 });
    mocks.startSampleRun.mockResolvedValue({
      runId: 'run-new',
      status: 'created',
      detailUrl: '/api/runs/run-new',
      eventsUrl: '/api/runs/run-new/events',
    });
  });

  it('selects a mode, starts an accepted run and routes to its durable ID', async () => {
    const user = userEvent.setup();
    render(<SampleRunDashboard />);

    await screen.findByRole('heading', { name: 'No runs yet' });
    expect(screen.getByRole('radio', { name: /Vulnerable/ })).toBeChecked();
    await user.click(screen.getByRole('radio', { name: /Fixed/ }));
    expect(screen.getByRole('radio', { name: /Fixed/ })).toBeChecked();
    await user.click(
      screen.getByRole('button', {
        name: 'Run Sample Experiment — Fixed',
      }),
    );

    expect(mocks.startSampleRun).toHaveBeenCalledWith('fixed');
    await waitFor(() =>
      expect(mocks.push).toHaveBeenCalledWith('/runs/run-new'),
    );
  });

  it('shows an explicit busy history state while the bounded request is pending', () => {
    mocks.getRecentRuns.mockReturnValue(new Promise(() => undefined));
    render(<SampleRunDashboard />);

    expect(screen.getByRole('status')).toHaveTextContent(
      'Loading persisted run history',
    );
    expect(screen.getByRole('button', { name: 'Refreshing…' })).toBeDisabled();
  });

  it('explains the single-browser conflict without hiding persisted history', async () => {
    mocks.getRecentRuns.mockResolvedValue({
      items: [buildRunSummary('failed')],
      limit: 12,
      offset: 0,
    });
    mocks.startSampleRun.mockRejectedValue(
      new FormCrashApiError(409, 'SAMPLE_RUN_ACTIVE', 'A run is active.'),
    );
    const user = userEvent.setup();
    render(<SampleRunDashboard />);

    await screen.findByText('Vulnerable mode');
    await user.click(
      screen.getByRole('button', {
        name: 'Run Sample Experiment — Vulnerable',
      }),
    );

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Another browser run is active',
    );
    expect(
      screen.getByRole('link', { name: /Vulnerable mode/ }),
    ).toHaveAttribute('href', '/runs/run-failed');
  });

  it('renders a recoverable history error and keeps sample execution available', async () => {
    mocks.getRecentRuns.mockRejectedValue(
      new Error('History endpoint failed.'),
    );
    const user = userEvent.setup();
    render(<SampleRunDashboard />);

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'History endpoint failed. Sample execution remains available.',
    );
    expect(
      screen.getByRole('button', {
        name: 'Run Sample Experiment — Vulnerable',
      }),
    ).toBeEnabled();

    mocks.getRecentRuns.mockResolvedValue({ items: [], limit: 12, offset: 0 });
    await user.click(screen.getByRole('button', { name: 'Refresh' }));
    expect(
      await screen.findByRole('heading', { name: 'No runs yet' }),
    ).toBeVisible();
  });

  it('keeps the reusable external-project workflow directly accessible', async () => {
    render(<SampleRunDashboard />);

    expect(
      await screen.findByRole('link', { name: 'Test Your Application' }),
    ).toHaveAttribute('href', '/projects');
    expect(
      screen.getByRole('heading', { name: 'Run Sample Experiment' }),
    ).toBeVisible();
  });
});
