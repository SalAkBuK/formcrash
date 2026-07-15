import { describe, expect, it } from 'vitest';

import { evaluateMaxCreatedOrders } from '../src/runner/assertions/max-created-orders.js';

describe('maximum-created-orders assertion', () => {
  it('passes when one order exists', () => {
    expect(evaluateMaxCreatedOrders(1)).toMatchObject({
      observedCount: 1,
      status: 'passed',
    });
  });

  it('fails when two orders exist', () => {
    expect(evaluateMaxCreatedOrders(2)).toMatchObject({
      observedCount: 2,
      status: 'failed',
    });
  });
});
