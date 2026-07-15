import { beforeEach, describe, expect, it } from 'vitest';

import { PRODUCTS } from '../src/checkout/domain/catalog';
import { getSampleCheckoutStore } from '../src/checkout/server/store';
import { buildOrderRequest } from './fixtures';

const store = getSampleCheckoutStore();

beforeEach(() => {
  store.reset();
});

describe('deterministic sample catalogue', () => {
  it('contains exactly the two locked fictional products', () => {
    expect(PRODUCTS.map((product) => product.id)).toEqual([
      'resilience-mug',
      'retry-notebook',
    ]);
  });
});

describe('vulnerable order creation', () => {
  it('creates an order for a valid request', async () => {
    const result = await store.createVulnerableOrder(
      buildOrderRequest('vulnerable'),
    );

    expect(result.operation).toBe('created');
    expect(store.getState().orders).toHaveLength(1);
  });

  it('creates two orders for sequential requests with the same key', async () => {
    const request = buildOrderRequest('vulnerable');

    const first = await store.createVulnerableOrder(request);
    const second = await store.createVulnerableOrder(request);

    expect(first.order.id).not.toBe(second.order.id);
    expect(store.getState().orders).toHaveLength(2);
  });

  it('creates two orders for concurrent requests with the same key', async () => {
    const request = buildOrderRequest('vulnerable');

    const results = await Promise.all([
      store.createVulnerableOrder(request),
      store.createVulnerableOrder(request),
    ]);

    expect(new Set(results.map((result) => result.order.id)).size).toBe(2);
    expect(store.getState().counts).toMatchObject({ requests: 2, orders: 2 });
  });
});

describe('fixed order creation', () => {
  it('creates an order for a valid request', async () => {
    const result = await store.createOrRetrieveFixedOrder(
      buildOrderRequest('fixed'),
    );

    expect(result.operation).toBe('created');
    expect(store.getState().orders).toHaveLength(1);
  });

  it('deduplicates sequential requests and returns the original order ID', async () => {
    const request = buildOrderRequest('fixed');

    const first = await store.createOrRetrieveFixedOrder(request);
    const second = await store.createOrRetrieveFixedOrder(request);

    expect(second.operation).toBe('deduplicated');
    expect(second.order.id).toBe(first.order.id);
    expect(store.getState().orders).toHaveLength(1);
  });

  it('deduplicates truly concurrent requests', async () => {
    const request = buildOrderRequest('fixed');

    const results = await Promise.all([
      store.createOrRetrieveFixedOrder(request),
      store.createOrRetrieveFixedOrder(request),
    ]);

    expect(new Set(results.map((result) => result.order.id)).size).toBe(1);
    expect(store.getState().orders).toHaveLength(1);
  });

  it('records accepted and deduplicated attempts separately', async () => {
    const request = buildOrderRequest('fixed');

    await Promise.all([
      store.createOrRetrieveFixedOrder(request),
      store.createOrRetrieveFixedOrder(request),
    ]);

    expect(
      store.getState().requestAttempts.map((attempt) => attempt.outcome),
    ).toEqual(['accepted', 'deduplicated']);
  });

  it('creates different orders for different attempt keys', async () => {
    const [first, second] = await Promise.all([
      store.createOrRetrieveFixedOrder(buildOrderRequest('fixed', 'key-1')),
      store.createOrRetrieveFixedOrder(buildOrderRequest('fixed', 'key-2')),
    ]);

    expect(first.order.id).not.toBe(second.order.id);
    expect(store.getState().orders).toHaveLength(2);
  });
});

describe('sample store reset', () => {
  it('clears orders, attempts, and fixed idempotency results', async () => {
    const request = buildOrderRequest('fixed');
    const original = await store.createOrRetrieveFixedOrder(request);

    expect(store.reset()).toEqual({
      orders: [],
      requestAttempts: [],
      counts: {
        orders: 0,
        requests: 0,
        accepted: 0,
        deduplicated: 0,
        rejected: 0,
      },
    });

    const afterReset = await store.createOrRetrieveFixedOrder(request);
    expect(afterReset.operation).toBe('created');
    expect(afterReset.attempt.outcome).toBe('accepted');
    expect(afterReset.order.id).toBe(original.order.id);
  });
});
