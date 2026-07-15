import type { ProductId } from './catalog';

export const CHECKOUT_MODES = ['vulnerable', 'fixed'] as const;
export type CheckoutMode = (typeof CHECKOUT_MODES)[number];

export interface ContactInformation {
  readonly name: string;
  readonly email: string;
}

export interface ShippingInformation {
  readonly addressLine1: string;
  readonly city: string;
  readonly region: string;
  readonly postalCode: string;
}

export interface RequestedProduct {
  readonly productId: ProductId;
  readonly quantity: number;
}

export interface OrderRequest {
  readonly mode: CheckoutMode;
  readonly checkoutAttemptKey: string;
  readonly contact: ContactInformation;
  readonly shipping: ShippingInformation;
  readonly products: readonly RequestedProduct[];
}

export interface OrderedProduct {
  readonly productId: ProductId;
  readonly name: string;
  readonly quantity: number;
  readonly unitPriceCents: number;
  readonly lineTotalCents: number;
}

export interface Order {
  readonly id: string;
  readonly checkoutAttemptKey: string;
  readonly mode: CheckoutMode;
  readonly contact: ContactInformation;
  readonly shipping: ShippingInformation;
  readonly products: readonly OrderedProduct[];
  readonly subtotalCents: number;
  readonly currency: 'USD';
  readonly createdAt: string;
}

export type RequestAttemptOutcome = 'accepted' | 'deduplicated' | 'rejected';

export interface RequestAttempt {
  readonly id: string;
  readonly checkoutAttemptKey: string | null;
  readonly mode: CheckoutMode | null;
  readonly receivedAt: string;
  readonly outcome: RequestAttemptOutcome;
  readonly resultingOrderId: string | null;
}

export interface StoreCounts {
  readonly orders: number;
  readonly requests: number;
  readonly accepted: number;
  readonly deduplicated: number;
  readonly rejected: number;
}

export interface SampleCheckoutState {
  readonly orders: readonly Order[];
  readonly requestAttempts: readonly RequestAttempt[];
  readonly counts: StoreCounts;
}

export interface OrderSubmissionResult {
  readonly operation: 'created' | 'deduplicated';
  readonly order: Order;
  readonly attempt: RequestAttempt;
}

export interface OrderSuccessResponse {
  readonly data: OrderSubmissionResult;
}

export interface StateResponse {
  readonly data: SampleCheckoutState;
}

export interface ApiErrorResponse {
  readonly error: {
    readonly code: 'INVALID_ORDER_REQUEST' | 'STORE_RESET' | 'INTERNAL_ERROR';
    readonly message: string;
    readonly issues?: readonly {
      readonly path: string;
      readonly message: string;
    }[];
  };
}
