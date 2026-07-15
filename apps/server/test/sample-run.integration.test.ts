import { spawn, type ChildProcess } from 'node:child_process';
import { createHash } from 'node:crypto';
import { once } from 'node:events';
import { existsSync, statSync } from 'node:fs';
import path from 'node:path';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { createApp } from '../src/app/create-app.js';
import type { SampleRunResult } from '../src/runner/sample/types.js';
import { createTemporaryTestConfig } from './fixtures.js';

const SAMPLE_PORT = 4210;
const SAMPLE_BASE_URL = `http://127.0.0.1:${SAMPLE_PORT}`;
const sampleCheckoutDirectory = path.resolve(
  import.meta.dirname,
  '../../sample-checkout',
);
const nextCli = path.resolve(
  sampleCheckoutDirectory,
  'node_modules/next/dist/bin/next',
);
const temporary = createTemporaryTestConfig({
  browserHeadless: true,
  browserTimeoutMs: 20_000,
  sampleCheckoutBaseUrl: SAMPLE_BASE_URL,
});
let app = createApp({
  config: temporary.config,
  logger: false,
});
let vulnerableRun: SampleRunResult | null = null;
let fixedRun: SampleRunResult | null = null;
let sampleProcess: ChildProcess | null = null;
let processOutput = '';

beforeAll(async () => {
  sampleProcess = spawn(
    process.execPath,
    [nextCli, 'dev', '--hostname', '127.0.0.1', '--port', String(SAMPLE_PORT)],
    {
      cwd: sampleCheckoutDirectory,
      env: { ...process.env, NEXT_TELEMETRY_DISABLED: '1' },
      stdio: ['ignore', 'pipe', 'pipe'],
    },
  );
  sampleProcess.stdout?.on('data', (chunk: Buffer) => {
    processOutput += chunk.toString();
  });
  sampleProcess.stderr?.on('data', (chunk: Buffer) => {
    processOutput += chunk.toString();
  });
  await waitForSampleCheckout();
}, 30_000);

afterAll(async () => {
  await app.close();
  if (sampleProcess !== null && sampleProcess.exitCode === null) {
    sampleProcess.kill('SIGTERM');
    await Promise.race([
      once(sampleProcess, 'exit'),
      new Promise((resolve) => setTimeout(resolve, 5_000)),
    ]);
    if (sampleProcess.exitCode === null) sampleProcess.kill('SIGKILL');
  }
  temporary.cleanup();
}, 10_000);

