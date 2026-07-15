import { describe, expect, it } from 'vitest';
import path from 'node:path';

import { loadConfig } from '../src/app/config.js';

describe('runner configuration', () => {
  it('parses the headless override and target URL', () => {
    expect(
      loadConfig({
        FORMCRASH_BROWSER_HEADLESS: 'true',
        FORMCRASH_BROWSER_TIMEOUT_MS: '5000',
        SAMPLE_CHECKOUT_BASE_URL: 'http://127.0.0.1:4210',
      }),
    ).toMatchObject({
      browserHeadless: true,
      browserTimeoutMs: 5_000,
      sampleCheckoutBaseUrl: 'http://127.0.0.1:4210',
    });
  });

  it('rejects unvalidated boolean values', () => {
    expect(() =>
      loadConfig({ FORMCRASH_BROWSER_HEADLESS: 'sometimes' }),
    ).toThrow('Invalid server configuration');
  });

  it('resolves relative storage paths from the repository root', () => {
    const config = loadConfig({
      FORMCRASH_DATABASE_PATH: './var/database/test.db',
      FORMCRASH_ARTIFACT_ROOT: './var',
    });

    expect(path.isAbsolute(config.databasePath)).toBe(true);
    expect(path.isAbsolute(config.artifactRoot)).toBe(true);
    expect(config.databasePath).toMatch(
      /formcrash[\\/]var[\\/]database[\\/]test\.db$/u,
    );
  });
});
