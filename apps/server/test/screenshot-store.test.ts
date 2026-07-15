import { existsSync, writeFileSync } from 'node:fs';
import path from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { ScreenshotStore } from '../src/artifacts/screenshot-store.js';
import { initializePersistence } from '../src/persistence/initialize.js';
import {
  RunPersistenceError,
  RunRepository,
} from '../src/persistence/run-repository.js';
import type { CheckoutBrowserSession } from '../src/runner/infrastructure/browser-session.js';
import type { SampleApplicationState } from '../src/runner/sample/types.js';
import { createTemporaryTestConfig } from './fixtures.js';

const cleanups: Array<() => void> = [];

afterEach(() => {
  for (const cleanup of cleanups.splice(0)) cleanup();
});

describe('screenshot artifact storage', () => {
  it('rejects paths outside the configured artifact root', () => {
    const temporary = createTemporaryTestConfig();
    cleanups.push(temporary.cleanup);
    const database = initializePersistence(temporary.config);
    const store = new ScreenshotStore(
      temporary.config.artifactRoot,
      new RunRepository(database.connection),
    );

    expect(() => store.resolve('../outside.png')).toThrow(
      'escapes the configured root',
    );
    expect(() => store.resolve(path.resolve('absolute.png'))).toThrow(
      'must be relative',
    );
    database.close();
  });

  it('removes the screenshot if metadata persistence fails', async () => {
    const temporary = createTemporaryTestConfig();
    cleanups.push(temporary.cleanup);
    const database = initializePersistence(temporary.config);
    const store = new ScreenshotStore(
      temporary.config.artifactRoot,
      new RunRepository(database.connection),
    );
    const expectedPath = store.resolve(
      'screenshots/missing-run/001-before-disruption.png',
    );

    await expect(
      store.capture(
        new FileWritingSession(),
        'missing-run',
        'before-disruption',
      ),
    ).rejects.toBeInstanceOf(RunPersistenceError);
    expect(existsSync(expectedPath)).toBe(false);
    database.close();
  });
});

class FileWritingSession implements CheckoutBrowserSession {
  observeOrderRequests(): void {}
  navigate(): Promise<void> {
    return Promise.resolve();
  }
  click(): Promise<void> {
    return Promise.resolve();
  }
  fill(): Promise<void> {
    return Promise.resolve();
  }
  waitForVisible(): Promise<void> {
    return Promise.resolve();
  }
  captureScreenshot(destination: string): Promise<void> {
    writeFileSync(destination, Buffer.from([137, 80, 78, 71]));
    return Promise.resolve();
  }
  resetSampleState(): Promise<void> {
    return Promise.resolve();
  }
  readSampleState(): Promise<SampleApplicationState> {
    return Promise.reject(new Error('Not used by this test.'));
  }
  pendingOrderRequestCount(): number {
    return 0;
  }
  close(): Promise<void> {
    return Promise.resolve();
  }
}
