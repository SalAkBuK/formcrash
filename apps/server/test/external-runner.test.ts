import { writeFileSync } from 'node:fs';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import type { ReplayLocator } from '@formcrash/contracts';

import type { FormCrashDatabase } from '../src/persistence/database.js';
import { initializePersistence } from '../src/persistence/initialize.js';
import { ExternalExperimentRepository } from '../src/persistence/external-experiment-repository.js';
import { ProjectJourneyRepository } from '../src/persistence/project-journey-repository.js';
import { ProjectSettingsRepository } from '../src/persistence/project-settings-repository.js';
import { AuthStateStore } from '../src/runner/external/auth-session.js';
import { ExternalExperimentRunner } from '../src/runner/external/external-experiment-runner.js';
import {
  InvalidTemplateError,
  MissingRuntimeVariablesError,
} from '../src/runner/external/runtime-values.js';
import { BrowserOwnership } from '../src/runner/infrastructure/browser-ownership.js';
import type {
  ExternalBrowserOptions,
  ExternalBrowserOwner,
  NetworkObservation,
  RecordingBrowserSession,
  ReplayBrowserSession,
} from '../src/runner/recording/external-browser.js';
import {
  createTemporaryTestConfig,
  type TemporaryTestConfig,
} from './fixtures.js';

let temporary: TemporaryTestConfig;
let database: FormCrashDatabase;
let projects: ProjectJourneyRepository;
let settings: ProjectSettingsRepository;
let experiments: ExternalExperimentRepository;

beforeEach(() => {
  temporary = createTemporaryTestConfig({ browserTimeoutMs: 500 });
  database = initializePersistence(temporary.config);
  projects = new ProjectJourneyRepository(database.connection);
  settings = new ProjectSettingsRepository(database.connection);
  experiments = new ExternalExperimentRepository(database.connection);
});

afterEach(() => {
  database.close();
  temporary.cleanup();
});

describe('external runner terminal paths', () => {
  it('runs without authentication and records every trigger attempt', async () => {
    const configured = configure({});
    const owner = new FakeOwner();
    const ownership = new BrowserOwnership();
    const result = await runner(owner, ownership).run(configured.versionId, {});

    expect(result.status).toBe('passed');
    expect(result.triggerAttempts).toBe(2);
    expect(
      result.events.filter(
        (event) => event.eventType === 'experiment.triggered',
      ),
    ).toHaveLength(2);
    expect(owner.launchCount).toBe(1);
    expect(owner.lastOptions?.storageStatePath).toBeUndefined();
    expect(owner.lastSession?.settleDurations).toEqual([700, 900]);
    expect(ownership.activeWorkload).toBeNull();
    expect(
      experiments.listRuns({
        projectId: configured.projectId,
        limit: 20,
        offset: 0,
      }).items,
    ).toEqual([
      expect.objectContaining({
        runId: result.runId,
        triggerAttempts: 2,
        screenshotCount: 3,
      }),
    ]);
    expect(experiments.deleteRun(result.runId)).toHaveLength(3);
    expect(experiments.getRun(result.runId)).toBeNull();
  });

  it('fails missing variables before browser launch', async () => {
    const configured = configure({ requiredVariable: true });
    const owner = new FakeOwner();
    await expect(
      runner(owner, new BrowserOwnership()).run(configured.versionId, {}),
    ).rejects.toBeInstanceOf(MissingRuntimeVariablesError);
    expect(owner.launchCount).toBe(0);
  });

  it('rejects unknown assertion templates before browser launch', async () => {
    const configured = configure({ assertionText: '{{random.uuid}}' });
    const owner = new FakeOwner();
    await expect(
      runner(owner, new BrowserOwnership()).run(configured.versionId, {}),
    ).rejects.toBeInstanceOf(InvalidTemplateError);
    expect(owner.launchCount).toBe(0);
  });

  it('turns required before-hook failure into runner error without launching Chromium', async () => {
    const configured = configure({
      beforeHookUrl: 'http://127.0.0.1:1/test-support/reset',
    });
    const owner = new FakeOwner();
    const result = await runner(owner, new BrowserOwnership()).run(
      configured.versionId,
      {},
    );

    expect(result.status).toBe('runner_error');
    expect(result.runnerError?.code).toBe('before_hook_failed');
    expect(owner.launchCount).toBe(0);
  });

  it('keeps cleanup-hook failure as a warning and never logs hook secrets', async () => {
    const configured = configure({
      requiredVariable: true,
      afterHookUrl: 'http://127.0.0.1:1/test-support/cleanup',
    });
    const owner = new FakeOwner();
    const result = await runner(owner, new BrowserOwnership()).run(
      configured.versionId,
      { API_TOKEN: 'super-secret-hook-token' },
    );

    expect(result.status).toBe('passed');
    expect(result.warnings).toEqual([
      expect.objectContaining({ code: 'cleanup_hook_failed' }),
    ]);
    expect(JSON.stringify(result)).not.toContain('super-secret-hook-token');
  });
});

