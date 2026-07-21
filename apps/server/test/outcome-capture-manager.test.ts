import { once } from 'node:events';
import { createServer } from 'node:http';

import { afterEach, describe, expect, it } from 'vitest';
import {
  hybridTraceManifestSchema,
  type OutcomeCaptureStatus,
  type RecordedInteraction,
  type ReplayLocator,
} from '@formcrash/contracts';

import type { FormCrashDatabase } from '../src/persistence/database.js';
import { initializePersistence } from '../src/persistence/initialize.js';
import { OutcomeCheckRepository } from '../src/persistence/outcome-check-repository.js';
import { ProjectJourneyRepository } from '../src/persistence/project-journey-repository.js';
import { ProjectSettingsRepository } from '../src/persistence/project-settings-repository.js';
import { AuthStateStore } from '../src/runner/external/auth-session.js';
import { BrowserOwnership } from '../src/runner/infrastructure/browser-ownership.js';
import {
  OutcomeCaptureManager,
  OutcomeCaptureNotActiveError,
  OutcomeCaptureStaleError,
} from '../src/runner/outcomes/outcome-capture-manager.js';
import type {
  ExternalBrowserOwner,
  OutcomeElementSelection,
  RecordingBrowserSession,
  ReplayBrowserSession,
} from '../src/runner/recording/external-browser.js';
import {
  createTemporaryTestConfig,
  type TemporaryTestConfig,
} from './fixtures.js';

let database: FormCrashDatabase | undefined;
let temporary: TemporaryTestConfig | undefined;

afterEach(() => {
  database?.close();
  temporary?.cleanup();
  database = undefined;
  temporary = undefined;
});

