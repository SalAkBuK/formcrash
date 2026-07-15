import type { SampleApplicationState } from '../sample/types.js';

export interface OrderRequestStartedObservation {
  readonly kind: 'started';
  readonly requestId: string;
  readonly method: 'POST';
  readonly path: '/api/orders';
  readonly startedAtMs: number;
}

export interface OrderRequestCompletedObservation {
  readonly kind: 'completed';
  readonly requestId: string;
  readonly completedAtMs: number;
  readonly statusCode: number | null;
  readonly failed: boolean;
}

export type OrderRequestObservation =
  OrderRequestStartedObservation | OrderRequestCompletedObservation;

export interface BrowserLaunchOptions {
  readonly baseUrl: string;
  readonly headless: boolean;
  readonly timeoutMs: number;
}

export interface CheckoutBrowserSession {
  observeOrderRequests(
    observer: (observation: OrderRequestObservation) => void,
  ): void;
  navigate(url: string): Promise<void>;
  click(
    selector: string,
    options?: { readonly force?: boolean },
  ): Promise<void>;
  fill(selector: string, value: string): Promise<void>;
  waitForVisible(selector: string): Promise<void>;
  resetSampleState(): Promise<void>;
  readSampleState(): Promise<SampleApplicationState>;
  pendingOrderRequestCount(): number;
  close(): Promise<void>;
}

export interface BrowserOwner {
  launch(options: BrowserLaunchOptions): Promise<CheckoutBrowserSession>;
}