describe.sequential('headless sample-run integration', () => {
  it('fails vulnerable mode with two triggers, requests, and orders', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/api/sample-runs',
      payload: { mode: 'vulnerable' },
    });
    const result = response.json<SampleRunResult>();
    vulnerableRun = result;

    expect(response.statusCode).toBe(200);
    expect(result.status).toBe('failed');
    expect(result.assertions[0]).toMatchObject({
      status: 'failed',
      observedCount: 2,
    });
    expect(result.observed).toMatchObject({
      browserOrderRequestCount: 2,
      requestAttemptCount: 2,
      createdOrderCount: 2,
    });
    expect(
      result.events.filter(
        (event) => event.eventType === 'experiment.triggered',
      ),
    ).toHaveLength(2);
    expect(result.events.map((event) => event.eventType)).toContain(
      'browser.closed',
    );
    expect(result.artifacts).toHaveLength(3);
    expect(result.evidenceWarnings).toEqual([]);
    for (const artifact of result.artifacts) {
      expect(path.isAbsolute(artifact.relativePath)).toBe(false);
      const filePath = path.resolve(
        temporary.config.artifactRoot,
        artifact.relativePath,
      );
      expect(existsSync(filePath)).toBe(true);
      expect(statSync(filePath).size).toBeGreaterThan(0);
      const download = await app.inject({
        method: 'GET',
        url: `/api/runs/${result.runId}/artifacts/${artifact.artifactId}`,
      });
      expect(download.statusCode).toBe(200);
      expect(download.headers['content-type']).toContain('image/png');
      expect(download.rawPayload.length).toBeGreaterThan(0);
      expect(
        createHash('sha256').update(download.rawPayload).digest('hex'),
      ).toBe(artifact.checksumSha256);
    }
  }, 20_000);

  it('passes fixed mode after two triggers with one created order', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/api/sample-runs',
      payload: { mode: 'fixed' },
    });
    const result = response.json<SampleRunResult>();
    fixedRun = result;

    expect(response.statusCode).toBe(200);
    expect(result.status).toBe('passed');
    expect(result.assertions[0]).toMatchObject({
      status: 'passed',
      observedCount: 1,
    });
    expect(result.observed?.createdOrderCount).toBe(1);
    expect(result.observed?.browserOrderRequestCount).toBeLessThanOrEqual(1);
    expect(
      result.events.filter(
        (event) => event.eventType === 'experiment.triggered',
      ),
    ).toHaveLength(2);
    expect(result.events.map((event) => event.sequence)).toEqual(
      result.events.map((_, index) => index + 1),
    );
    expect(result.artifacts).toHaveLength(3);
    expect(result.artifacts.map((artifact) => artifact.label)).toEqual([
      'before-disruption',
      'after-disruption',
      'final-result',
    ]);
  }, 20_000);

  it('reloads both runs and their artifacts after a server restart', async () => {
    if (vulnerableRun === null || fixedRun === null) {
      throw new Error(
        'Browser runs did not complete before restart verification.',
      );
    }
    await app.close();
    app = createApp({ config: temporary.config, logger: false });

    for (const expected of [vulnerableRun, fixedRun]) {
      const response = await app.inject({
        method: 'GET',
        url: `/api/runs/${expected.runId}`,
      });
      expect(response.statusCode).toBe(200);
      expect(response.json<SampleRunResult>()).toMatchObject({
        runId: expected.runId,
        status: expected.status,
        observed: { createdOrderCount: expected.observed?.createdOrderCount },
        artifacts: expected.artifacts.map((artifact) => ({
          artifactId: artifact.artifactId,
          relativePath: artifact.relativePath,
        })),
      });
      for (const artifact of expected.artifacts) {
        const download = await app.inject({
          method: 'GET',
          url: `/api/runs/${expected.runId}/artifacts/${artifact.artifactId}`,
        });
        expect(download.statusCode).toBe(200);
        expect(download.rawPayload.length).toBeGreaterThan(0);
      }
    }

    const mismatch = await app.inject({
      method: 'GET',
      url: `/api/runs/${fixedRun.runId}/artifacts/${vulnerableRun.artifacts[0]?.artifactId ?? 'missing'}`,
    });
    expect(mismatch.statusCode).toBe(404);
    expect(
      (
        await app.inject({
          method: 'GET',
          url: '/api/runs/unknown-run',
        })
      ).statusCode,
    ).toBe(404);
    expect(
      (
        await app.inject({
          method: 'GET',
          url: `/api/runs/${fixedRun.runId}/artifacts/unknown-artifact`,
        })
      ).statusCode,
    ).toBe(404);

    const list = await app.inject({ method: 'GET', url: '/api/runs?limit=10' });
    expect(list.statusCode).toBe(200);
    expect(list.json<{ items: unknown[] }>().items).toHaveLength(2);
    const latest = await app.inject({
      method: 'GET',
      url: '/api/sample-runs/latest',
    });
    expect(latest.statusCode).toBe(200);
    expect(latest.json<SampleRunResult>().runId).toBe(fixedRun.runId);
  });
});

async function waitForSampleCheckout(): Promise<void> {
  const deadline = Date.now() + 25_000;

  while (Date.now() <= deadline) {
    if (sampleProcess?.exitCode !== null) {
      throw new Error(
        `Sample checkout exited before readiness.\n${processOutput}`,
      );
    }
    try {
      const response = await fetch(`${SAMPLE_BASE_URL}/?mode=fixed`, {
        signal: AbortSignal.timeout(1_000),
      });
      if (response.ok) return;
    } catch {
      // A bounded readiness poll is expected while Next.js starts.
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }

  throw new Error(`Sample checkout did not become ready.\n${processOutput}`);
}
