import { describe, expect, it, vi } from 'vitest';

import {
  ActiveSampleRunError,
  SampleRunCoordinator,
} from '../src/runner/engine/sample-run-coordinator.js';
import type {
  SampleRunExecutor,
  SampleRunResult,
} from '../src/runner/sample/types.js';
import { buildSampleRunResult } from './fixtures.js';

function deferredExecutor(): {
  executor: SampleRunExecutor;
  resolve: (result: SampleRunResult) => void;
} {
  let resolveResult: ((result: SampleRunResult) => void) | undefined;
  const resultPromise = new Promise<SampleRunResult>((resolve) => {
    resolveResult = resolve;
  });
  return {
    executor: {
      prepare: () => ({
        runId: 'deferred-run',
        execute: () => resultPromise,
      }),
    },
    resolve: (result) => {
      if (resolveResult === undefined) {
        throw new Error('Deferred result is not ready.');
      }
      resolveResult(result);
    },
  };
}

describe('single active asynchronous sample run', () => {
  it('returns a durable run handle and rejects a second start', async () => {
    const deferred = deferredExecutor();
    const coordinator = new SampleRunCoordinator(deferred.executor);

    expect(coordinator.start('vulnerable')).toEqual({
      runId: 'deferred-run',
      status: 'created',
      detailUrl: '/api/runs/deferred-run',
      eventsUrl: '/api/runs/deferred-run/events',
    });
    expect(() => coordinator.start('fixed')).toThrow(ActiveSampleRunError);

    deferred.resolve(buildSampleRunResult());
    await coordinator.waitForIdle();
    expect(coordinator.isActive).toBe(false);
  });

  it('releases the lock after each terminal result', async () => {
    let sequence = 0;
    const executor: SampleRunExecutor = {
      prepare: () => {
        sequence += 1;
        return {
          runId: `run-${sequence}`,
          execute: () => Promise.resolve(buildSampleRunResult()),
        };
      },
    };
    const coordinator = new SampleRunCoordinator(executor);

    expect(coordinator.start('fixed').runId).toBe('run-1');
    await coordinator.waitForIdle();
    expect(coordinator.start('fixed').runId).toBe('run-2');
    await coordinator.waitForIdle();
  });

  it('logs rejection and releases the lock without an unhandled promise', async () => {
    const onAsyncError = vi.fn();
    let sequence = 0;
    const coordinator = new SampleRunCoordinator(
      {
        prepare: () => {
          sequence += 1;
          return {
            runId: `failed-${sequence}`,
            execute: () =>
              Promise.reject(new Error('Persistence unavailable.')),
          };
        },
      },
      { onAsyncError },
    );

    coordinator.start('fixed');
    await coordinator.waitForIdle();
    expect(onAsyncError).toHaveBeenCalledWith(
      expect.objectContaining({ message: 'Persistence unavailable.' }),
      'failed-1',
    );
    expect(coordinator.isActive).toBe(false);
    expect(coordinator.start('fixed').runId).toBe('failed-2');
    await coordinator.waitForIdle();
  });
});
