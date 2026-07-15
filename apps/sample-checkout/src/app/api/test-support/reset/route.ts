import type { StateResponse } from '../../../../checkout/domain/models';
import { getSampleCheckoutStore } from '../../../../checkout/server/store';

export const runtime = 'nodejs';

export function POST(): Response {
  const response: StateResponse = {
    data: getSampleCheckoutStore().reset(),
  };
  return Response.json(response);
}