describe('Outcome baseline capture lifecycle', () => {
  it('replays with generated safe data, keeps Chromium open, and cleans up explicitly', async () => {
    const setup = createSetup();
    const capture = await setup.manager.start(setup.journey.id, {});

    expect(capture.status).toBe('awaiting_selection');
    expect(capture.generatedInputs).toContainEqual(
      expect.objectContaining({
        stepId: 'email',
        template: '{{unique.email}}',
      }),
    );
    expect(capture.generatedInputs).toContainEqual(
      expect.objectContaining({
        stepId: 'slot-code',
        template: '{{unique.text}}',
      }),
    );
    expect(
      capture.generatedInputs.find((input) => input.stepId === 'email')
        ?.resolvedValue,
    ).toMatch(/^formcrash\+[a-f0-9]{12}@example\.test$/u);
    expect(
      capture.generatedInputs.find((input) => input.stepId === 'slot-code')
        ?.resolvedValue,
    ).toMatch(/^FC-[a-f0-9]{12}$/u);
    expect(setup.browser.filledValues).toContainEqual(
      expect.stringMatching(/^formcrash\+[a-f0-9]{12}@example\.test$/u),
    );
    expect(setup.browser.filledValues).toContainEqual(
      expect.stringMatching(/^FC-[a-f0-9]{12}$/u),
    );
    expect(setup.browser.closed).toBe(false);
    expect(setup.ownership.activeWorkload).toBe('outcome_capture');

    const completed = await setup.manager.close(capture.id);
    expect(completed.status).toBe('completed');
    expect(setup.browser.closed).toBe(true);
    expect(setup.ownership.activeWorkload).toBeNull();
  });

  it('uses the recorded target candidate when a dropdown label is ambiguous', async () => {
    const setup = createSetup();
    const recording = setup.projects.createRecordingSession(setup.projectId);
    const interaction = {
      id: 'building-dropdown-interaction',
      stepId: 'building-dropdown',
      sequence: 1,
      pageId: 'page-1',
      framePath: [],
      startedAt: 1,
      durationMs: 0,
      intent: 'click' as const,
      pointerType: 'mouse' as const,
      targetCandidates: [
        {
          locator: { strategy: 'text' as const, value: 'Current building' },
          source: 'text' as const,
          confidence: 0.72,
        },
        {
          locator: {
            strategy: 'css' as const,
            value: '#building-switcher',
          },
          source: 'structure' as const,
          confidence: 0.45,
        },
      ],
      fingerprint: {
        tagName: 'button',
        inputType: null,
        dataFormcrash: null,
        dataTestId: null,
        id: null,
        role: 'combobox',
        accessibleName: null,
        name: null,
        label: null,
        text: 'Current building',
        cssPath: '#building-switcher',
      },
      geometry: null,
      postconditions: [
        {
          kind: 'aria_attribute' as const,
          name: 'aria-expanded',
          value: 'false',
          target: {
            strategy: 'text' as const,
            value: 'Current building',
          },
        },
      ],
      retrySafety: 'side_effect_possible' as const,
    };
    const manifest = hybridTraceManifestSchema.parse({
      formatVersion: 2,
      environment: {
        viewportWidth: 1440,
        viewportHeight: 900,
        deviceScaleFactor: 1,
        locale: 'en-US',
        timezoneId: 'UTC',
        userAgent: 'outcome-capture-test',
        colorScheme: 'light',
        browserName: 'chromium',
        browserVersion: 'test',
      },
      interactions: [interaction],
      eventCount: 1,
      pageCount: 1,
      frameCount: 1,
      redactionVersion: 1,
      videoCaptured: false,
      truncated: false,
    });
    const trace = setup.projects.createRecordingTrace({
      recordingSessionId: recording.id,
      manifest,
      relativePath: 'journey-traces/test/trace-v2.json.gz',
      sizeBytes: 1,
      checksumSha256: 'a'.repeat(64),
    });
    database?.connection
      .prepare(
        `INSERT INTO journey_trace_links
          (journey_id, trace_id, manifest_json, created_at)
         VALUES (?, ?, ?, ?)`,
      )
      .run(
        setup.journey.id,
        trace.id,
        JSON.stringify(manifest),
        new Date().toISOString(),
      );

    const capture = await setup.manager.start(setup.journey.id, {});

    expect(capture.status).toBe('awaiting_selection');
    expect(setup.browser.semanticClickCount).toBe(0);
    expect(setup.browser.clickInteractions).toHaveLength(1);
    expect(setup.browser.clickInteractions[0]).toMatchObject({
      stepId: 'building-dropdown',
      targetCandidates: interaction.targetCandidates,
      postconditions: [],
    });
    expect(setup.browser.settleDurations).toEqual([
      ...setup.journey.steps.map(() => 1_000),
      900,
    ]);
  });

  it('captures a stable target and persists a generated-value binding without the literal value', async () => {
    const setup = createSetup();
    const capture = await setup.manager.start(setup.journey.id, {});
    const generatedEmail = setup.browser.filledValues.find((value) =>
      value.includes('@example.test'),
    );
    if (generatedEmail === undefined)
      throw new Error('Email was not generated.');

    setup.browser.emitSelection(
      stableSelection(`Tenant ${generatedEmail}`, {
        strategy: 'data-formcrash',
        value: 'tenant-row',
      }),
    );
    const selected = await setup.manager.get(capture.id);
    expect(selected).toMatchObject({
      status: 'selection_ready',
      selectedTarget: {
        preview: 'Tenant {{unique.email}}',
        generatedBindings: [
          {
            expression: 'unique.email',
            template: '{{unique.email}}',
          },
        ],
      },
    });
    expect(JSON.stringify(selected?.selectedTarget)).not.toContain(
      generatedEmail,
    );

    const check = await setup.manager.approve(capture.id, {
      type: 'matching_item_appears_exactly_once',
      description: 'Exactly one tenant row should appear.',
      bindingExpression: 'unique.email',
    });
    expect(check.type).toBe('matching_item_appears_exactly_once');
    expect(JSON.stringify(check)).not.toContain(generatedEmail);
    expect(setup.outcomes.listOutcomeChecks(setup.journey.id)).toContainEqual(
      check,
    );
  });

  it('parameterizes a selected row locator that contains the generated identity', async () => {
    const setup = createSetup();
    const capture = await setup.manager.start(setup.journey.id, {});
    const generatedEmail = setup.browser.filledValues.find((value) =>
      value.includes('@example.test'),
    );
    if (generatedEmail === undefined) {
      throw new Error('Email was not generated.');
    }

    setup.browser.emitSelection(
      stableSelection(`Tenant ${generatedEmail}`, {
        strategy: 'role',
        role: 'row',
        name: `Tenant ${generatedEmail}`,
      }),
    );
    const selected = await setup.manager.get(capture.id);

    expect(selected).toMatchObject({
      status: 'selection_ready',
      selectedTarget: {
        locator: {
          strategy: 'role',
          role: 'row',
          name: 'Tenant {{unique.email}}',
        },
        generatedBindings: [
          {
            expression: 'unique.email',
            template: '{{unique.email}}',
          },
        ],
      },
    });
    expect(
      selected?.selectionWarnings.some(
        (warning) => warning.code === 'dynamic_locator',
      ),
    ).toBe(false);
    expect(JSON.stringify(selected?.selectedTarget)).not.toContain(
      generatedEmail,
    );

    const check = await setup.manager.approve(capture.id, {
      type: 'matching_item_appears_exactly_once',
      description: 'Exactly one generated tenant row should appear.',
      bindingExpression: 'unique.email',
    });
    expect(JSON.stringify(check)).not.toContain(generatedEmail);
  });

  it('approves a captured final pathname without requiring an element selection', async () => {
    const setup = createSetup();
    const capture = await setup.manager.start(setup.journey.id, {});

    expect(capture.status).toBe('awaiting_selection');
    expect(capture.selectedTarget).toBeNull();
    expect(capture.finalPathname).toBe('/complete');

    const check = await setup.manager.approve(capture.id, {
      type: 'final_pathname_matches',
      description: 'The journey should finish at /complete.',
      expectedPathname: '/complete',
    });

    expect(check).toMatchObject({
      type: 'final_pathname_matches',
      expectedPathname: '/complete',
    });
  });

  it('runs the configured cleanup hook when the capture closes', async () => {
    let cleanupCalls = 0;
    const server = createServer((_request, response) => {
      cleanupCalls += 1;
      response.writeHead(204);
      response.end();
    });
    server.listen(0, '127.0.0.1');
    await once(server, 'listening');
    const address = server.address();
    if (address === null || typeof address === 'string') {
      throw new Error('Cleanup fixture did not bind.');
    }
    const setup = createSetup();
    setup.settings.save(setup.projectId, {
      variables: [],
      beforeRunHook: null,
      afterRunHook: {
        method: 'POST',
        url: `http://127.0.0.1:${address.port}/cleanup`,
        headers: {},
        body: null,
        timeoutMs: 1_000,
      },
    });

    try {
      const capture = await setup.manager.start(setup.journey.id, {});
      await setup.manager.close(capture.id);
      expect(cleanupCalls).toBe(1);
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  });

  it('rejects ambiguous locators and secret-derived selected content', async () => {
    const setup = createSetup(true);
    const capture = await setup.manager.start(setup.journey.id, {
      TENANT_SECRET: 'NeverPersistThis',
    });
    setup.browser.emitSelection({
      ...stableSelection('Tenant result', {
        strategy: 'data-testid',
        value: 'tenant-row',
      }),
      matchCount: 2,
      visibleMatchCount: 2,
    });
    const ambiguous = await setup.manager.get(capture.id);
    expect(ambiguous?.status).toBe('selection_rejected');
    expect(
      ambiguous?.selectionWarnings.some(
        (warning) => warning.code === 'ambiguous_locator',
      ),
    ).toBe(true);

    const generatedEmail = setup.browser.filledValues.find((value) =>
      value.includes('@example.test'),
    );
    if (generatedEmail === undefined) {
      throw new Error('Email was not generated.');
    }
    setup.browser.emitSelection(
      stableSelection('Tenant result without generated identity text', {
        strategy: 'id',
        value: generatedEmail,
      }),
    );
    const unboundDynamic = await setup.manager.get(capture.id);
    expect(unboundDynamic?.status).toBe('selection_rejected');
    expect(
      unboundDynamic?.selectionWarnings.some(
        (warning) => warning.code === 'dynamic_locator',
      ),
    ).toBe(true);
    expect(
      JSON.stringify({
        selectedTarget: unboundDynamic?.selectedTarget,
        selectionWarnings: unboundDynamic?.selectionWarnings,
      }),
    ).not.toContain(generatedEmail);

    setup.browser.emitSelection({
      ...stableSelection('Iframe tenant result', {
        strategy: 'data-testid',
        value: 'tenant-row',
      }),
      topFrame: false,
      frameUrl: 'https://cross-origin.example.test/frame',
    });
    const iframe = await setup.manager.get(capture.id);
    expect(iframe?.status).toBe('selection_rejected');
    expect(
      iframe?.selectionWarnings.some(
        (warning) => warning.code === 'unsupported_iframe',
      ),
    ).toBe(true);

    setup.browser.emitSelection(
      stableSelection('NeverPersistThis', {
        strategy: 'data-testid',
        value: 'tenant-row',
      }),
    );
    const rejected = await setup.manager.get(capture.id);
    expect(rejected?.status).toBe('selection_rejected');
    expect(
      rejected?.selectionWarnings.some(
        (warning) => warning.code === 'sensitive_content',
      ),
    ).toBe(true);
    expect(JSON.stringify(rejected)).not.toContain('NeverPersistThis');
  });

  it('expires stale capture sessions, closes Chromium, and rejects approval', async () => {
    let now = Date.parse('2026-07-17T00:00:00.000Z');
    const setup = createSetup(false, () => now, 100);
    const capture = await setup.manager.start(setup.journey.id, {});
    now += 101;

    await expect(
      setup.manager.approve(capture.id, {
        type: 'final_pathname_matches',
        description: 'The final pathname matches.',
        expectedPathname: '/complete',
      }),
    ).rejects.toBeInstanceOf(OutcomeCaptureStaleError);
    expect((await setup.manager.get(capture.id))?.status).toBe('expired');
    expect(setup.browser.closed).toBe(true);
    expect(setup.ownership.activeWorkload).toBeNull();
  });

  it('recovers the active capture after dashboard refresh', async () => {
    const setup = createSetup();
    const capture = await setup.manager.start(setup.journey.id, {});

    expect(await setup.manager.getForJourney(setup.journey.id)).toEqual(
      capture,
    );
    expect(await setup.manager.getForJourney('another-journey')).toBeNull();
    await setup.manager.close(capture.id);
    expect(await setup.manager.getForJourney(setup.journey.id)).toBeNull();
  });

  it('preserves final-page recovery when Chromium closes after a successful baseline', async () => {
    const setup = createSetup();
    const capture = await setup.manager.start(setup.journey.id, {});

    setup.browser.simulateUserClose();
    const cancelled = await waitForCaptureStatus(
      setup.manager,
      capture.id,
      'selection_cancelled',
    );
    expect(cancelled.errorMessage).toBeNull();
    expect(cancelled.finalPathname).toBe('/complete');
    expect(await setup.manager.getForJourney(setup.journey.id)).toEqual(
      cancelled,
    );
    await expect(
      setup.manager.approve(capture.id, {
        type: 'visible_element_exists',
        description: 'The tenant row should be visible.',
      }),
    ).rejects.toBeInstanceOf(OutcomeCaptureNotActiveError);
    const saved = await setup.manager.approve(capture.id, {
      type: 'final_pathname_matches',
      description: 'The journey should finish at /complete.',
      expectedPathname: '/complete',
    });
    expect(saved).toMatchObject({
      type: 'final_pathname_matches',
      expectedPathname: '/complete',
    });
    expect((await setup.manager.get(capture.id))?.status).toBe('completed');
    expect(setup.ownership.activeWorkload).toBeNull();
    const release = setup.ownership.acquire('recording');
    release();
    expect(setup.ownership.activeWorkload).toBeNull();
  });

  it('closes an active capture and releases ownership during server shutdown', async () => {
    const setup = createSetup();
    const capture = await setup.manager.start(setup.journey.id, {});

    await setup.manager.closeAll();

    expect((await setup.manager.get(capture.id))?.status).toBe('completed');
    expect(setup.browser.closed).toBe(true);
    expect(setup.ownership.activeWorkload).toBeNull();
  });

  it('releases ownership when preparation fails before browser launch', async () => {
    const server = createServer((_request, response) => {
      response.writeHead(500);
      response.end('preparation failed');
    });
    server.listen(0, '127.0.0.1');
    await once(server, 'listening');
    const address = server.address();
    if (address === null || typeof address === 'string') {
      throw new Error('Preparation failure fixture did not bind.');
    }
    const setup = createSetup();
    setup.settings.save(setup.projectId, {
      variables: [],
      beforeRunHook: {
        method: 'POST',
        url: `http://127.0.0.1:${address.port}/prepare`,
        headers: {},
        body: null,
        timeoutMs: 1_000,
      },
      afterRunHook: null,
    });

    try {
      const capture = await setup.manager.start(setup.journey.id, {});
      expect(capture.status).toBe('runner_error');
      expect(setup.browserOwner.launchCalls).toBe(0);
      expect(setup.ownership.activeWorkload).toBeNull();
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  });

  it('closes Chromium and releases ownership when replay fails after launch', async () => {
    const setup = createSetup();
    setup.browser.navigateError = new Error('fixture navigation failed');

    const capture = await setup.manager.start(setup.journey.id, {});

    expect(capture).toMatchObject({
      status: 'runner_error',
      errorMessage: 'fixture navigation failed',
    });
    expect(setup.browser.closed).toBe(true);
    expect(setup.ownership.activeWorkload).toBeNull();
  });

  it('distinguishes Outcome selector setup failure after the replay mutation completes', async () => {
    const setup = createSetup();
    setup.browser.selectionError = new Error(
      'frame.evaluate: ReferenceError: __name is not defined',
    );

    const capture = await setup.manager.start(setup.journey.id, {});

    expect(capture).toMatchObject({
      status: 'runner_error',
      finalPathname: '/complete',
    });
    expect(capture.errorMessage).toContain(
      'Baseline replay completed, but Outcome Check selection could not start.',
    );
    expect(setup.browser.filledValues.length).toBeGreaterThan(0);
    expect(setup.browser.closed).toBe(true);
    expect(setup.ownership.activeWorkload).toBeNull();
  });

  it('surfaces cleanup-hook failure but still releases ownership', async () => {
    const server = createServer((_request, response) => {
      response.writeHead(500);
      response.end('cleanup failed');
    });
    server.listen(0, '127.0.0.1');
    await once(server, 'listening');
    const address = server.address();
    if (address === null || typeof address === 'string') {
      throw new Error('Cleanup failure fixture did not bind.');
    }
    const setup = createSetup();
    setup.settings.save(setup.projectId, {
      variables: [],
      beforeRunHook: null,
      afterRunHook: {
        method: 'POST',
        url: `http://127.0.0.1:${address.port}/cleanup`,
        headers: {},
        body: null,
        timeoutMs: 1_000,
      },
    });

    try {
      const capture = await setup.manager.start(setup.journey.id, {});
      const completed = await setup.manager.close(capture.id);
      expect(completed).toMatchObject({
        status: 'completed',
        errorMessage:
          'The baseline replay closed, but the configured cleanup hook failed.',
      });
      expect(setup.ownership.activeWorkload).toBeNull();
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  });
});

function createSetup(
  includeSecret = false,
  now: () => number = Date.now,
  ttlMs?: number,
) {
  temporary = createTemporaryTestConfig();
  database = initializePersistence(temporary.config);
  const projects = new ProjectJourneyRepository(database.connection);
  const settings = new ProjectSettingsRepository(database.connection);
  const outcomes = new OutcomeCheckRepository(database.connection);
  const project = projects.createProject({
    name: 'Tenant fixture',
    targetUrl: 'http://localhost:4300',
    description: '',
  });
  const journey = projects.saveJourney({
    projectId: project.id,
    name: 'Add Tenant',
    steps: [
      {
        id: 'building-dropdown',
        name: 'Open building selector',
        type: 'click',
        timestamp: 0,
        url: project.targetUrl,
        locator: { strategy: 'text', value: 'Current building' },
        fingerprint: {
          tagName: 'button',
          inputType: null,
          dataFormcrash: null,
          dataTestId: null,
          id: null,
          role: 'combobox',
          accessibleName: null,
          name: null,
          label: null,
          text: 'Current building',
          cssPath: '#building-switcher',
        },
        value: null,
        sensitive: false,
      },
      {
        id: 'email',
        name: 'Fill tenant email',
        type: 'fill',
        timestamp: 1,
        url: project.targetUrl,
        locator: { strategy: 'name', value: 'email' },
        fingerprint: fingerprint('input', 'email', 'email'),
        value: { kind: 'safe', value: 'recorded@example.test' },
        sensitive: false,
      },
      {
        id: 'slot-code',
        name: 'Fill Slot Code *',
        type: 'fill',
        timestamp: 2,
        url: project.targetUrl,
        locator: { strategy: 'id', value: 'code' },
        fingerprint: {
          ...fingerprint('input', 'code', 'text'),
          accessibleName: 'Slot Code *',
          label: 'Slot Code *',
        },
        value: { kind: 'safe', value: 'A-23023' },
        sensitive: false,
      },
      ...(includeSecret
        ? [
            {
              id: 'secret',
              name: 'Fill secret',
              type: 'fill' as const,
              timestamp: 3,
              url: project.targetUrl,
              locator: { strategy: 'name' as const, value: 'secret' },
              fingerprint: fingerprint('input', 'secret', 'password'),
              value: {
                kind: 'sensitive' as const,
                variableName: 'TENANT_SECRET',
              },
              sensitive: true,
            },
          ]
        : []),
      {
        id: 'submit',
        name: 'Submit Tenant',
        type: 'submit',
        timestamp: 4,
        url: project.targetUrl,
        locator: { strategy: 'data-testid', value: 'tenant-form' },
        fingerprint: fingerprint('form', 'tenant-form', null),
        value: null,
        sensitive: false,
      },
    ],
    metadata: {
      recordingSessionId: null,
      recordedAt: '2026-07-17T00:00:00.000Z',
      warningCount: 0,
      normalizationRule: 'Test journey.',
    },
  });
  outcomes.approveCriticalAction(journey, {
    stepId: 'submit',
    label: 'Submit Tenant',
  });
  const browser = new FakeReplayBrowser();
  const browserOwner = new FakeBrowserOwner(browser);
  const ownership = new BrowserOwnership();
  const manager = new OutcomeCaptureManager(
    temporary.config,
    projects,
    settings,
    new AuthStateStore(temporary.config.artifactRoot, settings),
    outcomes,
    ownership,
    browserOwner,
    now,
    ttlMs ?? 10 * 60 * 1_000,
  );
  return {
    manager,
    browser,
    browserOwner,
    ownership,
    outcomes,
    projects,
    journey,
    settings,
    projectId: project.id,
  };
}

class FakeBrowserOwner implements ExternalBrowserOwner {
  launchCalls = 0;

  constructor(private readonly session: FakeReplayBrowser) {}

  launchRecording(): Promise<RecordingBrowserSession> {
    return Promise.reject(new Error('Not used.'));
  }

  launchReplay(): Promise<ReplayBrowserSession> {
    this.launchCalls += 1;
    return Promise.resolve(this.session);
  }
}

class FakeReplayBrowser implements ReplayBrowserSession {
  readonly filledValues: string[] = [];
  readonly clickInteractions: RecordedInteraction[] = [];
  readonly settleDurations: number[] = [];
  semanticClickCount = 0;
  closed = false;
  navigateError: Error | null = null;
  selectionError: Error | null = null;
  private selection: ((selection: OutcomeElementSelection) => void) | null =
    null;
  private closedCallback: (() => void) | null = null;

  navigate(): Promise<void> {
    if (this.navigateError !== null) return Promise.reject(this.navigateError);
    return Promise.resolve();
  }
  click(): Promise<void> {
    this.semanticClickCount += 1;
    return Promise.resolve();
  }
  clickInteraction(interaction: RecordedInteraction): Promise<{
    strategy: string;
    confidence: number;
    recovered: boolean;
    attempts: readonly string[];
  }> {
    this.clickInteractions.push(interaction);
    return Promise.resolve({
      strategy: 'css',
      confidence: 0.45,
      recovered: true,
      attempts: ['text: 2 candidate match(es)', 'css: 1 candidate match(es)'],
    });
  }
  verifyInteraction(): Promise<{
    passed: boolean;
    expected: readonly string[];
    observed: readonly string[];
  }> {
    return Promise.resolve({ passed: true, expected: [], observed: [] });
  }
  fill(_locator: ReplayLocator, value: string): Promise<void> {
    this.filledValues.push(value);
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
  triggerRepeated(): Promise<void> {
    return Promise.resolve();
  }
  observeNetwork(): void {}
  captureScreenshot(): Promise<void> {
    return Promise.resolve();
  }
  setScreenshotMasks(): void {}
  isVisible(): Promise<boolean> {
    return Promise.resolve(true);
  }
  isDisabled(): Promise<boolean> {
    return Promise.resolve(false);
  }
  textVisible(): Promise<boolean> {
    return Promise.resolve(true);
  }
  inputValue(): Promise<string | null> {
    return Promise.resolve(null);
  }
  currentUrl(): string {
    return 'http://localhost:4300/complete';
  }
  settle(milliseconds: number): Promise<void> {
    this.settleDurations.push(milliseconds);
    return Promise.resolve();
  }
  close(): Promise<void> {
    this.closed = true;
    return Promise.resolve();
  }
  onClosed(callback: () => void): void {
    this.closedCallback = callback;
  }
  simulateUserClose(): void {
    this.closed = true;
    this.closedCallback?.();
  }
  enterOutcomeSelection(
    onSelection: (selection: OutcomeElementSelection) => void,
  ): Promise<void> {
    if (this.selectionError !== null) {
      return Promise.reject(this.selectionError);
    }
    this.selection = onSelection;
    return Promise.resolve();
  }
  emitSelection(selection: OutcomeElementSelection): void {
    this.selection?.(selection);
  }
}

async function waitForCaptureStatus(
  manager: OutcomeCaptureManager,
  captureId: string,
  status: OutcomeCaptureStatus,
) {
  const deadline = Date.now() + 2_000;
  while (Date.now() < deadline) {
    const capture = await manager.get(captureId);
    if (capture?.status === status) return capture;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error(`Capture did not reach ${status}.`);
}

function stableSelection(
  text: string,
  locator: ReplayLocator,
): OutcomeElementSelection {
  return {
    topFrame: true,
    frameUrl: 'http://localhost:4300/complete',
    locator,
    fingerprint: {
      tagName: 'li',
      dataFormcrash:
        locator.strategy === 'data-formcrash' ? locator.value : null,
      dataTestId: locator.strategy === 'data-testid' ? locator.value : null,
      id: null,
      role: 'listitem',
      accessibleName: text,
      name: null,
      cssPath: 'main > ul > li',
    },
    inputType: null,
    markedSensitive: false,
    text,
    value: null,
    matchCount: 1,
    visibleMatchCount: 1,
  };
}

function fingerprint(tagName: string, name: string, inputType: string | null) {
  return {
    tagName,
    inputType,
    dataFormcrash: null,
    dataTestId: name,
    id: name,
    role: tagName === 'form' ? 'form' : 'textbox',
    accessibleName: name,
    name,
    label: name,
    text: null,
    cssPath: `#${name}`,
  };
}
