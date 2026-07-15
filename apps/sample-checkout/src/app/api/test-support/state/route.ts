import type { StateResponse } from '../../../../checkout/domain/models';
import { getSampleCheckoutStore } from '../../../../checkout/server/store';

export const runtime = 'nodejs';

export function GET(): Response {
  const response: StateResponse = {
    data: getSampleCheckoutStore().getState(),
  };
  return Response.json(response);
}
