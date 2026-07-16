import { once } from 'node:events';
import { createServer } from 'node:http';

import { afterEach, describe, expect, it } from 'vitest';
import type { ReplayLocator } from '@formcrash/contracts';

import type { FormCrashDatabase } from '../src/persistence/database.js';
import { initializePersistence } from '../src/persistence/initialize.js';
import { OutcomeCheckRepository } from '../src/persistence/outcome-check-repository.js';
import { ProjectJourneyRepository } from '../src/persistence/project-journey-repository.js';
import { ProjectSettingsRepository } from '../src/persistence/project-settings-repository.js';
import { AuthStateStore } from '../src/runner/external/auth-session.js';
import { BrowserOwnership } from '../src/runner/infrastructure/browser-ownership.js';
import {
  OutcomeCaptureManager,
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
    expect(setup.browser.filledValues).toContainEqual(
      expect.stringMatching(/^formcrash\+[a-f0-9]{12}@example\.test$/u),
    );
    expect(setup.browser.closed).toBe(false);
    expect(setup.ownership.activeWorkload).toBe('outcome_capture');

    const completed = await setup.manager.close(capture.id);
    expect(completed.status).toBe('completed');
    expect(setup.browser.closed).toBe(true);
    expect(setup.ownership.activeWorkload).toBeNull();
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
    expect(JSON.stringify(selected)).not.toContain(generatedEmail);

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
      ...(includeSecret
        ? [
            {
              id: 'secret',
              name: 'Fill secret',
              type: 'fill' as const,
              timestamp: 2,
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
        timestamp: 3,
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
  const ownership = new BrowserOwnership();
  const manager = new OutcomeCaptureManager(
    temporary.config,
    projects,
    settings,
    new AuthStateStore(temporary.config.artifactRoot, settings),
    outcomes,
    ownership,
    new FakeBrowserOwner(browser),
    now,
    ttlMs ?? 10 * 60 * 1_000,
  );
  return {
    manager,
    browser,
    ownership,
    outcomes,
    journey,
    settings,
    projectId: project.id,
  };
}

class FakeBrowserOwner implements ExternalBrowserOwner {
  constructor(private readonly session: FakeReplayBrowser) {}

  launchRecording(): Promise<RecordingBrowserSession> {
    return Promise.reject(new Error('Not used.'));
  }

  launchReplay(): Promise<ReplayBrowserSession> {
    return Promise.resolve(this.session);
  }
}

class FakeReplayBrowser implements ReplayBrowserSession {
  readonly filledValues: string[] = [];
  closed = false;
  private selection: ((selection: OutcomeElementSelection) => void) | null =
    null;

  navigate(): Promise<void> {
    return Promise.resolve();
  }
  click(): Promise<void> {
    return Promise.resolve();
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
  settle(): Promise<void> {
    return Promise.resolve();
  }
  close(): Promise<void> {
    this.closed = true;
    return Promise.resolve();
  }
  enterOutcomeSelection(
    onSelection: (selection: OutcomeElementSelection) => void,
  ): Promise<void> {
    this.selection = onSelection;
    return Promise.resolve();
  }
  emitSelection(selection: OutcomeElementSelection): void {
    this.selection?.(selection);
  }
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
