import { afterEach, describe, expect, it, vi } from 'vitest';

import { ScreenshotStore } from '../src/artifacts/screenshot-store.js';
import type { ServerConfig } from '../src/app/config.js';
import { RunEventBroker } from '../src/events/run-event-broker.js';
import { initializePersistence } from '../src/persistence/initialize.js';
import { RunRepository } from '../src/persistence/run-repository.js';
import { RunPersistenceError } from '../src/persistence/run-repository.js';
import { SampleRunCoordinator } from '../src/runner/engine/sample-run-coordinator.js';
import { PlaywrightSampleRunExecutor } from '../src/runner/engine/sample-runner.js';
import type {
  BrowserLaunchOptions,
  BrowserOwner,
  CheckoutBrowserSession,
} from '../src/runner/infrastructure/browser-session.js';
import type { SampleApplicationState } from '../src/runner/sample/types.js';
import { createTemporaryTestConfig } from './fixtures.js';

const cleanups: Array<() => void> = [];

afterEach(() => {
  for (const cleanup of cleanups.splice(0)) cleanup();
});

class FailingJourneySession implements CheckoutBrowserSession {
  closed = false;

  observeOrderRequests(): void {}

  navigate(): Promise<void> {
    return Promise.resolve();
  }

  click(): Promise<void> {
    return Promise.resolve();
  }

  fill(): Promise<void> {
    return Promise.resolve();
  }

  waitForVisible(): Promise<void> {
    return Promise.reject(new Error('Selector was not found.'));
  }

  captureScreenshot(): Promise<void> {
    return Promise.resolve();
  }

  resetSampleState(): Promise<void> {
    return Promise.resolve();
  }

  readSampleState(): Promise<SampleApplicationState> {
    return Promise.resolve({
      counts: {
        orders: 0,
        requests: 0,
        accepted: 0,
        deduplicated: 0,
        rejected: 0,
      },
      orders: [],
    });
  }

  pendingOrderRequestCount(): number {
    return 0;
  }

  close(): Promise<void> {
    this.closed = true;
    return Promise.resolve();
  }
}

class SuccessfulSession implements CheckoutBrowserSession {
  observeOrderRequests(): void {}
  navigate(): Promise<void> {
    return Promise.resolve();
  }
  click(): Promise<void> {
    return Promise.resolve();
  }
  fill(): Promise<void> {
    return Promise.resolve();
  }
  waitForVisible(): Promise<void> {
    return Promise.resolve();
  }
  captureScreenshot(): Promise<void> {
    return Promise.reject(new Error('Screenshot API failed.'));
  }
  resetSampleState(): Promise<void> {
    return Promise.resolve();
  }
  readSampleState(): Promise<SampleApplicationState> {
    return Promise.resolve({
      counts: {
        orders: 1,
        requests: 1,
        accepted: 1,
        deduplicated: 0,
        rejected: 0,
      },
      orders: [{ id: 'order-1' }],
    });
  }
  pendingOrderRequestCount(): number {
    return 0;
  }
  close(): Promise<void> {
    return Promise.resolve();
  }
}

