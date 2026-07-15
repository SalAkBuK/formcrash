import { describe, expect, it } from 'vitest';

import {
  ActiveSampleRunError,
  SampleRunCoordinator,
} from '../src/runner/engine/sample-run-coordinator.js';
import type {
  SampleRunExecutor,
  SampleRunResult,
} from '../src/runner/sample/types.js';
import { buildSampleRunResult } from './fixtures.js';

function deferredResult(): {
  executor: SampleRunExecutor;
  resolve: (result: SampleRunResult) => void;
} {
  let resolveResult: ((result: SampleRunResult) => void) | undefined;
  const resultPromise = new Promise<SampleRunResult>((resolve) => {
    resolveResult = resolve;
  });
  return {
    executor: { run: () => resultPromise },
    resolve: (result) => {
      if (resolveResult === undefined)
        throw new Error('Deferred result is not ready.');
      resolveResult(result);
    },
  };
}

describe('single active sample run', () => {
  it('rejects a second run instead of queueing it', async () => {
    const deferred = deferredResult();
    const coordinator = new SampleRunCoordinator(deferred.executor);
    const firstRun = coordinator.run('vulnerable');

    await expect(coordinator.run('fixed')).rejects.toBeInstanceOf(
      ActiveSampleRunError,
    );
    deferred.resolve(buildSampleRunResult());
    await firstRun;
  });

  it.each(['passed', 'runner_error'] as const)(
    'releases the lock after a %s result',
    async (status) => {
      const results = [buildSampleRunResult(status), buildSampleRunResult()];
      const executor: SampleRunExecutor = {
        run: () => Promise.resolve(results.shift() ?? buildSampleRunResult()),
      };
      const coordinator = new SampleRunCoordinator(executor);

      await coordinator.run('fixed');
      await expect(coordinator.run('fixed')).resolves.toMatchObject({
        status: 'passed',
      });
    },
  );
});
