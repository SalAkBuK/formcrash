import { beforeEach, describe, expect, it } from 'vitest';

import { POST as createOrder } from '../src/app/api/orders/route';
import { POST as resetState } from '../src/app/api/test-support/reset/route';
import { GET as readState } from '../src/app/api/test-support/state/route';
import type {
  ApiErrorResponse,
  OrderSuccessResponse,
  StateResponse,
} from '../src/checkout/domain/models';
import { buildOrderRequest } from './fixtures';

function postOrder(body: unknown): Promise<Response> {
  return createOrder(
    new Request('http://localhost:4200/api/orders', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    }),
  );
}

beforeEach(() => {
  resetState();
});

describe('POST /api/orders', () => {
  it('creates separate orders for concurrent vulnerable requests', async () => {
    const request = buildOrderRequest('vulnerable');

    const responses = await Promise.all([
      postOrder(request),
      postOrder(request),
    ]);
    const payloads = await Promise.all(
      responses.map(
        async (response) => (await response.json()) as OrderSuccessResponse,
      ),
    );
    const state = (await readState().json()) as StateResponse;

    expect(responses.map((response) => response.status)).toEqual([201, 201]);
    expect(new Set(payloads.map((payload) => payload.data.order.id)).size).toBe(
      2,
    );
    expect(state.data.counts).toMatchObject({ requests: 2, orders: 2 });
  });

  it('returns 201 for a newly created order and 200 for a fixed duplicate', async () => {
    const request = buildOrderRequest('fixed');

    const [first, second] = await Promise.all([
      postOrder(request),
      postOrder(request),
    ]);
    const firstBody = (await first.json()) as OrderSuccessResponse;
    const secondBody = (await second.json()) as OrderSuccessResponse;
    const responses = [
      { status: first.status, body: firstBody },
      { status: second.status, body: secondBody },
    ].sort((left, right) => right.status - left.status);

    expect(responses.map((response) => response.status)).toEqual([201, 200]);
    expect(responses[0]?.body.data.order.id).toBe(
      responses[1]?.body.data.order.id,
    );
  });

  it.each([
    ['invalid mode', { ...buildOrderRequest('fixed'), mode: 'unsafe' }],
    [
      'unknown product',
      {
        ...buildOrderRequest('fixed'),
        products: [{ productId: 'mystery-product', quantity: 1 }],
      },
    ],
    [
      'invalid quantity',
      {
        ...buildOrderRequest('fixed'),
        products: [{ productId: 'resilience-mug', quantity: 0 }],
      },
    ],
  ])('rejects an %s with a structured response', async (_label, body) => {
    const response = await postOrder(body);
    const payload = (await response.json()) as ApiErrorResponse;

    expect(response.status).toBe(400);
    expect(payload.error.code).toBe('INVALID_ORDER_REQUEST');
    expect(payload.error.issues?.length).toBeGreaterThan(0);
  });

  it('calculates totals from the catalogue and ignores client totals', async () => {
    const response = await postOrder({
      ...buildOrderRequest('vulnerable'),
      subtotalCents: 1,
      products: [
        {
          productId: 'resilience-mug',
          quantity: 2,
          unitPriceCents: 1,
        },
        {
          productId: 'retry-notebook',
          quantity: 1,
          unitPriceCents: 1,
        },
      ],
    });
    const payload = (await response.json()) as OrderSuccessResponse;

    expect(response.status).toBe(201);
    expect(payload.data.order.subtotalCents).toBe(4850);
    expect(
      payload.data.order.products.map((product) => product.unitPriceCents),
    ).toEqual([1800, 1250]);
  });

  it('records rejected requests as attempts', async () => {
    await postOrder({ ...buildOrderRequest('fixed'), mode: 'invalid' });
    const state = (await readState().json()) as StateResponse;

    expect(state.data.counts).toMatchObject({
      requests: 1,
      rejected: 1,
      orders: 0,
    });
    expect(state.data.requestAttempts[0]?.outcome).toBe('rejected');
  });
});

describe('test-support routes', () => {
  it('reads state and resets all current evidence', async () => {
    await postOrder(buildOrderRequest('vulnerable'));
    expect(
      ((await readState().json()) as StateResponse).data.counts.orders,
    ).toBe(1);

    const resetResponse = resetState();
    const resetBody = (await resetResponse.json()) as StateResponse;

    expect(resetResponse.status).toBe(200);
    expect(resetBody.data.counts).toEqual({
      orders: 0,
      requests: 0,
      accepted: 0,
      deduplicated: 0,
      rejected: 0,
    });
  });
});
