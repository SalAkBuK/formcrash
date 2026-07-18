import { spawn, type ChildProcess } from 'node:child_process';
import { once } from 'node:events';
import { readFileSync, rmSync } from 'node:fs';
import { createServer, type Server } from 'node:http';
import path from 'node:path';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Page } from 'playwright';

import { initializePersistence } from '../src/persistence/initialize.js';
import { ProjectJourneyRepository } from '../src/persistence/project-journey-repository.js';
import { SAMPLE_DEFINITION_IDS } from '../src/persistence/sample-seed.js';
import { SampleRunCoordinator } from '../src/runner/engine/sample-run-coordinator.js';
import {
  BrowserOwnership,
  BrowserOwnershipConflictError,
} from '../src/runner/infrastructure/browser-ownership.js';
import {
  PlaywrightExternalBrowserOwner,
  type ExternalBrowserOwner,
  type RecordingBrowserSession,
  type ReplayBrowserSession,
} from '../src/runner/recording/external-browser.js';
import { JourneyReplayService } from '../src/runner/recording/journey-replay.js';
import { RecordingManager } from '../src/runner/recording/recording-manager.js';
import type { FormCrashDatabase } from '../src/persistence/database.js';
import {
  buildSampleRunResult,
  createTemporaryTestConfig,
  restoreSampleNextEnv,
} from './fixtures.js';

const SAMPLE_PORT = 4211;
const SAMPLE_URL = `http://127.0.0.1:${SAMPLE_PORT}/?mode=fixed`;
const sampleDirectory = path.resolve(
  import.meta.dirname,
  '../../sample-checkout',
);
const nextCli = path.resolve(
  sampleDirectory,
  'node_modules/next/dist/bin/next',
);
const sampleDistDirectoryName = `.next-test-${process.pid}-${SAMPLE_PORT}`;
const sampleDistDirectory = path.resolve(
  sampleDirectory,
  sampleDistDirectoryName,
);
const sampleNextEnvPath = path.resolve(sampleDirectory, 'next-env.d.ts');
const externalHtml = readFileSync(
  path.resolve(
    import.meta.dirname,
    '../../../fixtures/external-target/index.html',
  ),
  'utf8',
);
const temporary = createTemporaryTestConfig({
  browserHeadless: true,
  browserTimeoutMs: 20_000,
  sampleCheckoutBaseUrl: `http://127.0.0.1:${SAMPLE_PORT}`,
});

let fixtureServer: Server;
let fixtureUrl: string;
let sampleProcess: ChildProcess | null = null;
let sampleOutput = '';
let database: FormCrashDatabase;
let repository: ProjectJourneyRepository;

