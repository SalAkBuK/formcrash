import { act, render, screen, waitFor } from '@testing-library/react';
import type { PersistedRunDetail, RunStatus } from '@formcrash/contracts';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { RunDetailView } from '../src/features/run-result/components/run-detail-view';
import { buildEvent, buildRun } from './fixtures';

const mocks = vi.hoisted(() => ({ getRun: vi.fn() }));

vi.mock('../src/features/run-result/api/get-run', () => ({
  getRun: mocks.getRun,
  getRunEventsUrl: (runId: string, afterSequence = 0) =>
    `http://localhost:4100/api/runs/${runId}/events${
      afterSequence > 0 ? `?afterSequence=${afterSequence}` : ''
    }`,
  getArtifactUrl: (runId: string, artifactId: string) =>
    `http://localhost:4100/api/runs/${runId}/artifacts/${artifactId}`,
}));

class FakeEventSource {
  static readonly CONNECTING = 0;
  static readonly OPEN = 1;
  static readonly CLOSED = 2;
  static readonly instances: FakeEventSource[] = [];

  readonly url: string;
  readyState = FakeEventSource.CONNECTING;
  onopen: ((event: Event) => void) | null = null;
  onerror: ((event: Event) => void) | null = null;
  readonly listeners = new Map<string, Set<EventListener>>();
  readonly close = vi.fn(() => {
    this.readyState = FakeEventSource.CLOSED;
  });

  constructor(url: string | URL) {
    this.url = String(url);
    FakeEventSource.instances.push(this);
  }

  open(): void {
    this.readyState = FakeEventSource.OPEN;
    this.onopen?.(new Event('open'));
  }

  addEventListener(type: string, listener: EventListener): void {
    const listeners = this.listeners.get(type) ?? new Set<EventListener>();
    listeners.add(listener);
    this.listeners.set(type, listeners);
  }

  removeEventListener(type: string, listener: EventListener): void {
    this.listeners.get(type)?.delete(listener);
  }

  emit(value: unknown): void {
    const message = new MessageEvent('run-event', {
      data: JSON.stringify(value),
    });
    for (const listener of this.listeners.get('run-event') ?? []) {
      listener(message);
    }
  }

  disconnect(): void {
    this.readyState = FakeEventSource.CLOSED;
    this.onerror?.(new Event('error'));
  }
}