function configure(options: {
  readonly requiredVariable?: boolean;
  readonly beforeHookUrl?: string;
  readonly afterHookUrl?: string;
  readonly assertionText?: string;
}) {
  const project = projects.createProject({
    name: `Runner ${crypto.randomUUID()}`,
    targetUrl: 'http://127.0.0.1:49999/controlled',
    description: 'Fake-browser runner test',
  });
  const targetStepId = crypto.randomUUID();
  const journey = projects.saveJourney({
    projectId: project.id,
    name: 'Submit once',
    steps: [
      {
        id: targetStepId,
        name: 'Submit',
        type: 'submit',
        timestamp: 0,
        url: project.targetUrl,
        locator: { strategy: 'css', value: '#form' },
        fingerprint: null,
        value: null,
        sensitive: false,
      },
    ],
    metadata: {
      recordingSessionId: null,
      recordedAt: new Date(0).toISOString(),
      warningCount: 0,
      normalizationRule: 'test',
    },
  });
  const secretHeader = options.requiredVariable
    ? { authorization: 'Bearer {{var.API_TOKEN}}' }
    : {};
  settings.save(project.id, {
    variables: options.requiredVariable
      ? [
          {
            name: 'API_TOKEN',
            secret: true,
            description: 'Hook token',
            template: null,
          },
        ]
      : [],
    beforeRunHook:
      options.beforeHookUrl === undefined
        ? null
        : {
            method: 'POST',
            url: options.beforeHookUrl,
            headers: secretHeader,
            body: null,
            timeoutMs: 100,
          },
    afterRunHook:
      options.afterHookUrl === undefined
        ? null
        : {
            method: 'DELETE',
            url: options.afterHookUrl,
            headers: secretHeader,
            body: null,
            timeoutMs: 100,
          },
  });
  const version = experiments.createVersion({
    projectId: project.id,
    journey,
    request: {
      name: 'Impatient submit',
      targetStepId,
      triggerCount: 2,
      intervalMs: 0,
      networkMatcher: null,
      assertions: [
        {
          id: 'completion',
          type: 'text_appeared',
          text:
            options.assertionText ??
            (options.requiredVariable ? '{{var.API_TOKEN}}' : 'Complete'),
          description: 'Completion appears.',
        },
      ],
      continueAfterTarget: false,
    },
  });
  return { versionId: version.id, projectId: project.id };
}

function runner(owner: ExternalBrowserOwner, ownership: BrowserOwnership) {
  return new ExternalExperimentRunner(
    temporary.config,
    projects,
    settings,
    new AuthStateStore(temporary.config.artifactRoot, settings),
    experiments,
    ownership,
    owner,
  );
}

class FakeOwner implements ExternalBrowserOwner {
  launchCount = 0;
  lastOptions: ExternalBrowserOptions | null = null;
  lastSession: FakeSession | null = null;

  launchRecording(): Promise<RecordingBrowserSession> {
    throw new Error('Recording is not used by this test.');
  }

  launchReplay(options: ExternalBrowserOptions): Promise<ReplayBrowserSession> {
    this.launchCount += 1;
    this.lastOptions = options;
    this.lastSession = new FakeSession();
    return Promise.resolve(this.lastSession);
  }
}

class FakeSession implements ReplayBrowserSession {
  private observer: ((observation: NetworkObservation) => void) | null = null;
  readonly settleDurations: number[] = [];
  navigate(): Promise<void> {
    return Promise.resolve();
  }
  click(): Promise<void> {
    return Promise.resolve();
  }
  fill(): Promise<void> {
    return Promise.resolve();
  }
  setChecked(): Promise<void> {
    return Promise.resolve();
  }
  select(): Promise<void> {
    return Promise.resolve();
  }
  submit(): Promise<void> {
    return Promise.resolve();
  }
  triggerRepeated(
    _locator: ReplayLocator,
    _type: 'click' | 'submit',
    count: 2 | 3,
    _intervalMs: 0 | 100 | 300,
    onAttempt: (attempt: number) => void,
  ): Promise<void> {
    for (let attempt = 1; attempt <= count; attempt += 1) onAttempt(attempt);
    return Promise.resolve();
  }
  observeNetwork(observer: (observation: NetworkObservation) => void): void {
    this.observer = observer;
  }
  captureScreenshot(destination: string): Promise<void> {
    writeFileSync(destination, 'fake png');
    return Promise.resolve();
  }
  setScreenshotMasks(): void {}
  isVisible(): Promise<boolean> {
    return Promise.resolve(true);
  }
  isDisabled(): Promise<boolean> {
    return Promise.resolve(true);
  }
  textVisible(): Promise<boolean> {
    return Promise.resolve(true);
  }
  inputValue(): Promise<string | null> {
    return Promise.resolve('value');
  }
  currentUrl(): string {
    return 'http://127.0.0.1:49999/complete';
  }
  settle(milliseconds: number): Promise<void> {
    this.settleDurations.push(milliseconds);
    return Promise.resolve();
  }
  close(): Promise<void> {
    this.observer = null;
    return Promise.resolve();
  }
}
