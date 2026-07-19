import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { RunDetailRoute } from '../src/features/run-result/components/run-detail-route';
import { RunDetailView } from '../src/features/run-result/components/run-detail-view';
import { FormCrashApiError } from '../src/lib/api-client';
import { buildRun } from './fixtures';

const mocks = vi.hoisted(() => ({ getRun: vi.fn() }));

vi.mock('../src/features/run-result/api/get-run', () => ({
  getRun: mocks.getRun,
  getRunEventsUrl: (runId: string) =>
    `http://localhost:4100/api/runs/${runId}/events`,
  getArtifactUrl: (runId: string, artifactId: string) =>
    `http://localhost:4100/api/runs/${runId}/artifacts/${artifactId}`,
}));

describe('RunDetailView', () => {
  beforeEach(() => {
    mocks.getRun.mockReset();
  });

  it('distinguishes an assertion failure and exposes request, order and screenshot evidence', () => {
    render(<RunDetailView initialRun={buildRun('failed')} />);

    expect(
      screen.getByRole('heading', {
        name: 'Vulnerability reproduced',
      }),
    ).toBeVisible();
    expect(
      screen.getByRole('heading', {
        name: 'Two submissions created two orders',
      }),
    ).toBeVisible();
    expect(
      screen.getByText(/application created 2 separate orders/),
    ).toBeVisible();
    expect(
      screen.getByText('No more than one order should be created.'),
    ).toBeVisible();
    expect(screen.getByText('2 orders were created.')).toBeVisible();
    expect(
      screen.getByText('Rapid triggers').nextElementSibling,
    ).toHaveTextContent('2');
    expect(
      screen.getByText('Requests accepted').nextElementSibling,
    ).toHaveTextContent('2');
    expect(
      screen.getByText('Orders created').nextElementSibling,
    ).toHaveTextContent('2');
    expect(
      screen.getByText('Maximum allowed').nextElementSibling,
    ).toHaveTextContent('1');
    expect(
      screen.getByRole('heading', {
        name: 'Customers can create duplicate transactions',
      }),
    ).toBeVisible();

    const evidenceDetails = screen
      .getByText(/Inspect request counts/)
      .closest('details');
    expect(evidenceDetails).not.toHaveAttribute('open');
    fireEvent.click(screen.getByText(/Inspect request counts/));
    expect(
      screen.getByText('Browser order requests').nextElementSibling,
    ).toHaveTextContent('2');
    expect(screen.getByText('order-1')).toBeVisible();

    const timeline = screen.getByText('Technical timeline').closest('details');
    expect(timeline).not.toHaveAttribute('open');
    expect(screen.getAllByRole('img')).toHaveLength(3);
    expect(screen.getByAltText(/Before disruption/)).toHaveAttribute(
      'src',
      'http://localhost:4100/api/runs/run-failed/artifacts/artifact-1',
    );
  });

  it('keeps passed, incomplete and runner-error outcomes semantically distinct', () => {
    const first = render(<RunDetailView initialRun={buildRun('passed')} />);
    expect(
      screen.getByRole('heading', { name: 'Duplicate protection held' }),
    ).toBeVisible();

    first.unmount();
    const second = render(
      <RunDetailView initialRun={buildRun('incomplete')} />,
    );
    expect(
      screen.getByRole('heading', { name: 'Run incomplete' }),
    ).toBeVisible();

    second.unmount();
    render(<RunDetailView initialRun={buildRun('runner_error')} />);
    expect(
      screen.getByRole('heading', { name: 'Runner stopped with an error' }),
    ).toBeVisible();
    expect(
      screen.getByText(/This is not an application assertion failure/),
    ).toBeVisible();
    expect(
      screen.getByRole('heading', {
        name: 'The browser run could not finish',
      }).parentElement,
    ).toHaveTextContent('The saved Submit Order step could not be completed.');
  });

  it('renders exactly three honest screenshot slots and degrades a failed image', () => {
    const first = render(
      <RunDetailView initialRun={buildRun('passed', { artifacts: [] })} />,
    );
    expect(screen.getAllByText(/Screenshot unavailable/)).toHaveLength(3);

    first.unmount();
    render(<RunDetailView initialRun={buildRun('passed')} />);
    const image = screen.getByAltText(/Before disruption/);
    fireEvent.error(image);
    expect(screen.getAllByText(/Screenshot unavailable/)).toHaveLength(1);
    expect(screen.getAllByRole('img')).toHaveLength(2);
  });
});

describe('RunDetailRoute', () => {
  beforeEach(() => {
    mocks.getRun.mockReset();
  });

  it('loads a directly addressed persisted run', async () => {
    mocks.getRun.mockResolvedValue(buildRun('passed'));
    render(<RunDetailRoute runId="run-passed" />);

    expect(screen.getByRole('status')).toHaveTextContent(
      'Reading the authoritative run snapshot.',
    );
    expect(
      await screen.findByRole('heading', {
        name: 'Duplicate protection held',
      }),
    ).toBeVisible();
  });

  it('reports an unknown durable run ID', async () => {
    mocks.getRun.mockRejectedValue(
      new FormCrashApiError(404, 'RUN_NOT_FOUND', 'Run not found.'),
    );
    render(<RunDetailRoute runId="missing-run" />);

    expect(
      await screen.findByRole('heading', { name: 'Run not found' }),
    ).toBeVisible();
    expect(screen.getByText('missing-run')).toBeVisible();
    await waitFor(() =>
      expect(mocks.getRun).toHaveBeenCalledWith('missing-run'),
    );
  });
});
