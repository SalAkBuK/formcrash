import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import type { FormCrashDatabase } from '../src/persistence/database.js';
import { initializePersistence } from '../src/persistence/initialize.js';
import { ProjectJourneyRepository } from '../src/persistence/project-journey-repository.js';
import { ProjectSettingsRepository } from '../src/persistence/project-settings-repository.js';
import { AuthStateStore } from '../src/runner/external/auth-session.js';
import { AuthValidationService } from '../src/runner/external/auth-validation.js';
import { SavedAuthenticationExpiredError } from '../src/runner/external/authentication-redirect.js';
import { BrowserOwnership } from '../src/runner/infrastructure/browser-ownership.js';
import { JourneyReplayService } from '../src/runner/recording/journey-replay.js';
import type {
  ExternalBrowserOwner,
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

beforeEach(() => {
  temporary = createTemporaryTestConfig();
  database = initializePersistence(temporary.config);
  projects = new ProjectJourneyRepository(database.connection);
  settings = new ProjectSettingsRepository(database.connection);
});

afterEach(() => {
  database.close();
  temporary.cleanup();
});

describe('authentication validation', () => {
  it.each([
    ['http://localhost:4300/portal', 'valid'],
    ['http://localhost:4300/login', 'invalid'],
  ] as const)('classifies redirect to %s as %s', async (currentUrl, status) => {
    const project = projects.createProject({
      name: 'Authentication target',
      targetUrl: 'http://localhost:4300/portal',
      environment: 'local',
      description: '',
    });
    const store = new AuthStateStore(temporary.config.artifactRoot, settings);
    await store.save(project.id, {
      saveStorageState: (destination) => {
        mkdirSync(path.dirname(destination), { recursive: true });
        writeFileSync(destination, '{"cookies":[]}');
        return Promise.resolve();
      },
      close: () => Promise.resolve(),
    });
    const ownership = new BrowserOwnership();
    const validation = await new AuthValidationService(
      temporary.config,
      projects,
      store,
      ownership,
      new FakeOwner(currentUrl),
    ).validate(project.id);

    expect(validation.status).toBe(status);
    expect(validation.currentUrl).toBe(currentUrl);
    expect(ownership.activeWorkload).toBeNull();
  });

  it('stops replay before journey steps when saved authentication redirects to login', async () => {
    const project = projects.createProject({
      name: 'Expired authentication target',
      targetUrl: 'http://localhost:4300/portal',
      environment: 'local',
      description: '',
    });
    const journey = projects.saveJourney({
      projectId: project.id,
      name: 'Authenticated journey',
      steps: [
        {
          id: 'open-profile',
          name: 'Open profile',
          type: 'click',
          timestamp: 0,
          url: project.targetUrl,
          locator: { strategy: 'id', value: 'profile' },
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
    const store = new AuthStateStore(temporary.config.artifactRoot, settings);
    await saveAuthentication(store, project.id);
    const owner = new FakeOwner('http://localhost:4300/login');
    const ownership = new BrowserOwnership();

    await expect(
      new JourneyReplayService(
        temporary.config,
        projects,
        ownership,
        owner,
        settings,
        store,
      ).replay(journey.id),
    ).rejects.toBeInstanceOf(SavedAuthenticationExpiredError);

    expect(owner.lastSession?.clickCount).toBe(0);
    expect(ownership.activeWorkload).toBeNull();
  });
});

class FakeOwner implements ExternalBrowserOwner {
  lastSession: FakeSession | null = null;

  constructor(private readonly current: string) {}
  launchRecording(): Promise<RecordingBrowserSession> {
    throw new Error('Recording is not used.');
  }
  launchReplay(): Promise<ReplayBrowserSession> {
    this.lastSession = new FakeSession(this.current);
    return Promise.resolve(this.lastSession);
  }
}

class FakeSession implements ReplayBrowserSession {
  clickCount = 0;

  constructor(private readonly current: string) {}
  navigate(): Promise<void> {
    return Promise.resolve();
  }
  click(): Promise<void> {
    this.clickCount += 1;
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
    return this.current;
  }
  settle(): Promise<void> {
    return Promise.resolve();
  }
  close(): Promise<void> {
    return Promise.resolve();
  }
}

async function saveAuthentication(
  store: AuthStateStore,
  projectId: string,
): Promise<void> {
  await store.save(projectId, {
    saveStorageState: (destination) => {
      mkdirSync(path.dirname(destination), { recursive: true });
      writeFileSync(destination, '{"cookies":[]}');
      return Promise.resolve();
    },
    close: () => Promise.resolve(),
  });
}