describe('live run progress', () => {
  beforeEach(() => {
    FakeEventSource.instances.length = 0;
    mocks.getRun.mockReset();
    mocks.getRun.mockResolvedValue(activeRun('running'));
    vi.stubGlobal('EventSource', FakeEventSource);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('opens SSE, orders and deduplicates events, then reloads authoritative terminal state', async () => {
    const terminal = activeRun('passed', {
      events: [
        buildEvent(1, 'journey.step.started', { stepName: 'Submit order' }),
        buildEvent(2, 'mystery.signal'),
        buildEvent(3, 'run.passed'),
      ],
    });
    const { container } = render(
      <RunDetailView initialRun={buildRun('running')} />,
    );

    expect(FakeEventSource.instances).toHaveLength(1);
    const source = FakeEventSource.instances[0]!;
    expect(source.url).toBe(
      'http://localhost:4100/api/runs/run-running/events',
    );
    expect(source.listeners.get('run-event')?.size).toBe(1);

    act(() => source.open());
    expect(screen.getByText('Live')).toBeVisible();

    act(() => {
      source.emit(buildEvent(2, 'mystery.signal'));
      source.emit(
        buildEvent(1, 'journey.step.started', { stepName: 'Submit order' }),
      );
      source.emit(
        buildEvent(1, 'journey.step.started', { stepName: 'Submit order' }),
      );
    });

    const timeline = [...container.querySelectorAll('.timeline-event')];
    expect(timeline).toHaveLength(2);
    expect(timeline[0]).toHaveTextContent('Journey step started');
    expect(timeline[1]).toHaveTextContent('Mystery signal');

    mocks.getRun.mockResolvedValue(terminal);
    act(() => source.emit(buildEvent(3, 'run.passed')));
    expect(source.close).toHaveBeenCalled();
    await waitFor(() =>
      expect(mocks.getRun).toHaveBeenCalledWith('run-running'),
    );
    expect(
      await screen.findByRole('heading', {
        name: 'Duplicate protection held',
      }),
    ).toBeVisible();
  });

  it('closes the live connection on unmount and never opens one for history', () => {
    const { unmount } = render(
      <RunDetailView initialRun={buildRun('running')} />,
    );
    const source = FakeEventSource.instances[0]!;
    unmount();
    expect(source.close).toHaveBeenCalledTimes(1);
    expect(source.listeners.get('run-event')?.size).toBe(0);

    render(<RunDetailView initialRun={buildRun('failed')} />);
    expect(FakeEventSource.instances).toHaveLength(1);
  });

  it('surfaces contract-invalid live data without discarding persisted evidence', () => {
    render(<RunDetailView initialRun={buildRun('running')} />);
    const source = FakeEventSource.instances[0]!;

    act(() => source.emit({ invalid: true }));
    expect(screen.getByRole('alert')).toHaveTextContent(
      'A live event did not match the public run-event contract.',
    );
    expect(
      screen.getByRole('heading', { name: 'Evidence timeline' }),
    ).toBeVisible();
  });

  it('reconciles authoritative state when the server closes before terminal UI settles', async () => {
    render(<RunDetailView initialRun={buildRun('running')} />);
    const source = FakeEventSource.instances[0]!;

    mocks.getRun.mockResolvedValue(activeRun('passed'));
    act(() => source.disconnect());

    await waitFor(() =>
      expect(mocks.getRun).toHaveBeenCalledWith('run-running'),
    );
    expect(
      await screen.findByRole('heading', {
        name: 'Duplicate protection held',
      }),
    ).toBeVisible();
  });

  it('retries persisted reconciliation and reconnects from the last processed sequence', async () => {
    let requests = 0;
    mocks.getRun.mockImplementation(() => {
      requests += 1;
      return Promise.resolve(
        requests < 3 ? activeRun('running') : activeRun('passed'),
      );
    });
    render(<RunDetailView initialRun={buildRun('running')} />);
    const source = FakeEventSource.instances[0]!;
    act(() => source.emit(buildEvent(1, 'run.running')));
    act(() => source.disconnect());

    await waitFor(() => expect(FakeEventSource.instances).toHaveLength(2), {
      timeout: 2_000,
    });
    expect(FakeEventSource.instances[1]!.url).toBe(
      'http://localhost:4100/api/runs/run-running/events?afterSequence=1',
    );
    expect(
      await screen.findByRole(
        'heading',
        { name: 'Duplicate protection held' },
        { timeout: 2_000 },
      ),
    ).toBeVisible();
    expect(screen.queryByText('Disconnected')).not.toBeInTheDocument();
  });

  it('prefers an authoritative terminal snapshot over late active events', async () => {
    render(<RunDetailView initialRun={buildRun('running')} />);
    const source = FakeEventSource.instances[0]!;
    mocks.getRun.mockResolvedValue(
      activeRun('passed', { events: [buildEvent(3, 'run.passed')] }),
    );

    act(() => source.emit(buildEvent(3, 'run.passed')));
    expect(
      await screen.findByRole('heading', {
        name: 'Duplicate protection held',
      }),
    ).toBeVisible();
    act(() => source.emit(buildEvent(4, 'run.starting')));

    expect(
      screen.getByRole('heading', { name: 'Duplicate protection held' }),
    ).toBeVisible();
    expect(screen.queryByText('Experiment running')).not.toBeInTheDocument();
    expect(screen.queryByText('Disconnected')).not.toBeInTheDocument();
  });

  it('does not let a stale persisted active event regress terminal lifecycle', () => {
    render(
      <RunDetailView
        initialRun={activeRun('passed', {
          events: [buildEvent(3, 'run.passed'), buildEvent(4, 'run.starting')],
        })}
      />,
    );

    expect(
      screen.getByRole('heading', { name: 'Duplicate protection held' }),
    ).toBeVisible();
    expect(screen.queryByText('Experiment running')).not.toBeInTheDocument();
    expect(FakeEventSource.instances).toHaveLength(0);
  });

  it('closes the fetch-subscribe race when persisted state is already terminal', async () => {
    mocks.getRun.mockResolvedValue(activeRun('passed'));
    render(<RunDetailView initialRun={buildRun('running')} />);
    const source = FakeEventSource.instances[0]!;

    expect(
      await screen.findByRole('heading', {
        name: 'Duplicate protection held',
      }),
    ).toBeVisible();
    expect(source.close).toHaveBeenCalled();
    expect(screen.queryByText('Experiment running')).not.toBeInTheDocument();
  });
});

function activeRun(
  status: RunStatus,
  options: Parameters<typeof buildRun>[1] = {},
): PersistedRunDetail {
  const run = buildRun(status, options);
  return {
    ...run,
    runId: 'run-running',
    events: run.events.map((event) => ({ ...event, runId: 'run-running' })),
    artifacts: run.artifacts.map((artifact) => ({
      ...artifact,
      runId: 'run-running',
    })),
  };
}
