import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import type { ServerConfig } from '../src/app/config.js';
import type { SampleRunResult } from '../src/runner/sample/types.js';

export interface TemporaryTestConfig {
  readonly config: ServerConfig;
  readonly root: string;
  readonly cleanup: () => void;
}

export function createTemporaryTestConfig(
  overrides: Partial<ServerConfig> = {},
): TemporaryTestConfig {
  const root = mkdtempSync(path.join(tmpdir(), 'formcrash-test-'));
  return {
    root,
    config: {
      artifactRoot: path.join(root, 'artifacts'),
      browserHeadless: true,
      browserTimeoutMs: 2_000,
      databasePath: path.join(root, 'database', 'formcrash.db'),
      dashboardOrigins: ['http://localhost:3000'],
      host: '127.0.0.1',
      logLevel: 'silent',
      port: 4100,
      sampleCheckoutBaseUrl: 'http://127.0.0.1:4200',
      ...overrides,
    },
    cleanup: () => rmSync(root, { recursive: true, force: true }),
  };
}

export function buildSampleRunResult(
  status: SampleRunResult['status'] = 'passed',
): SampleRunResult {
  const assertionStatus =
    status === 'runner_error'
      ? 'not_evaluated'
      : status === 'failed'
        ? 'failed'
        : 'passed';
  const observedCount =
    status === 'runner_error' ? null : status === 'failed' ? 2 : 1;
  const journey = [
    {
      id: 'open-checkout',
      name: 'Open the bundled sample checkout',
      action: { type: 'navigate' as const, path: '/' },
    },
  ];
  const experiment = {
    experimentType: 'impatient_user' as const,
    triggerCount: 2 as const,
    intervalMs: 100 as const,
    targetStep: 'submit-order' as const,
  };
  const assertionSnapshot = {
    id: 'assertion-max-created-orders-v1',
    assertionType: 'max_created_orders' as const,
    configuration: { expectedMaximum: 1 as const },
    description: 'No more than one order should be created.' as const,
  };

  return {
    runId: 'test-run-1',
    experimentVersionId: 'experiment-version-impatient-user-v1',
    status,
    mode: 'fixed',
    startedAt: '2026-07-15T00:00:00.000Z',
    completedAt: '2026-07-15T00:00:01.000Z',
    durationMs: 1_000,
    targetUrl: 'http://127.0.0.1:4200',
    createdAt: '2026-07-15T00:00:00.000Z',
    journey: {
      id: 'sample-checkout-priority-0',
      name: 'Sample checkout order submission',
      steps: [
        {
          id: 'open-checkout',
          name: 'Open the bundled sample checkout',
          actionType: 'navigate',
          selector: null,
          path: '/',
        },
      ],
    },
    experiment,
    assertions: [
      {
        assertionType: 'max_created_orders',
        expectedMaximum: 1,
        observedCount,
        status: assertionStatus,
        expectedDescription: 'No more than one order should be created.',
        observedDescription:
          observedCount === null
            ? 'The application state could not be evaluated.'
            : `${observedCount} order${observedCount === 1 ? '' : 's'} were created.`,
      },
    ],
    snapshots: {
      journey,
      experiment,
      assertions: [assertionSnapshot],
    },
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
    evidenceWarnings: [],
    assertionResults: [],
    artifacts: [],
  };
}
