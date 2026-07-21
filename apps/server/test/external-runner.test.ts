import { writeFileSync } from 'node:fs';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  externalRunDetailSchema,
  type ReplayLocator,
} from '@formcrash/contracts';

import type { FormCrashDatabase } from '../src/persistence/database.js';
import { initializePersistence } from '../src/persistence/initialize.js';
import { ExternalExperimentRepository } from '../src/persistence/external-experiment-repository.js';
import { ProjectJourneyRepository } from '../src/persistence/project-journey-repository.js';
import { ProjectSettingsRepository } from '../src/persistence/project-settings-repository.js';
import { OutcomeCheckRepository } from '../src/persistence/outcome-check-repository.js';
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
let outcomes: OutcomeCheckRepository;

beforeEach(() => {
  temporary = createTemporaryTestConfig({ browserTimeoutMs: 500 });
  database = initializePersistence(temporary.config);
  projects = new ProjectJourneyRepository(database.connection);
  settings = new ProjectSettingsRepository(database.connection);
  experiments = new ExternalExperimentRepository(database.connection);
  outcomes = new OutcomeCheckRepository(database.connection);
});

afterEach(() => {
  vi.restoreAllMocks();
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

  it('keeps runner failure distinct from an explanatory could-not-verify outcome', async () => {
    const configured = configure({
      withOutcomeCheck: true,
      beforeHookUrl: 'http://127.0.0.1:1/test-support/reset',
    });
    const owner = new FakeOwner();
    const result = await runner(owner, new BrowserOwnership()).run(
      configured.versionId,
      {},
    );

    expect(result).toMatchObject({
      status: 'runner_error',
      lifecycleStatus: 'runner_error',
      outcomeAggregate: 'could_not_verify',
      assertionAggregate: 'could_not_verify',
      presentation: {
        primaryStatus: 'runner_error',
        headline: 'FormCrash could not complete the journey.',
      },
      outcomeCheckResults: [
        {
          status: 'could_not_verify',
          observed: {
            verified: false,
            evidenceBoundary: 'browser_visible_only',
          },
          evidenceReferences: {
            triggerEventIds: [],
            requestObservationIds: [],
            screenshotArtifactIds: [],
            runnerEventIds: [],
          },
        },
      ],
    });
    expect(result.outcomeCheckResults[0]?.reason).toContain(
      'did not reach a browser state',
    );
    expect(owner.launchCount).toBe(0);

    const legacyShape: Record<string, unknown> = { ...result };
    delete legacyShape.lifecycleStatus;
    expect(externalRunDetailSchema.parse(legacyShape).lifecycleStatus).toBe(
      'runner_error',
    );
  });

  it('classifies a restored session redirect to login as authentication required', async () => {
    const configured = configure({});
    const store = new AuthStateStore(temporary.config.artifactRoot, settings);
    await store.save(configured.projectId, {
      saveStorageState: (destination) => {
        writeFileSync(destination, '{"cookies":[]}');
        return Promise.resolve();
      },
      close: () => Promise.resolve(),
    });
    const owner = new FakeOwner({
      currentUrl: 'http://127.0.0.1:49999/login',
    });

    const result = await runner(owner, new BrowserOwnership()).run(
      configured.versionId,
      {},
    );

    expect(result.status).toBe('runner_error');
    expect(result.runnerError).toMatchObject({
      code: 'authentication_required',
      failedStep: null,
    });
    expect(result.triggerAttempts).toBe(0);
    expect(owner.lastOptions?.storageStatePath).toBeDefined();
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

  it('keeps secret-derived steps and hook values out of persisted evidence and screenshot metadata', async () => {
    const syntheticSecret = 'FORMCRASH_PATCH0_SECRET_7f3b1a';
    const configured = configureSecretScenario();
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(null, {
        status: 204,
      }),
    );
    const owner = new FakeOwner();
    const result = await runner(owner, new BrowserOwnership()).run(
      configured.versionId,
      { ROOT_SECRET: syntheticSecret },
    );

    expect(result.status).toBe('passed');
    expect(fetchMock).toHaveBeenCalledOnce();
    const hookRequest = fetchMock.mock.calls[0]?.[1];
    expect(hookRequest?.headers).toMatchObject({
      authorization: `Bearer ${syntheticSecret}`,
    });
    expect(hookRequest?.body).toBe(
      JSON.stringify({ token: `body-${syntheticSecret}` }),
    );
    expect(owner.lastSession?.screenshotMasks).toContainEqual({
      strategy: 'id',
      value: 'secret-derived-field',
    });
    expect(Object.keys(result.resolvedValues).sort()).toEqual([
      'RESOLVED_STEP_2',
      'SAFE_VALUE',
    ]);
    expect(result.resolvedValues.SAFE_VALUE).toMatch(/^FC-/u);
    expect(result.resolvedValues.RESOLVED_STEP_2).toMatch(/^FC-/u);

    const persistedEvidence = {
      runs: database.connection
        .prepare(
          `SELECT resolved_values_json, network_observations_json,
                  runner_error_json, warnings_json
             FROM external_runs WHERE id = ?`,
        )
        .all(result.runId),
      events: database.connection
        .prepare(
          `SELECT payload_json FROM external_run_events WHERE run_id = ?`,
        )
        .all(result.runId),
      assertions: database.connection
        .prepare(
          `SELECT description, expected_description, observed_description
             FROM external_assertion_results WHERE run_id = ?`,
        )
        .all(result.runId),
      artifacts: database.connection
        .prepare(
          `SELECT metadata_json, relative_path
             FROM external_artifacts WHERE run_id = ?`,
        )
        .all(result.runId),
    };
    expect(JSON.stringify(result)).not.toContain(syntheticSecret);
    expect(JSON.stringify(persistedEvidence)).not.toContain(syntheticSecret);
  });

  it('does not expose a secret-derived browser value in runner diagnostics', async () => {
    const syntheticSecret = 'FORMCRASH_PATCH0_SECRET_7f3b1a';
    const configured = configureSecretScenario({ includeHook: false });
    const owner = new FakeOwner({ failFillWithValue: true });
    const result = await runner(owner, new BrowserOwnership()).run(
      configured.versionId,
      { ROOT_SECRET: syntheticSecret },
    );

    expect(result.status).toBe('runner_error');
    expect(result.runnerError).toMatchObject({
      code: 'journey_step_failed',
      failedStep: {
        stepName: 'Fill derived secret',
        technicalMessage: null,
      },
    });
    expect(JSON.stringify(result)).not.toContain(syntheticSecret);
    expect(
      JSON.stringify(
        database.connection
          .prepare(
            `SELECT resolved_values_json, runner_error_json
               FROM external_runs WHERE id = ?`,
          )
          .all(result.runId),
      ),
    ).not.toContain(syntheticSecret);
  });

  it('persists could_not_verify and releases Chromium after locator evaluation fails', async () => {
    const configured = configure({ withOutcomeCheck: true });
    const frozenVersion = experiments.getVersion(configured.versionId)!;
    const frozenCheck = frozenVersion.outcomeCheckSnapshot.checks[0]!;
    expect(
      outcomes.deleteOutcomeCheck(frozenVersion.journeyId, frozenCheck.id),
    ).toBe('deleted');
    outcomes.saveOutcomeCheck({
      journeyId: frozenVersion.journeyId,
      criticalActionId: frozenVersion.outcomeCheckSnapshot.criticalAction!.id,
      type: 'final_pathname_matches',
      description: 'A later check belongs only to a future test version.',
      expectedPathname: '/later',
    });
    const owner = new FakeOwner({ failOutcomeEvaluation: true });
    const ownership = new BrowserOwnership();
    const result = await runner(owner, ownership).run(configured.versionId, {});

    expect(result.lifecycleStatus).toBe('completed');
    expect(result.outcomeAggregate).toBe('could_not_verify');
    expect(result.outcomeCheckResults).toEqual([
      expect.objectContaining({
        outcomeCheckId: frozenCheck.id,
        status: 'could_not_verify',
      }),
    ]);
    expect(result.outcomeCheckSnapshot.checks).toEqual([frozenCheck]);
    expect(owner.lastSession?.closed).toBe(true);
    expect(ownership.activeWorkload).toBeNull();
  });

  it('omits unavailable screenshots and requests instead of persisting dangling evidence', async () => {
    const configured = configure({ withOutcomeCheck: true });
    const owner = new FakeOwner({ failScreenshots: true });
    const result = await runner(owner, new BrowserOwnership()).run(
      configured.versionId,
      {},
    );

    expect(result.lifecycleStatus).toBe('completed');
    expect(result.warnings).toHaveLength(3);
    expect(result.artifacts).toEqual([]);
    expect(result.networkObservations).toEqual([]);
    expect(result.outcomeCheckResults[0]?.evidenceReferences).toMatchObject({
      requestObservationIds: [],
      screenshotArtifactIds: [],
    });
  });

  it('rejects a malformed approved Outcome Check before saving a version', () => {
    expect(() => configure({ invalidOutcomeBinding: true })).toThrow();
    expect(
      database.connection
        .prepare('SELECT COUNT(*) AS count FROM external_runs')
        .get(),
    ).toEqual({ count: 0 });
  });
});

function configure(options: {
  readonly requiredVariable?: boolean;
  readonly beforeHookUrl?: string;
  readonly afterHookUrl?: string;
  readonly assertionText?: string;
  readonly withOutcomeCheck?: boolean;
  readonly invalidOutcomeBinding?: boolean;
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
  if (options.withOutcomeCheck || options.invalidOutcomeBinding) {
    const action = outcomes.approveCriticalAction(journey, {
      stepId: targetStepId,
      label: 'Submit',
    });
    const target = {
      locator: { strategy: 'id' as const, value: 'complete' },
      fingerprint: {
        tagName: 'section',
        dataFormcrash: null,
        dataTestId: null,
        id: 'complete',
        role: null,
        accessibleName: null,
        name: null,
        cssPath: '#complete',
      },
      preview: 'Complete',
      reliability: 'high' as const,
      warnings: [],
      generatedBindings: [],
    };
    if (options.invalidOutcomeBinding) {
      database.connection
        .prepare(
          `INSERT INTO outcome_checks
            (id, journey_id, critical_action_id, outcome_type,
             definition_json, created_at)
           VALUES (?, ?, ?, 'matching_item_appears_exactly_once', ?, ?)`,
        )
        .run(
          crypto.randomUUID(),
          journey.id,
          action.id,
          JSON.stringify({
            description: 'Malformed binding',
            target,
            binding: {
              expression: 'var.SECRET',
              template: '{{var.SECRET}}',
              label: 'Unsafe binding',
            },
          }),
          new Date().toISOString(),
        );
    } else {
      outcomes.saveOutcomeCheck({
        journeyId: journey.id,
        criticalActionId: action.id,
        type: 'visible_element_exists',
        description: 'Completion should be visible.',
        target,
      });
    }
  }
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
  const version = experiments.createTest({
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
      requestSelectionProvenance: null,
    },
  });
  return { versionId: version.id, projectId: project.id };
}

function configureSecretScenario(
  options: { readonly includeHook?: boolean } = {},
) {
  const project = projects.createProject({
    name: `Secret runner ${crypto.randomUUID()}`,
    targetUrl: 'http://127.0.0.1:49999/controlled',
    description: 'Transitive secret runner test',
  });
  const targetStepId = crypto.randomUUID();
  const journey = projects.saveJourney({
    projectId: project.id,
    name: 'Secret-derived step',
    steps: [
      {
        id: crypto.randomUUID(),
        name: 'Fill derived secret',
        type: 'fill',
        timestamp: 0,
        url: project.targetUrl,
        locator: { strategy: 'id', value: 'secret-derived-field' },
        fingerprint: null,
        value: {
          kind: 'safe',
          value: 'prefix-{{var.DERIVED_SECRET}}',
        },
        sensitive: false,
      },
      {
        id: crypto.randomUUID(),
        name: 'Fill safe generated value',
        type: 'fill',
        timestamp: 1,
        url: project.targetUrl,
        locator: { strategy: 'id', value: 'safe-generated-field' },
        fingerprint: null,
        value: { kind: 'safe', value: '{{var.SAFE_VALUE}}' },
        sensitive: false,
      },
      {
        id: targetStepId,
        name: 'Submit',
        type: 'submit',
        timestamp: 2,
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
  settings.save(project.id, {
    variables: [
      {
        name: 'ROOT_SECRET',
        secret: true,
        description: 'Synthetic test secret',
        template: null,
      },
      {
        name: 'DERIVED_SECRET',
        secret: false,
        description: 'Must inherit sensitivity',
        template: '{{var.ROOT_SECRET}}',
      },
      {
        name: 'SAFE_VALUE',
        secret: false,
        description: 'Safe generated value',
        template: '{{unique.text}}',
      },
    ],
    beforeRunHook:
      options.includeHook === false
        ? null
        : {
            method: 'POST',
            url: 'https://hooks.example.test/reset',
            headers: {
              authorization: 'Bearer {{var.DERIVED_SECRET}}',
            },
            body: {
              token: 'body-{{var.DERIVED_SECRET}}',
            },
            timeoutMs: 100,
          },
    afterRunHook: null,
  });
  const version = experiments.createTest({
    projectId: project.id,
    journey,
    request: {
      name: 'Secret-safe impatient submit',
      targetStepId,
      triggerCount: 2,
      intervalMs: 0,
      networkMatcher: null,
      assertions: [
        {
          id: 'completion',
          type: 'text_appeared',
          text: 'Complete',
          description: 'Completion appears.',
        },
      ],
      continueAfterTarget: false,
      requestSelectionProvenance: null,
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

  constructor(
    private readonly options: {
      readonly failFillWithValue?: boolean;
      readonly currentUrl?: string;
      readonly failOutcomeEvaluation?: boolean;
      readonly failScreenshots?: boolean;
    } = {},
  ) {}

  launchRecording(): Promise<RecordingBrowserSession> {
    throw new Error('Recording is not used by this test.');
  }

  launchReplay(options: ExternalBrowserOptions): Promise<ReplayBrowserSession> {
    this.launchCount += 1;
    this.lastOptions = options;
    this.lastSession = new FakeSession(this.options);
    return Promise.resolve(this.lastSession);
  }
}

class FakeSession implements ReplayBrowserSession {
  private observer: ((observation: NetworkObservation) => void) | null = null;
  readonly settleDurations: number[] = [];
  screenshotMasks: readonly ReplayLocator[] = [];

  constructor(
    private readonly options: {
      readonly failFillWithValue?: boolean;
      readonly currentUrl?: string;
      readonly failOutcomeEvaluation?: boolean;
      readonly failScreenshots?: boolean;
    } = {},
  ) {}
  navigate(): Promise<void> {
    return Promise.resolve();
  }
  click(): Promise<void> {
    return Promise.resolve();
  }
  fill(_locator: ReplayLocator, value: string): Promise<void> {
    if (this.options.failFillWithValue) {
      throw new Error(`Browser rejected fill value ${value}.`);
    }
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
    if (this.options.failScreenshots) {
      return Promise.reject(new Error('screenshot unavailable'));
    }
    writeFileSync(destination, 'fake png');
    return Promise.resolve();
  }
  setScreenshotMasks(locators: readonly ReplayLocator[]): void {
    this.screenshotMasks = [...locators];
  }
  isVisible(): Promise<boolean> {
    return Promise.resolve(true);
  }
  countVisibleMatches() {
    if (this.options.failOutcomeEvaluation) {
      return Promise.reject(new Error('stale locator'));
    }
    return Promise.resolve({
      visibleCount: 1,
      examinedCount: 1,
      totalLocatorMatchCount: 1,
      truncated: false,
    });
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
    return this.options.currentUrl ?? 'http://127.0.0.1:49999/complete';
  }
  settle(milliseconds: number): Promise<void> {
    this.settleDurations.push(milliseconds);
    return Promise.resolve();
  }
  close(): Promise<void> {
    this.closed = true;
    this.observer = null;
    return Promise.resolve();
  }
  closed = false;
}
