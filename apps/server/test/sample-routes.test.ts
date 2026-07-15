import { afterEach, describe, expect, it, vi } from 'vitest';

import { createApp } from '../src/app/create-app.js';
import { initializePersistence } from '../src/persistence/initialize.js';
import { RunRepository } from '../src/persistence/run-repository.js';
import { SampleRunCoordinator } from '../src/runner/engine/sample-run-coordinator.js';
import type {
  SampleRunExecutor,
  SampleRunResult,
} from '../src/runner/sample/types.js';
import { buildSampleRunResult, createTemporaryTestConfig } from './fixtures.js';

const apps: ReturnType<typeof createApp>[] = [];
const cleanups: Array<() => void> = [];

afterEach(async () => {
  await Promise.all(apps.splice(0).map(async (app) => app.close()));
  for (const cleanup of cleanups.splice(0)) cleanup();
});

describe('sample-run API', () => {
  it('rejects invalid modes with a structured 400 response', async () => {
    const coordinator = new SampleRunCoordinator({
      run: () => Promise.resolve(buildSampleRunResult()),
    });
    const temporary = createTemporaryTestConfig();
    cleanups.push(temporary.cleanup);
    const app = createApp({
      config: temporary.config,
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
    const temporary = createTemporaryTestConfig();
    cleanups.push(temporary.cleanup);
    const app = createApp({
      config: temporary.config,
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

  it('validates run-list pagination and returns 404 for unknown runs', async () => {
    const temporary = createTemporaryTestConfig();
    cleanups.push(temporary.cleanup);
    const app = createApp({ config: temporary.config, logger: false });
    apps.push(app);

    expect(
      (await app.inject({ method: 'GET', url: '/api/runs?limit=0' }))
        .statusCode,
    ).toBe(400);
    expect(
      (await app.inject({ method: 'GET', url: '/api/runs/unknown' }))
        .statusCode,
    ).toBe(404);
  });

  it('returns 404 when artifact metadata exists but its file is unavailable', async () => {
    const temporary = createTemporaryTestConfig();
    cleanups.push(temporary.cleanup);
    const database = initializePersistence(temporary.config);
    const repository = new RunRepository(database.connection);
    const definition = repository.loadSeededExperiment();
    repository.createRun({
      runId: 'run-missing-file',
      experimentVersionId: definition.experimentVersionId,
      mode: 'fixed',
      startedAt: '2026-07-15T00:00:00.000Z',
      targetUrl: 'http://localhost:4200',
      journey: definition.journey,
      experiment: definition.experiment,
      assertions: definition.assertions,
    });
    const artifact = repository.createArtifact({
      runId: 'run-missing-file',
      label: 'before-disruption',
      relativePath: 'screenshots/run-missing-file/001-before-disruption.png',
      sizeBytes: 10,
      checksumSha256: '0'.repeat(64),
      captureSequence: 1,
      createdAt: '2026-07-15T00:00:00.000Z',
      metadata: { fullPage: true },
    });
    database.close();
    const app = createApp({ config: temporary.config, logger: false });
    apps.push(app);

    const response = await app.inject({
      method: 'GET',
      url: `/api/runs/run-missing-file/artifacts/${artifact.artifactId}`,
    });

    expect(response.statusCode).toBe(404);
  });
});
