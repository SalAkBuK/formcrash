import { getProduct } from '../domain/catalog';
import type {
  CheckoutMode,
  Order,
  OrderRequest,
  OrderSubmissionResult,
  RequestAttempt,
  SampleCheckoutState,
} from '../domain/models';

const PROCESSING_DELAY_MS = 80;

function waitForProcessing(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, PROCESSING_DELAY_MS));
}

export class SampleStoreResetError extends Error {
  constructor() {
    super('Sample data was reset while the order was being processed.');
    this.name = 'SampleStoreResetError';
  }
}

class SampleCheckoutStore {
  private readonly orders: Order[] = [];
  private readonly requestAttempts: RequestAttempt[] = [];
  private readonly fixedResults = new Map<string, Order>();
  private readonly fixedInFlight = new Map<string, Promise<Order>>();
  private orderSequence = 0;
  private attemptSequence = 0;
  private generation = 0;

  async createVulnerableOrder(
    request: OrderRequest,
  ): Promise<OrderSubmissionResult> {
    const generation = this.generation;
    const order = this.buildOrder(request);
    const attempt = this.recordAttempt({
      checkoutAttemptKey: request.checkoutAttemptKey,
      mode: request.mode,
      outcome: 'accepted',
      resultingOrderId: order.id,
    });

    await waitForProcessing();
    this.assertGeneration(generation);
    this.orders.push(order);

    return { operation: 'created', order, attempt };
  }

  async createOrRetrieveFixedOrder(
    request: OrderRequest,
  ): Promise<OrderSubmissionResult> {
    const existingOrder = this.fixedResults.get(request.checkoutAttemptKey);

    if (existingOrder !== undefined) {
      return {
        operation: 'deduplicated',
        order: existingOrder,
        attempt: this.recordAttempt({
          checkoutAttemptKey: request.checkoutAttemptKey,
          mode: request.mode,
          outcome: 'deduplicated',
          resultingOrderId: existingOrder.id,
        }),
      };
    }

    const activeCreation = this.fixedInFlight.get(request.checkoutAttemptKey);

    if (activeCreation !== undefined) {
      const order = await activeCreation;
      return {
        operation: 'deduplicated',
        order,
        attempt: this.recordAttempt({
          checkoutAttemptKey: request.checkoutAttemptKey,
          mode: request.mode,
          outcome: 'deduplicated',
          resultingOrderId: order.id,
        }),
      };
    }

    const generation = this.generation;
    const order = this.buildOrder(request);
    const attempt = this.recordAttempt({
      checkoutAttemptKey: request.checkoutAttemptKey,
      mode: request.mode,
      outcome: 'accepted',
      resultingOrderId: order.id,
    });
    const creation = this.completeFixedOrder(
      request.checkoutAttemptKey,
      order,
      generation,
    );
    this.fixedInFlight.set(request.checkoutAttemptKey, creation);

    try {
      const createdOrder = await creation;
      return { operation: 'created', order: createdOrder, attempt };
    } finally {
      if (this.fixedInFlight.get(request.checkoutAttemptKey) === creation) {
        this.fixedInFlight.delete(request.checkoutAttemptKey);
      }
    }
  }

  recordRejectedRequest(input: {
    readonly checkoutAttemptKey: string | null;
    readonly mode: CheckoutMode | null;
  }): RequestAttempt {
    return this.recordAttempt({
      ...input,
      outcome: 'rejected',
      resultingOrderId: null,
    });
  }

  getState(): SampleCheckoutState {
    const accepted = this.requestAttempts.filter(
      (attempt) => attempt.outcome === 'accepted',
    ).length;
    const deduplicated = this.requestAttempts.filter(
      (attempt) => attempt.outcome === 'deduplicated',
    ).length;
    const rejected = this.requestAttempts.filter(
      (attempt) => attempt.outcome === 'rejected',
    ).length;

    return {
      orders: structuredClone(this.orders),
      requestAttempts: structuredClone(this.requestAttempts),
      counts: {
        orders: this.orders.length,
        requests: this.requestAttempts.length,
        accepted,
        deduplicated,
        rejected,
      },
    };
  }

  reset(): SampleCheckoutState {
    this.generation += 1;
    this.orders.length = 0;
    this.requestAttempts.length = 0;
    this.fixedResults.clear();
    this.fixedInFlight.clear();
    this.orderSequence = 0;
    this.attemptSequence = 0;
    return this.getState();
  }

  private async completeFixedOrder(
    checkoutAttemptKey: string,
    order: Order,
    generation: number,
  ): Promise<Order> {
    await waitForProcessing();
    this.assertGeneration(generation);
    this.orders.push(order);
    this.fixedResults.set(checkoutAttemptKey, order);
    return order;
  }

  private buildOrder(request: OrderRequest): Order {
    this.orderSequence += 1;
    const products = request.products.map(({ productId, quantity }) => {
      const product = getProduct(productId);
      return {
        productId,
        name: product.name,
        quantity,
        unitPriceCents: product.unitPriceCents,
        lineTotalCents: product.unitPriceCents * quantity,
      };
    });

    return {
      id: `order-${String(this.orderSequence).padStart(4, '0')}`,
      checkoutAttemptKey: request.checkoutAttemptKey,
      mode: request.mode,
      contact: structuredClone(request.contact),
      shipping: structuredClone(request.shipping),
      products,
      subtotalCents: products.reduce(
        (total, product) => total + product.lineTotalCents,
        0,
      ),
      currency: 'USD',
      createdAt: new Date().toISOString(),
    };
  }

  private recordAttempt(
    input: Omit<RequestAttempt, 'id' | 'receivedAt'>,
  ): RequestAttempt {
    this.attemptSequence += 1;
    const attempt: RequestAttempt = {
      id: `attempt-${String(this.attemptSequence).padStart(4, '0')}`,
      receivedAt: new Date().toISOString(),
      ...input,
    };
    this.requestAttempts.push(attempt);
    return structuredClone(attempt);
  }

  private assertGeneration(generation: number): void {
    if (generation !== this.generation) {
      throw new SampleStoreResetError();
    }
  }
}

const globalStore = globalThis as typeof globalThis & {
  formcrashSampleCheckoutStore?: SampleCheckoutStore;
};

export function getSampleCheckoutStore(): SampleCheckoutStore {
  globalStore.formcrashSampleCheckoutStore ??= new SampleCheckoutStore();
  return globalStore.formcrashSampleCheckoutStore;
}
