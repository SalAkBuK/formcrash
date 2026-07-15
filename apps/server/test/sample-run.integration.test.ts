import { spawn, type ChildProcess } from 'node:child_process';
import { once } from 'node:events';
import path from 'node:path';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { createApp } from '../src/app/create-app.js';
import type { SampleRunResult } from '../src/runner/sample/types.js';
import { TEST_SERVER_CONFIG } from './fixtures.js';

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
const app = createApp({
  config: {
    ...TEST_SERVER_CONFIG,
    browserHeadless: true,
    browserTimeoutMs: 10_000,
    sampleCheckoutBaseUrl: SAMPLE_BASE_URL,
  },
  logger: false,
});
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
}, 10_000);

describe.sequential('headless sample-run integration', () => {
  it('fails vulnerable mode with two triggers, requests, and orders', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/api/sample-runs',
      payload: { mode: 'vulnerable' },
    });
    const result = response.json<SampleRunResult>();

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
  });

  it('passes fixed mode after two triggers with one created order', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/api/sample-runs',
      payload: { mode: 'fixed' },
    });
    const result = response.json<SampleRunResult>();

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
