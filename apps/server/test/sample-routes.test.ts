import { afterEach, describe, expect, it, vi } from 'vitest';

import { createApp } from '../src/app/create-app.js';
import { SampleRunCoordinator } from '../src/runner/engine/sample-run-coordinator.js';
import type {
  SampleRunExecutor,
  SampleRunResult,
} from '../src/runner/sample/types.js';
import { buildSampleRunResult, TEST_SERVER_CONFIG } from './fixtures.js';

const apps: ReturnType<typeof createApp>[] = [];

afterEach(async () => {
  await Promise.all(apps.splice(0).map(async (app) => app.close()));
});

describe('sample-run API', () => {
  it('rejects invalid modes with a structured 400 response', async () => {
    const coordinator = new SampleRunCoordinator({
      run: () => Promise.resolve(buildSampleRunResult()),
    });
    const app = createApp({
      config: TEST_SERVER_CONFIG,
      logger: false,
      sampleRunCoordinator: coordinator,
    });
    apps.push(app);

    const response = await app.inject({
      method: 'POST',
      url: '/api/sample-runs',
      payload: { mode: 'unknown' },
    });

    expect(response.statusCode).toBe(400);
    expect(response.json()).toMatchObject({
      error: { code: 'INVALID_SAMPLE_RUN_REQUEST' },
    });
  });

  it('returns 409 while another run is active', async () => {
    let resolveRun: ((result: SampleRunResult) => void) | undefined;
    const executor: SampleRunExecutor = {
      run: () =>
        new Promise((resolve) => {
          resolveRun = resolve;
        }),
    };
    const coordinator = new SampleRunCoordinator(executor);
    const app = createApp({
      config: TEST_SERVER_CONFIG,
      logger: false,
      sampleRunCoordinator: coordinator,
    });
    apps.push(app);

    const firstResponse = app.inject({
      method: 'POST',
      url: '/api/sample-runs',
      payload: { mode: 'vulnerable' },
    });
    await vi.waitFor(() => expect(coordinator.isActive).toBe(true));
    const conflict = await app.inject({
      method: 'POST',
      url: '/api/sample-runs',
      payload: { mode: 'fixed' },
    });

    expect(conflict.statusCode).toBe(409);
    expect(conflict.json()).toMatchObject({
      error: { code: 'SAMPLE_RUN_ACTIVE' },
    });
    if (resolveRun === undefined) throw new Error('First run did not start.');
    resolveRun(buildSampleRunResult());
    expect((await firstResponse).statusCode).toBe(200);
  });
});
