import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import type { FormCrashDatabase } from '../src/persistence/database.js';
import { initializePersistence } from '../src/persistence/initialize.js';
import { ProjectJourneyRepository } from '../src/persistence/project-journey-repository.js';
import { ProjectSettingsRepository } from '../src/persistence/project-settings-repository.js';
import { AuthStateStore } from '../src/runner/external/auth-session.js';
import type {
  ExternalBrowserOptions,
  ExternalBrowserOwner,
  RecordingBrowserSession,
  RecordingCallbacks,
  ReplayBrowserSession,
} from '../src/runner/recording/external-browser.js';
import { RecordingManager } from '../src/runner/recording/recording-manager.js';
import { BrowserOwnership } from '../src/runner/infrastructure/browser-ownership.js';
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

describe('recording event normalization', () => {
  it('bounds long target names before persisting a step', async () => {
    temporary = createTemporaryTestConfig();
    database = initializePersistence(temporary.config);
    const repository = new ProjectJourneyRepository(database.connection);
    const project = repository.createProject({
      name: 'Long element target',
      targetUrl: 'https://example.test',
      description: '',
    });
    const manager = new RecordingManager(
      temporary.config,
      repository,
      new BrowserOwnership(),
      new LongNameBrowserOwner(),
    );

    const started = await manager.start(project.id);
    const stopped = await manager.stop(started.id);

    expect(stopped.status).toBe('completed');
    expect(stopped.steps).toHaveLength(1);
    expect(stopped.steps[0]?.type).toBe('click');
    expect(stopped.steps[0]?.name).toHaveLength(160);
    expect(stopped.steps[0]?.name.startsWith('Click ')).toBe(true);
  });

  it('restores saved authentication when a recording starts', async () => {
    temporary = createTemporaryTestConfig();
    database = initializePersistence(temporary.config);
    const repository = new ProjectJourneyRepository(database.connection);
    const settings = new ProjectSettingsRepository(database.connection);
    const authStore = new AuthStateStore(
      temporary.config.artifactRoot,
      settings,
    );
    const project = repository.createProject({
      name: 'Authenticated recording',
      targetUrl: 'https://example.test/protected',
      description: '',
    });
    await authStore.save(project.id, {
      saveStorageState: (destination) => {
        mkdirSync(path.dirname(destination), { recursive: true });
        writeFileSync(
          destination,
          JSON.stringify({ cookies: [], origins: [] }),
        );
        return Promise.resolve();
      },
      close: () => Promise.resolve(),
    });
    const browserOwner = new CapturingBrowserOwner();
    const manager = new RecordingManager(
      temporary.config,
      repository,
      new BrowserOwnership(),
      browserOwner,
      authStore,
    );

    const started = await manager.start(project.id);

    expect(started.status).toBe('recording');
    expect(browserOwner.options?.storageStatePath).toBe(
      authStore.usablePath(project.id),
    );
    await manager.stop(started.id);
  });

  it('coalesces one field across pauses until another action occurs', async () => {
    temporary = createTemporaryTestConfig();
    database = initializePersistence(temporary.config);
    const repository = new ProjectJourneyRepository(database.connection);
    const project = repository.createProject({
      name: 'Paused typing',
      targetUrl: 'https://example.test/form',
      description: '',
    });
    const manager = new RecordingManager(
      temporary.config,
      repository,
      new BrowserOwnership(),
      new PausedTypingBrowserOwner(),
    );

    const started = await manager.start(project.id);
    const stopped = await manager.stop(started.id);

    expect(stopped.steps.map((step) => step.type)).toEqual([
      'fill',
      'click',
      'fill',
    ]);
    expect(stopped.steps[0]?.value).toEqual({
      kind: 'safe',
      value: 'test@tenant.com',
    });
    expect(stopped.steps[2]?.value).toEqual({
      kind: 'safe',
      value: 'corrected@tenant.com',
    });
  });
});

class LongNameBrowserOwner implements ExternalBrowserOwner {
  launchRecording(
    options: { readonly targetUrl: string },
    callbacks: RecordingCallbacks,
  ): Promise<RecordingBrowserSession> {
    callbacks.onEvent(
      {
        kind: 'click',
        timestamp: Date.now(),
        url: options.targetUrl,
        locator: { strategy: 'id', value: 'long-target' },
        fingerprint: {
          tagName: 'button',
          inputType: null,
          dataFormcrash: null,
          dataTestId: null,
          id: 'long-target',
          role: 'button',
          accessibleName: 'Long target '.repeat(30),
          name: null,
          label: null,
          text: 'Long target '.repeat(30),
          cssPath: '#long-target',
        },
        value: null,
        sensitive: false,
      },
      true,
    );
    return Promise.resolve({ close: () => Promise.resolve() });
  }

  launchReplay(): Promise<ReplayBrowserSession> {
    return Promise.reject(new Error('Not used.'));
  }
}

class CapturingBrowserOwner implements ExternalBrowserOwner {
  options: ExternalBrowserOptions | undefined;

  launchRecording(
    options: ExternalBrowserOptions,
  ): Promise<RecordingBrowserSession> {
    this.options = options;
    return Promise.resolve({ close: () => Promise.resolve() });
  }

  launchReplay(): Promise<ReplayBrowserSession> {
    return Promise.reject(new Error('Not used.'));
  }
}

class PausedTypingBrowserOwner implements ExternalBrowserOwner {
  launchRecording(
    options: ExternalBrowserOptions,
    callbacks: RecordingCallbacks,
  ): Promise<RecordingBrowserSession> {
    callbacks.onEvent(fillEvent(options.targetUrl, 1_000, 'test@te'), true);
    callbacks.onEvent(
      fillEvent(options.targetUrl, 10_000, 'test@tenant.com'),
      true,
    );
    callbacks.onEvent(
      {
        kind: 'click',
        timestamp: 11_000,
        url: options.targetUrl,
        locator: { strategy: 'id', value: 'continue' },
        fingerprint: fingerprint('button', 'continue', 'Continue'),
        value: null,
        sensitive: false,
      },
      true,
    );
    callbacks.onEvent(
      fillEvent(options.targetUrl, 20_000, 'corrected@tenant.com'),
      true,
    );
    return Promise.resolve({ close: () => Promise.resolve() });
  }

  launchReplay(): Promise<ReplayBrowserSession> {
    return Promise.reject(new Error('Not used.'));
  }
}

function fillEvent(url: string, timestamp: number, value: string) {
  return {
    kind: 'fill',
    timestamp,
    url,
    locator: { strategy: 'name', value: 'email' },
    fingerprint: fingerprint('input', 'email', 'Email'),
    value,
    sensitive: false,
  };
}

function fingerprint(tagName: string, name: string, accessibleName: string) {
  return {
    tagName,
    inputType: tagName === 'input' ? 'email' : null,
    dataFormcrash: null,
    dataTestId: null,
    id: null,
    role: tagName === 'button' ? 'button' : 'textbox',
    accessibleName,
    name,
    label: accessibleName,
    text: tagName === 'button' ? accessibleName : null,
    cssPath: tagName,
  };
}