describe('sample runner failure handling', () => {
  it('classifies a Chromium launch failure as runner_error', async () => {
    const browserOwner: BrowserOwner = {
      launch: () =>
        Promise.reject(new Error('Browser executable is unavailable.')),
    };
    const executor = createExecutor({}, browserOwner, {
      assertReachable: () => Promise.resolve(),
    });

    const result = await executor.run('fixed');

    expect(result.status).toBe('runner_error');
    expect(result.runnerError).toMatchObject({ code: 'browser_launch_failed' });
    expect(result.assertions[0]?.status).toBe('not_evaluated');
  });

  it('returns runner_error when the sample target is unavailable', async () => {
    const launch =
      vi.fn<
        (options: BrowserLaunchOptions) => Promise<CheckoutBrowserSession>
      >();
    const browserOwner: BrowserOwner = { launch };
    const executor = createExecutor(
      {
        browserTimeoutMs: 1_000,
        sampleCheckoutBaseUrl: 'http://127.0.0.1:1',
      },
      browserOwner,
    );

    const result = await executor.run('vulnerable');

    expect(result.status).toBe('runner_error');
    expect(result.runnerError).toMatchObject({ code: 'target_unavailable' });
    expect(result.events.map((event) => event.eventType)).toContain(
      'runner.error',
    );
    expect(launch).not.toHaveBeenCalled();
  });

  it('identifies the exact failed journey step and closes the browser', async () => {
    const session = new FailingJourneySession();
    const browserOwner: BrowserOwner = {
      launch: () => Promise.resolve(session),
    };
    const executor = createExecutor({}, browserOwner, {
      assertReachable: () => Promise.resolve(),
    });

    const result = await executor.run('fixed');

    expect(result.status).toBe('runner_error');
    expect(result.runnerError).toMatchObject({
      code: 'journey_step_failed',
      failedStep: {
        stepId: 'verify-cart',
        actionType: 'wait_for_visible',
        selector: 'cart',
      },
    });
    expect(session.closed).toBe(true);
    expect(result.events.map((event) => event.eventType)).toContain(
      'browser.closed',
    );
  });

  it('creates the durable run before browser launch', async () => {
    const holder: { repository?: RunRepository } = {};
    const browserOwner: BrowserOwner = {
      launch: () => {
        expect(holder.repository?.listRuns(10, 0).items).toMatchObject([
          { status: 'starting' },
        ]);
        return Promise.reject(new Error('Expected launch stop.'));
      },
    };
    const context = createExecutorContext({}, browserOwner, {
      assertReachable: () => Promise.resolve(),
    });
    holder.repository = context.repository;

    const result = await context.executor.run('fixed');

    expect(result.status).toBe('runner_error');
    expect(result.runnerError?.code).toBe('browser_launch_failed');
  });

  it('publishes each event only after that event is persisted', async () => {
    const broker = new RunEventBroker();
    const context = createExecutorContext(
      {},
      { launch: () => Promise.reject(new Error('Expected launch stop.')) },
      { assertReachable: () => Promise.resolve() },
      broker,
    );
    const execution = context.executor.prepare('fixed');
    const publishedSequences: number[] = [];
    broker.subscribe(execution.runId, {
      onEvent: (runEvent) => {
        expect(
          context.repository
            .getEventsAfter(execution.runId, runEvent.sequence - 1)
            .some((persisted) => persisted.eventId === runEvent.eventId),
        ).toBe(true);
        publishedSequences.push(runEvent.sequence);
      },
      onTerminal: () => undefined,
      onServerClose: () => undefined,
    });

    await execution.execute();

    expect(publishedSequences.length).toBeGreaterThan(0);
    expect(publishedSequences).toEqual(
      publishedSequences.map((_, index) => index + 1),
    );
  });

  it('keeps a passing assertion when all screenshots fail and releases the lock', async () => {
    const context = createExecutorContext(
      {},
      { launch: () => Promise.resolve(new SuccessfulSession()) },
      { assertReachable: () => Promise.resolve() },
    );
    const coordinator = new SampleRunCoordinator(context.executor);

    const firstStart = coordinator.start('fixed');
    await coordinator.waitForIdle();
    const first = context.repository.getRun(firstStart.runId);
    const secondStart = coordinator.start('fixed');
    await coordinator.waitForIdle();
    const second = context.repository.getRun(secondStart.runId);

    expect(first?.status).toBe('passed');
    expect(first?.assertions[0]?.status).toBe('passed');
    expect(first?.artifacts).toEqual([]);
    expect(first?.evidenceWarnings).toHaveLength(3);
    expect(
      first?.events.filter(
        (event) => event.eventType === 'artifact.capture_failed',
      ),
    ).toHaveLength(3);
    expect(second?.status).toBe('passed');
    expect(coordinator.isActive).toBe(false);
  });

  it('does not represent a database failure as an assertion failure', async () => {
    const holder: { closeDatabase?: () => void } = {};
    const context = createExecutorContext(
      {},
      {
        launch: () => {
          holder.closeDatabase?.();
          return Promise.resolve(new SuccessfulSession());
        },
      },
      { assertReachable: () => Promise.resolve() },
    );
    holder.closeDatabase = context.database.close.bind(context.database);
    const onAsyncError = vi.fn();
    const coordinator = new SampleRunCoordinator(context.executor, {
      onAsyncError,
    });

    coordinator.start('fixed');
    await coordinator.waitForIdle();
    expect(onAsyncError).toHaveBeenCalledWith(
      expect.any(RunPersistenceError),
      expect.any(String),
    );
    expect(coordinator.isActive).toBe(false);
  });
});

function createExecutor(
  configOverrides: Partial<ServerConfig>,
  browserOwner: BrowserOwner,
  readinessChecker?: {
    assertReachable(baseUrl: string, timeoutMs: number): Promise<void>;
  },
): PlaywrightSampleRunExecutor {
  return createExecutorContext(configOverrides, browserOwner, readinessChecker)
    .executor;
}

function createExecutorContext(
  configOverrides: Partial<ServerConfig>,
  browserOwner: BrowserOwner,
  readinessChecker?: {
    assertReachable(baseUrl: string, timeoutMs: number): Promise<void>;
  },
  eventBroker?: RunEventBroker,
) {
  const temporary = createTemporaryTestConfig(configOverrides);
  const database = initializePersistence(temporary.config);
  const repository = new RunRepository(database.connection);
  const screenshotStore = new ScreenshotStore(
    temporary.config.artifactRoot,
    repository,
  );
  cleanups.push(() => {
    database.close();
    temporary.cleanup();
  });
  const executor = new PlaywrightSampleRunExecutor(temporary.config, {
    repository,
    screenshotStore,
    browserOwner,
    ...(readinessChecker === undefined ? {} : { readinessChecker }),
    ...(eventBroker === undefined ? {} : { eventBroker }),
  });
  return { executor, repository, database };
}
