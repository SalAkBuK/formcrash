import { readFileSync, writeFileSync } from 'node:fs';

import { afterEach, describe, expect, it } from 'vitest';
import { hybridTraceManifestSchema } from '@formcrash/contracts';

import { JourneyTraceStore } from '../src/artifacts/journey-trace-store.js';
import { initializePersistence } from '../src/persistence/initialize.js';
import { ProjectJourneyRepository } from '../src/persistence/project-journey-repository.js';
import type { FormCrashDatabase } from '../src/persistence/database.js';
import {
  createTemporaryTestConfig,
  type TemporaryTestConfig,
} from './fixtures.js';

let temporary: TemporaryTestConfig | null = null;
let database: FormCrashDatabase | null = null;

afterEach(() => {
  database?.close();
  database = null;
  temporary?.cleanup();
  temporary = null;
});

describe('hybrid journey trace artifacts', () => {
  it('persists an immutable checksummed bundle and fails closed after corruption', () => {
    temporary = createTemporaryTestConfig();
    const initialized = initializePersistence(temporary.config);
    database = initialized;
    const repository = new ProjectJourneyRepository(initialized.connection);
    const project = repository.createProject({
      name: 'Trace fixture',
      targetUrl: 'http://127.0.0.1:4811',
      description: '',
    });
    const session = repository.createRecordingSession(project.id);
    const store = new JourneyTraceStore(
      temporary.config.artifactRoot,
      repository,
    );
    const manifest = hybridTraceManifestSchema.parse({
      formatVersion: 2,
      environment: {
        viewportWidth: 1440,
        viewportHeight: 900,
        deviceScaleFactor: 1,
        locale: 'en-US',
        timezoneId: 'UTC',
        userAgent: 'trace-test',
        colorScheme: 'light',
        browserName: 'chromium',
        browserVersion: 'test',
      },
      interactions: [],
      eventCount: 1,
      pageCount: 1,
      frameCount: 1,
      redactionVersion: 1,
      videoCaptured: false,
      truncated: false,
    });
    const record = store.persist(session.id, manifest, [
      {
        kind: 'keyboard',
        key: '[REDACTED_CHARACTER]',
        code: '[REDACTED_CODE]',
      },
    ]);

    expect(store.assertIntegrity(record)).toEqual(manifest);
    expect(() =>
      initialized.connection
        .prepare('UPDATE recording_traces SET size_bytes = size_bytes + 1')
        .run(),
    ).toThrow('recording traces are immutable');

    const path = store.resolve(record.relativePath);
    const bytes = readFileSync(path);
    writeFileSync(path, Buffer.concat([bytes, Buffer.from('corrupt')]));
    expect(() => store.assertIntegrity(record)).toThrow(
      'Journey trace checksum verification failed.',
    );
  });
});
