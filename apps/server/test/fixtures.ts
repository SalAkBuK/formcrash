import type { ServerConfig } from '../src/app/config.js';
import type { SampleRunResult } from '../src/runner/sample/types.js';

export const TEST_SERVER_CONFIG: ServerConfig = {
  browserHeadless: true,
  browserTimeoutMs: 2_000,
  host: '127.0.0.1',
  logLevel: 'silent',
  port: 4100,
  sampleCheckoutBaseUrl: 'http://127.0.0.1:4200',
  varDirectory: './var',
};

export function buildSampleRunResult(
  status: SampleRunResult['status'] = 'passed',
): SampleRunResult {
  return {
    runId: 'test-run-1',
    status,
    mode: 'fixed',
    startedAt: '2026-07-15T00:00:00.000Z',
    completedAt: '2026-07-15T00:00:01.000Z',
    durationMs: 1_000,
    journey: {
      id: 'sample-checkout-priority-0',
      name: 'Sample checkout order submission',
      steps: [],
    },
    experiment: {
      experimentType: 'impatient_user',
      triggerCount: 2,
      intervalMs: 100,
      targetStep: 'submit-order',
    },
    assertions: [
      {
        assertionType: 'max_created_orders',
        expectedMaximum: 1,
        observedCount: status === 'runner_error' ? null : 1,
        status: status === 'runner_error' ? 'not_evaluated' : 'passed',
        expectedDescription: 'No more than one order should be created.',
        observedDescription:
          status === 'runner_error'
            ? 'The application state could not be evaluated.'
            : '1 order was created.',
      },
    ],
    events: [],
    observed: null,
    runnerError:
      status === 'runner_error'
        ? {
            code: 'runner_failure',
            message: 'Test runner error.',
            failedStep: null,
          }
        : null,
  };
}
