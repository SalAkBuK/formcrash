import { describe, expect, it, vi } from 'vitest';

import { PlaywrightSampleRunExecutor } from '../src/runner/engine/sample-runner.js';
import type {
  BrowserLaunchOptions,
  BrowserOwner,
  CheckoutBrowserSession,
} from '../src/runner/infrastructure/browser-session.js';
import type { SampleApplicationState } from '../src/runner/sample/types.js';
import { TEST_SERVER_CONFIG } from './fixtures.js';

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

describe('sample runner failure handling', () => {
  it('classifies a Chromium launch failure as runner_error', async () => {
    const browserOwner: BrowserOwner = {
      launch: () =>
        Promise.reject(new Error('Browser executable is unavailable.')),
    };
    const executor = new PlaywrightSampleRunExecutor(TEST_SERVER_CONFIG, {
      browserOwner,
      readinessChecker: { assertReachable: () => Promise.resolve() },
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
    const executor = new PlaywrightSampleRunExecutor(
      {
        ...TEST_SERVER_CONFIG,
        browserTimeoutMs: 1_000,
        sampleCheckoutBaseUrl: 'http://127.0.0.1:1',
      },
      { browserOwner },
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
    const executor = new PlaywrightSampleRunExecutor(TEST_SERVER_CONFIG, {
      browserOwner,
      readinessChecker: { assertReachable: () => Promise.resolve() },
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
});
