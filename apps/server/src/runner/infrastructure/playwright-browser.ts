import type { Browser, BrowserContext, Page, Request } from 'playwright';
import { chromium } from 'playwright';

import { parseSampleApplicationState } from '../evidence/sample-state.js';
import type { SampleApplicationState } from '../sample/types.js';
import type {
  BrowserLaunchOptions,
  BrowserOwner,
  CheckoutBrowserSession,
  OrderRequestObservation,
} from './browser-session.js';

interface ActiveRequest {
  readonly requestId: string;
  readonly startedAtMs: number;
}

export function isSampleOrderRequest(method: string, url: string): boolean {
  if (method !== 'POST') return false;

  try {
    return new URL(url).pathname === '/api/orders';
  } catch {
    return false;
  }
}

class PlaywrightCheckoutSession implements CheckoutBrowserSession {
  private readonly activeRequests = new Map<Request, ActiveRequest>();
  private observer: ((observation: OrderRequestObservation) => void) | null =
    null;
  private requestSequence = 0;
  private closed = false;

  constructor(
    private readonly browser: Browser,
    private readonly context: BrowserContext,
    private readonly page: Page,
    private readonly baseUrl: string,
    private readonly timeoutMs: number,
  ) {
    page.setDefaultTimeout(timeoutMs);
    page.setDefaultNavigationTimeout(timeoutMs);
    page.on('request', (request) => this.onRequestStarted(request));
    page.on('response', (response) => {
      const request = response.request();
      const active = this.activeRequests.get(request);
      if (active === undefined) return;
      this.activeRequests.delete(request);
      this.observer?.({
        kind: 'completed',
        requestId: active.requestId,
        completedAtMs: Math.max(active.startedAtMs, Date.now()),
        statusCode: response.status(),
        failed: false,
      });
    });
    page.on('requestfailed', (request) => {
      const active = this.activeRequests.get(request);
      if (active === undefined) return;
      this.activeRequests.delete(request);
      this.observer?.({
        kind: 'completed',
        requestId: active.requestId,
        completedAtMs: Math.max(active.startedAtMs, Date.now()),
        statusCode: null,
        failed: true,
      });
    });
  }

  observeOrderRequests(
    observer: (observation: OrderRequestObservation) => void,
  ): void {
    this.observer = observer;
  }

  async navigate(url: string): Promise<void> {
    await this.page.goto(url, { waitUntil: 'domcontentloaded' });
  }

  async click(
    selector: string,
    options: { readonly force?: boolean } = {},
  ): Promise<void> {
    await this.page.locator(this.toSelector(selector)).click({
      force: options.force ?? false,
      timeout: this.timeoutMs,
    });
  }

  async fill(selector: string, value: string): Promise<void> {
    await this.page.locator(this.toSelector(selector)).fill(value, {
      timeout: this.timeoutMs,
    });
  }

  async waitForVisible(selector: string): Promise<void> {
    await this.page
      .locator(this.toSelector(selector))
      .waitFor({ state: 'visible', timeout: this.timeoutMs });
  }

  async resetSampleState(): Promise<void> {
    const response = await this.context.request.post(
      new URL('/api/test-support/reset', this.baseUrl).toString(),
      { timeout: this.timeoutMs },
    );
    if (!response.ok()) {
      throw new Error(`Sample reset failed with HTTP ${response.status()}.`);
    }
  }

  async readSampleState(): Promise<SampleApplicationState> {
    const response = await this.context.request.get(
      new URL('/api/test-support/state', this.baseUrl).toString(),
      { timeout: this.timeoutMs },
    );
    if (!response.ok()) {
      throw new Error(
        `Sample state read failed with HTTP ${response.status()}.`,
      );
    }
    return parseSampleApplicationState(await response.json());
  }

  pendingOrderRequestCount(): number {
    return this.activeRequests.size;
  }

  async close(): Promise<void> {
    if (this.closed) return;
    this.closed = true;

    let contextError: Error | undefined;
    let browserError: Error | undefined;
    try {
      await this.context.close();
    } catch (error: unknown) {
      contextError = normalizeCleanupError(
        error,
        'The browser context could not be closed.',
      );
    }

    try {
      await this.browser.close();
    } catch (error: unknown) {
      browserError = normalizeCleanupError(
        error,
        'The Chromium browser could not be closed.',
      );
    }

    if (contextError !== undefined && browserError !== undefined) {
      throw new AggregateError(
        [contextError, browserError],
        'The browser context and Chromium browser could not be closed.',
      );
    }
    if (contextError !== undefined) throw contextError;
    if (browserError !== undefined) throw browserError;
  }

  private onRequestStarted(request: Request): void {
    if (!isSampleOrderRequest(request.method(), request.url())) return;
    this.requestSequence += 1;
    const requestId = `browser-request-${String(this.requestSequence).padStart(4, '0')}`;
    const startedAtMs = Date.now();
    this.activeRequests.set(request, { requestId, startedAtMs });
    this.observer?.({
      kind: 'started',
      requestId,
      method: 'POST',
      path: '/api/orders',
      startedAtMs,
    });
  }

  private toSelector(value: string): string {
    return `[data-formcrash="${value}"]`;
  }
}

function normalizeCleanupError(error: unknown, fallback: string): Error {
  return error instanceof Error ? error : new Error(fallback);
}

export class PlaywrightBrowserOwner implements BrowserOwner {
  async launch(options: BrowserLaunchOptions): Promise<CheckoutBrowserSession> {
    const browser = await chromium.launch({ headless: options.headless });

    try {
      const context = await browser.newContext();
      const page = await context.newPage();
      return new PlaywrightCheckoutSession(
        browser,
        context,
        page,
        options.baseUrl,
        options.timeoutMs,
      );
    } catch (error: unknown) {
      await browser.close();
      throw error;
    }
  }
}
