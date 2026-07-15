import { act, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { RunDetailView } from '../src/features/run-result/components/run-detail-view';
import { buildEvent, buildRun } from './fixtures';

const mocks = vi.hoisted(() => ({ getRun: vi.fn() }));

vi.mock('../src/features/run-result/api/get-run', () => ({
  getRun: mocks.getRun,
  getRunEventsUrl: (runId: string) =>
    `http://localhost:4100/api/runs/${runId}/events`,
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
    vi.stubGlobal('EventSource', FakeEventSource);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('opens SSE, orders and deduplicates events, then reloads authoritative terminal state', async () => {
    const terminal = buildRun('passed', {
      events: [
        buildEvent(1, 'journey.step.started', { stepName: 'Submit order' }),
        buildEvent(2, 'mystery.signal'),
        buildEvent(3, 'run.passed'),
      ],
    });
    mocks.getRun.mockResolvedValue(terminal);
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
    mocks.getRun.mockResolvedValue(buildRun('passed'));
    render(<RunDetailView initialRun={buildRun('running')} />);
    const source = FakeEventSource.instances[0]!;

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
});
