import type { OrderRequest, OrderSubmissionResult } from '../domain/models';
import { getSampleCheckoutStore } from './store';

export async function submitOrder(
  request: OrderRequest,
): Promise<OrderSubmissionResult> {
  const store = getSampleCheckoutStore();

  return request.mode === 'vulnerable'
    ? store.createVulnerableOrder(request)
    : store.createOrRetrieveFixedOrder(request);
}