beforeAll(async () => {
  fixtureServer = createServer((_request, response) => {
    response.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
    response.end(externalHtml);
  });
  fixtureServer.listen(0, '127.0.0.1');
  await once(fixtureServer, 'listening');
  const address = fixtureServer.address();
  if (address === null || typeof address === 'string')
    throw new Error('Fixture did not bind.');
  fixtureUrl = `http://127.0.0.1:${address.port}`;

  sampleProcess = spawn(
    process.execPath,
    [nextCli, 'dev', '--hostname', '127.0.0.1', '--port', String(SAMPLE_PORT)],
    {
      cwd: sampleDirectory,
      env: {
        ...process.env,
        NEXT_TELEMETRY_DISABLED: '1',
        FORMCRASH_NEXT_DIST_DIR: sampleDistDirectoryName,
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    },
  );
  sampleProcess.stdout?.on('data', (chunk: Buffer) => {
    sampleOutput += chunk.toString();
  });
  sampleProcess.stderr?.on('data', (chunk: Buffer) => {
    sampleOutput += chunk.toString();
  });
  await waitForUrl(SAMPLE_URL, () => sampleOutput);

  database = initializePersistence(temporary.config);
  repository = new ProjectJourneyRepository(database.connection);
}, 30_000);

afterAll(async () => {
  database?.close();
  if (fixtureServer !== undefined) {
    await new Promise<void>((resolve) => fixtureServer.close(() => resolve()));
  }
  if (sampleProcess !== null && sampleProcess.exitCode === null) {
    sampleProcess.kill('SIGTERM');
    await Promise.race([
      once(sampleProcess, 'exit'),
      new Promise((resolve) => setTimeout(resolve, 5_000)),
    ]);
    if (sampleProcess.exitCode === null) sampleProcess.kill('SIGKILL');
  }
  rmSync(sampleDistDirectory, {
    recursive: true,
    force: true,
    maxRetries: 3,
    retryDelay: 100,
  });
  restoreSampleNextEnv(sampleNextEnvPath);
  temporary.cleanup();
}, 10_000);

describe.sequential('generic Chromium recording and replay', () => {
  it('records and replays the separate external fixture without leaking sensitive values', async () => {
    const project = repository.createProject({
      name: 'External fixture',
      targetUrl: fixtureUrl,
      description: 'Separate recorder verification target.',
    });
    const ownership = new BrowserOwnership();
    const manager = new RecordingManager(
      temporary.config,
      repository,
      ownership,
      new PlaywrightExternalBrowserOwner(driveExternalFixture),
    );

    const started = await manager.start(project.id);
    expect(started.status).toBe('recording');
    const stopped = await manager.stop(started.id);

    expect(stopped.status).toBe('completed');
    expect(stopped).toMatchObject({
      captureFormat: 'hybrid-v2',
      traceStatus: 'complete',
      traceSummary: {
        videoCaptured: true,
        truncated: false,
      },
    });
    expect(stopped.steps.map((step) => step.type)).toEqual([
      'navigate',
      'click',
      'fill',
      'fill',
      'select',
      'checkbox',
      'submit',
    ]);
    expect(stopped.steps.filter((step) => step.type === 'fill')).toHaveLength(
      2,
    );
    const nameStep = stopped.steps.find(
      (step) => step.fingerprint?.dataFormcrash === 'display-name',
    );
    expect(nameStep).toMatchObject({
      locator: { strategy: 'data-formcrash', value: 'display-name' },
      value: { kind: 'safe', value: 'Ada Lovelace' },
    });
    const password = stopped.steps.find(
      (step) => step.fingerprint?.inputType === 'password',
    );
    expect(password).toMatchObject({
      sensitive: true,
      value: { kind: 'sensitive' },
    });
    expect(JSON.stringify(stopped)).not.toContain('NeverPersistThis');
    expect(stopped.warnings.map((warning) => warning.code)).toEqual(
      expect.arrayContaining([
        'iframe',
        'file_upload',
        'contenteditable',
        'shadow_dom',
        'drag_and_drop',
      ]),
    );
    expect(stopped.steps.map((step) => step.timestamp)).toEqual(
      [...stopped.steps]
        .map((step) => step.timestamp)
        .sort((left, right) => left - right),
    );
    expect(ownership.activeWorkload).toBeNull();

    const journey = manager.save(project.id, started.id, {
      name: 'Complete profile',
    });
    expect(journey).toMatchObject({
      replayFormat: 'hybrid-v2',
      trace: {
        interactionCount: stopped.traceSummary?.interactionCount,
      },
    });
    expect(journey.trace?.checksumSha256).toMatch(/^[a-f0-9]{64}$/u);
    expect(journey.recordingMetadata.normalizationRule).toContain('coalesced');

    database.close();
    database = initializePersistence(temporary.config);
    repository = new ProjectJourneyRepository(database.connection);
    expect(repository.getJourney(journey.id)?.steps).toEqual(journey.steps);

    const secret = journey.steps.find(
      (step) => step.value?.kind === 'sensitive',
    )?.value;
    if (secret?.kind !== 'sensitive')
      throw new Error('Sensitive step was not saved.');
    process.env[secret.variableName] = 'RuntimeOnlyValue';
    const replayOwnership = new BrowserOwnership();
    const replay = new JourneyReplayService(
      temporary.config,
      repository,
      replayOwnership,
    );
    const result = await replay.replay(journey.id);
    delete process.env[secret.variableName];
    expect(result).toMatchObject({ status: 'passed', failedStep: null });
    expect(replayOwnership.activeWorkload).toBeNull();
  }, 30_000);

  it('identifies the exact failed persisted step and releases Chromium', async () => {
    const project = repository
      .listProjects()
      .find((item) => item.name === 'External fixture');
    if (project === undefined) throw new Error('External project is missing.');
    const source = repository.listJourneys(project.id)[0];
    if (source === undefined) throw new Error('External journey is missing.');
    const brokenStep = {
      ...source.steps[1]!,
      id: 'known-broken-step',
      name: 'Known broken link',
      locator: { strategy: 'css' as const, value: '#does-not-exist' },
    };
    const broken = repository.saveJourney({
      projectId: project.id,
      name: 'Broken profile journey',
      steps: [source.steps[0]!, brokenStep, ...source.steps.slice(2)],
      metadata: source.recordingMetadata,
    });
    const ownership = new BrowserOwnership();
    const secret = source.steps.find(
      (step) => step.value?.kind === 'sensitive',
    )?.value;
    if (secret?.kind !== 'sensitive')
      throw new Error('Sensitive step was not saved.');
    process.env[secret.variableName] = 'RuntimeOnlyValue';
    const result = await new JourneyReplayService(
      temporary.config,
      repository,
      ownership,
    ).replay(broken.id);
    delete process.env[secret.variableName];

    expect(result).toMatchObject({
      status: 'failed',
      failedStep: {
        stepId: 'known-broken-step',
        stepName: 'Known broken link',
        stepNumber: 2,
        actionType: 'click',
      },
    });
    expect(ownership.activeWorkload).toBeNull();
  }, 30_000);

  it('records and replays the bundled checkout through the same generic recorder', async () => {
    const ownership = new BrowserOwnership();
    const manager = new RecordingManager(
      temporary.config,
      repository,
      ownership,
      new PlaywrightExternalBrowserOwner(driveSampleCheckout),
    );
    const started = await manager.start(SAMPLE_DEFINITION_IDS.projectId);
    expect(started).toMatchObject({ status: 'recording', errorMessage: null });
    const stopped = await manager.stop(started.id);
    expect(stopped.status).toBe('completed');
    expect(stopped.steps.some((step) => step.type === 'fill')).toBe(true);
    expect(stopped.steps.some((step) => step.type === 'submit')).toBe(true);
    expect(stopped.steps.some((step) => step.type === 'click')).toBe(true);
    const saved = manager.save(SAMPLE_DEFINITION_IDS.projectId, started.id, {
      name: 'Recorded bundled checkout',
    });
    const result = await new JourneyReplayService(
      temporary.config,
      repository,
      ownership,
    ).replay(saved.id);
    expect(result, JSON.stringify(result)).toMatchObject({
      status: 'passed',
      failedStep: null,
    });
    expect(ownership.activeWorkload).toBeNull();
  }, 40_000);

  it('prevents recording during normal execution and releases ownership after launch and cleanup failure', async () => {
    const ownership = new BrowserOwnership();
    let finishRun: (() => void) | undefined;
    const coordinator = new SampleRunCoordinator(
      {
        prepare: () => ({
          runId: 'exclusive-run',
          execute: () =>
            new Promise((resolve) => {
              finishRun = () => resolve(buildSampleRunResult());
            }),
        }),
      },
      { browserOwnership: ownership },
    );
    coordinator.start('fixed');
    await new Promise<void>((resolve) => setImmediate(resolve));
    const project = repository
      .listProjects()
      .find((item) => item.name === 'External fixture');
    if (project === undefined) throw new Error('External project is missing.');
    const manager = new RecordingManager(
      temporary.config,
      repository,
      ownership,
      new FailingCleanupBrowserOwner(),
    );
    await expect(manager.start(project.id)).rejects.toBeInstanceOf(
      BrowserOwnershipConflictError,
    );
    finishRun?.();
    await coordinator.waitForIdle();
    expect(ownership.activeWorkload).toBeNull();

    const started = await manager.start(project.id);
    const stopped = await manager.stop(started.id);
    expect(stopped.status).toBe('runner_error');
    expect(ownership.activeWorkload).toBeNull();

    const launchFailure = new RecordingManager(
      temporary.config,
      repository,
      ownership,
      new LaunchFailureBrowserOwner(),
    );
    expect((await launchFailure.start(project.id)).status).toBe('runner_error');
    expect(ownership.activeWorkload).toBeNull();
  });
});

async function driveExternalFixture(page: Page): Promise<void> {
  await page.getByTestId('details-link').click();
  await page
    .locator('[data-formcrash="display-name"]')
    .pressSequentially('Ada Lovelace', { delay: 5 });
  await page.locator('#password').fill('NeverPersistThis');
  await page.getByTestId('plan-select').selectOption('team');
  await page.getByTestId('terms').check();
  await page.frameLocator('iframe').locator('#frame-button').click();
  await page.locator('#upload').dispatchEvent('change');
  await page.locator('#editor').click();
  await page.locator('#shadow-host').locator('#shadow-button').click();
  await page.locator('main').dispatchEvent('dragstart');
  await page.getByTestId('save-profile').click();
  await page.locator('#complete').waitFor({ state: 'visible' });
}

async function driveSampleCheckout(page: Page): Promise<void> {
  await page
    .locator('[data-formcrash="checkout-ready"]')
    .waitFor({ state: 'attached' });
  await page.locator('[data-formcrash="cart-next"]').click();
  await page.locator('[data-formcrash="contact-name"]').fill('Ada Lovelace');
  await page
    .locator('[data-formcrash="contact-email"]')
    .fill('ada@example.test');
  await page.locator('[data-formcrash="contact-next"]').click();
  await page
    .locator('[data-formcrash="shipping-address-line-1"]')
    .fill('1 Test Lane');
  await page.locator('[data-formcrash="shipping-city"]').fill('Test City');
  await page.locator('[data-formcrash="shipping-region"]').fill('TS');
  await page.locator('[data-formcrash="shipping-postal-code"]').fill('10001');
  await page.locator('[data-formcrash="shipping-next"]').click();
  await page.locator('[data-formcrash="submit-order"]').click();
  await page.locator('[data-formcrash="confirmation-step"]').waitFor();
}

class FailingCleanupBrowserOwner implements ExternalBrowserOwner {
  launchRecording(): Promise<RecordingBrowserSession> {
    return Promise.resolve({
      close: () => Promise.reject(new Error('Synthetic cleanup failure.')),
    });
  }
  launchReplay(): Promise<ReplayBrowserSession> {
    return Promise.reject(new Error('Not used.'));
  }
}

class LaunchFailureBrowserOwner implements ExternalBrowserOwner {
  launchRecording(): Promise<RecordingBrowserSession> {
    return Promise.reject(new Error('Synthetic launch failure.'));
  }
  launchReplay(): Promise<ReplayBrowserSession> {
    return Promise.reject(new Error('Not used.'));
  }
}

async function waitForUrl(url: string, output: () => string): Promise<void> {
  const deadline = Date.now() + 25_000;
  while (Date.now() <= deadline) {
    if (sampleProcess?.exitCode !== null)
      throw new Error(`Sample exited.\n${output()}`);
    try {
      if ((await fetch(url, { signal: AbortSignal.timeout(1_000) })).ok) return;
    } catch {
      // Expected while the local fixture starts.
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(`Sample did not become ready.\n${output()}`);
}
