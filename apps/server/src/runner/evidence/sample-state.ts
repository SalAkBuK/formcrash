import { z } from 'zod';

import type { SampleApplicationState } from '../sample/types.js';

const stateResponseSchema = z.object({
  data: z.object({
    orders: z.array(z.object({ id: z.string().min(1) }).passthrough()),
    requestAttempts: z.array(z.unknown()),
    counts: z.object({
      orders: z.number().int().nonnegative(),
      requests: z.number().int().nonnegative(),
      accepted: z.number().int().nonnegative(),
      deduplicated: z.number().int().nonnegative(),
      rejected: z.number().int().nonnegative(),
    }),
  }),
});

export function parseSampleApplicationState(
  body: unknown,
): SampleApplicationState {
  const parsed = stateResponseSchema.safeParse(body);
  if (!parsed.success) {
    throw new Error('Sample checkout returned an invalid test-state response.');
  }

  return {
    counts: parsed.data.data.counts,
    orders: parsed.data.data.orders.map((order) => ({ id: order.id })),
  };
}
