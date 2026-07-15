import type { CheckoutMode, OrderRequest } from '../src/checkout/domain/models';

export function buildOrderRequest(
  mode: CheckoutMode,
  checkoutAttemptKey = 'checkout-attempt-1',
): OrderRequest {
  return {
    mode,
    checkoutAttemptKey,
    contact: {
      name: 'Ava Example',
      email: 'ava@example.test',
    },
    shipping: {
      addressLine1: '42 Test Lane',
      city: 'Demo City',
      region: 'Test Region',
      postalCode: '00042',
    },
    products: [
      { productId: 'resilience-mug', quantity: 1 },
      { productId: 'retry-notebook', quantity: 1 },
    ],
  };
}
