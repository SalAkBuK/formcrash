import { describe, expect, it } from 'vitest';

import { isSampleOrderRequest } from '../src/runner/infrastructure/playwright-browser.js';

describe('browser request evidence filter', () => {
  it('accepts only POST requests to the sample order endpoint', () => {
    expect(
      isSampleOrderRequest('POST', 'http://localhost:4200/api/orders'),
    ).toBe(true);
    expect(
      isSampleOrderRequest('GET', 'http://localhost:4200/api/orders'),
    ).toBe(false);
    expect(
      isSampleOrderRequest(
        'POST',
        'http://localhost:4200/api/test-support/reset',
      ),
    ).toBe(false);
    expect(isSampleOrderRequest('POST', 'not-a-url')).toBe(false);
  });
});
