import { describe, expect, it } from 'vitest';

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
});
