import type { Browser, BrowserContext, Frame, Page, Request } from 'playwright';
import { chromium } from 'playwright';

import type { ReplayLocator, TargetFingerprint } from '@formcrash/contracts';

export interface RawRecordingEvent {
  readonly kind: 'click' | 'fill' | 'checkbox' | 'radio' | 'select' | 'submit';
  readonly timestamp: number;
  readonly url: string;
  readonly locator: ReplayLocator;
  readonly fingerprint: TargetFingerprint;
  readonly value: string | null;
  readonly sensitive: boolean;
}

export interface RawNavigationEvent {
  readonly kind: 'navigate';
  readonly timestamp: number;
  readonly url: string;
}

export interface RawRecordingWarning {
  readonly code:
    | 'new_tab'
    | 'iframe'
    | 'file_upload'
    | 'captcha'
    | 'third_party_payment'
    | 'drag_and_drop'
    | 'contenteditable'
    | 'shadow_dom';
  readonly message: string;
  readonly timestamp: number;
  readonly url: string;
}

export interface ExternalBrowserOptions {
  readonly targetUrl: string;
  readonly headless: boolean;
  readonly timeoutMs: number;
  readonly storageStatePath?: string;
}

export interface RecordingCallbacks {
  readonly onEvent: (event: unknown, topFrame: boolean) => void;
  readonly onWarning: (warning: unknown, topFrame: boolean) => void;
  readonly onNavigation: (url: string, timestamp: number) => void;
}

export interface RecordingBrowserSession {
  close(): Promise<void>;
}

export interface ReplayBrowserSession {
  navigate(url: string): Promise<void>;
  click(locator: ReplayLocator): Promise<void>;
  fill(locator: ReplayLocator, value: string): Promise<void>;
  setChecked(locator: ReplayLocator, checked: boolean): Promise<void>;
  select(locator: ReplayLocator, value: string): Promise<void>;
  submit(locator: ReplayLocator): Promise<void>;
  triggerRepeated(
    locator: ReplayLocator,
    type: 'click' | 'submit',
    count: 2 | 3,
    intervalMs: 0 | 100 | 300,
    onAttempt: (attempt: number) => void,
  ): Promise<void>;
  observeNetwork(observer: (observation: NetworkObservation) => void): void;
  captureScreenshot(destination: string): Promise<void>;
  setScreenshotMasks(locators: readonly ReplayLocator[]): void;
  isVisible(locator: ReplayLocator): Promise<boolean>;
  isDisabled(locator: ReplayLocator): Promise<boolean>;
  textVisible(text: string): Promise<boolean>;
  inputValue(locator: ReplayLocator): Promise<string | null>;
  currentUrl(): string;
  settle(milliseconds: number): Promise<void>;
  close(): Promise<void>;
}

export type NetworkObservation =
  | {
      readonly kind: 'started';
      readonly requestId: string;
      readonly method: string;
      readonly url: string;
      readonly timestampMs: number;
    }
  | {
      readonly kind: 'completed';
      readonly requestId: string;
      readonly status: number | null;
      readonly failed: boolean;
      readonly timestampMs: number;
    };

export interface ExternalBrowserOwner {
  launchRecording(
    options: ExternalBrowserOptions,
    callbacks: RecordingCallbacks,
  ): Promise<RecordingBrowserSession>;
  launchReplay(options: ExternalBrowserOptions): Promise<ReplayBrowserSession>;
}

class PlaywrightExternalSession
  implements RecordingBrowserSession, ReplayBrowserSession
{
  private closed = false;
  private readonly activeRequests = new Map<Request, string>();
  private networkObserver: ((observation: NetworkObservation) => void) | null =
    null;
  private requestSequence = 0;
  private screenshotMasks: readonly ReplayLocator[] = [];

  constructor(
    private readonly browser: Browser,
    private readonly context: BrowserContext,
    private readonly page: Page,
    private readonly timeoutMs: number,
  ) {
    page.setDefaultTimeout(timeoutMs);
    page.setDefaultNavigationTimeout(timeoutMs);
    page.on('request', (request) => {
      this.requestSequence += 1;
      const requestId = `request-${String(this.requestSequence).padStart(4, '0')}`;
      this.activeRequests.set(request, requestId);
      this.networkObserver?.({
        kind: 'started',
        requestId,
        method: request.method(),
        url: request.url(),
        timestampMs: Date.now(),
      });
    });
    page.on('response', (response) => {
      const request = response.request();
      const requestId = this.activeRequests.get(request);
      if (requestId === undefined) return;
      this.activeRequests.delete(request);
      this.networkObserver?.({
        kind: 'completed',
        requestId,
        status: response.status(),
        failed: false,
        timestampMs: Date.now(),
      });
    });
    page.on('requestfailed', (request) => {
      const requestId = this.activeRequests.get(request);
      if (requestId === undefined) return;
      this.activeRequests.delete(request);
      this.networkObserver?.({
        kind: 'completed',
        requestId,
        status: null,
        failed: true,
        timestampMs: Date.now(),
      });
    });
  }

  async navigate(url: string): Promise<void> {
    await this.page.goto(url, { waitUntil: 'load' });
    await this.page.waitForFunction(() => document.readyState === 'complete', {
      timeout: this.timeoutMs,
    });
    // Framework hydration can attach interaction handlers just after the load
    // event. A short bounded settling window prevents clicks on inert SSR HTML.
    await this.page.waitForTimeout(Math.min(150, this.timeoutMs));
  }

  async click(locator: ReplayLocator): Promise<void> {
    await resolveLocator(this.page, locator).click();
  }

  async fill(locator: ReplayLocator, value: string): Promise<void> {
    await resolveLocator(this.page, locator).fill(value);
  }

  async setChecked(locator: ReplayLocator, checked: boolean): Promise<void> {
    await resolveLocator(this.page, locator).setChecked(checked);
  }

  async select(locator: ReplayLocator, value: string): Promise<void> {
    await resolveLocator(this.page, locator).selectOption(value);
  }

  async submit(locator: ReplayLocator): Promise<void> {
    await resolveLocator(this.page, locator).evaluate((element) => {
      if (!(element instanceof HTMLFormElement)) {
        throw new Error('Recorded submit target is no longer a form.');
      }
      element.requestSubmit();
    });
  }

  async triggerRepeated(
    locator: ReplayLocator,
    type: 'click' | 'submit',
    count: 2 | 3,
    intervalMs: 0 | 100 | 300,
    onAttempt: (attempt: number) => void,
  ): Promise<void> {
    const element = await resolveLocator(this.page, locator).elementHandle();
    if (element === null)
      throw new Error('Experiment target could not be located.');
    let firstError: unknown;
    for (let attempt = 1; attempt <= count; attempt += 1) {
      onAttempt(attempt);
      try {
        await element.evaluate((target, actionType) => {
          if (actionType === 'submit') {
            if (!(target instanceof HTMLFormElement)) {
              throw new Error('Recorded submit target is no longer a form.');
            }
            target.requestSubmit();
          } else if (target instanceof HTMLElement) {
            target.click();
          } else {
            throw new Error('Recorded click target is no longer interactive.');
          }
        }, type);
      } catch (error: unknown) {
        firstError ??= error;
      }
      if (attempt < count && intervalMs > 0) {
        await this.page.waitForTimeout(intervalMs);
      }
    }
    if (firstError !== undefined) {
      throw normalizeError(firstError, 'Repeated target execution failed.');
    }
  }

  observeNetwork(observer: (observation: NetworkObservation) => void): void {
    this.networkObserver = observer;
  }

  async captureScreenshot(destination: string): Promise<void> {
    const masked = [];
    for (const locator of this.screenshotMasks) {
      const target = resolveLocator(this.page, locator);
      if ((await target.count()) === 0) continue;
      const previous = await target.evaluate((element) => {
        if (
          !(element instanceof HTMLInputElement) &&
          !(element instanceof HTMLTextAreaElement)
        ) {
          return null;
        }
        const value = element.value;
        element.value = '••••';
        return value;
      });
      masked.push({ target, previous });
    }
    try {
      await this.page.screenshot({
        path: destination,
        type: 'png',
        fullPage: true,
      });
    } finally {
      for (const item of masked) {
        if (item.previous === null) continue;
        await item.target
          .evaluate((element, value) => {
            if (
              element instanceof HTMLInputElement ||
              element instanceof HTMLTextAreaElement
            ) {
              element.value = value;
            }
          }, item.previous)
          .catch(() => undefined);
      }
    }
  }

  setScreenshotMasks(locators: readonly ReplayLocator[]): void {
    this.screenshotMasks = [...locators];
  }

  async isVisible(locator: ReplayLocator): Promise<boolean> {
    return resolveLocator(this.page, locator).isVisible();
  }

  async isDisabled(locator: ReplayLocator): Promise<boolean> {
    const target = resolveLocator(this.page, locator);
    if ((await target.count()) === 0) return false;
    return target.isDisabled();
  }

  async textVisible(value: string): Promise<boolean> {
    return this.page.getByText(value, { exact: false }).first().isVisible();
  }

  async inputValue(locator: ReplayLocator): Promise<string | null> {
    const target = resolveLocator(this.page, locator);
    if ((await target.count()) === 0) return null;
    try {
      return await target.inputValue();
    } catch {
      return null;
    }
  }

  currentUrl(): string {
    return this.page.url();
  }

  async settle(milliseconds: number): Promise<void> {
    await this.page.waitForTimeout(Math.min(milliseconds, this.timeoutMs));
  }

  async close(): Promise<void> {
    if (this.closed) return;
    this.closed = true;
    let contextError: unknown;
    try {
      await this.context.close();
    } catch (error: unknown) {
      contextError = error;
    }
    try {
      await this.browser.close();
    } catch (error: unknown) {
      if (contextError !== undefined) {
        throw new Error(
          `Browser cleanup failed after the context also failed to close: ${normalizeError(contextError, 'unknown context cleanup failure').message}`,
          { cause: error },
        );
      }
      throw normalizeError(error, 'Chromium could not be closed.');
    }
    if (contextError !== undefined) {
      throw normalizeError(
        contextError,
        'The browser context could not be closed.',
      );
    }
  }
}

export class PlaywrightExternalBrowserOwner implements ExternalBrowserOwner {
  constructor(
    private readonly afterRecordingPageReady?: (page: Page) => Promise<void>,
  ) {}

  async launchRecording(
    options: ExternalBrowserOptions,
    callbacks: RecordingCallbacks,
  ): Promise<RecordingBrowserSession> {
    const browser = await chromium.launch({ headless: options.headless });
    try {
      const context = await browser.newContext(
        options.storageStatePath === undefined
          ? {}
          : { storageState: options.storageStatePath },
      );
      const page = await context.newPage();
      await context.exposeBinding(
        '__formcrashRecord',
        ({ frame }, payload: unknown) => {
          callbacks.onEvent(payload, isTopFrame(page, frame));
        },
      );
      await context.exposeBinding(
        '__formcrashWarn',
        ({ frame }, payload: unknown) => {
          callbacks.onWarning(payload, isTopFrame(page, frame));
        },
      );
      await context.addInitScript(installBrowserRecorder);
      page.on('framenavigated', (frame) => {
        if (frame === page.mainFrame()) {
          callbacks.onNavigation(frame.url(), Date.now());
        }
      });
      context.on('page', (openedPage) => {
        if (openedPage === page) return;
        callbacks.onWarning(
          {
            code: 'new_tab',
            message: 'New tabs are unsupported and were not recorded.',
            timestamp: Date.now(),
            url: page.url(),
          },
          true,
        );
        void openedPage.close();
      });
      const session = new PlaywrightExternalSession(
        browser,
        context,
        page,
        options.timeoutMs,
      );
      await session.navigate(options.targetUrl);
      await this.afterRecordingPageReady?.(page);
      return session;
    } catch (error: unknown) {
      await browser.close().catch(() => undefined);
      throw error;
    }
  }

  async launchReplay(
    options: ExternalBrowserOptions,
  ): Promise<ReplayBrowserSession> {
    const browser = await chromium.launch({ headless: options.headless });
    try {
      const context = await browser.newContext(
        options.storageStatePath === undefined
          ? {}
          : { storageState: options.storageStatePath },
      );
      const page = await context.newPage();
      return new PlaywrightExternalSession(
        browser,
        context,
        page,
        options.timeoutMs,
      );
    } catch (error: unknown) {
      await browser.close().catch(() => undefined);
      throw error;
    }
  }
}

function isTopFrame(page: Page, frame: Frame): boolean {
  return frame === page.mainFrame();
}

function resolveLocator(page: Page, locator: ReplayLocator) {
  switch (locator.strategy) {
    case 'data-formcrash':
      return page.locator(`[data-formcrash=${JSON.stringify(locator.value)}]`);
    case 'data-testid':
      return page.getByTestId(locator.value);
    case 'id':
      return page.locator(`#${escapeCss(locator.value)}`);
    case 'role':
      return page.getByRole(locator.role as never, {
        name: locator.name,
        exact: true,
      });
    case 'name':
      return page.locator(`[name=${JSON.stringify(locator.value)}]`);
    case 'label':
      return page.getByLabel(locator.value, { exact: true });
    case 'text':
      return page.getByText(locator.value, { exact: true });
    case 'css':
      return page.locator(locator.value);
  }
}

function escapeCss(value: string): string {
  return value.replace(
    /[^a-zA-Z0-9_-]/gu,
    (character) => `\\${character.codePointAt(0)?.toString(16) ?? ''} `,
  );
}

function installBrowserRecorder(): void {
  type Binding = (payload: unknown) => Promise<void>;
  const bindings = window as typeof window & {
    __formcrashRecord?: Binding;
    __formcrashWarn?: Binding;
  };

  const emit = (payload: unknown): void => {
    void bindings.__formcrashRecord?.(payload);
  };
  const warn = (code: string, message: string): void => {
    void bindings.__formcrashWarn?.({
      code,
      message,
      timestamp: Date.now(),
      url: window.location.href,
    });
  };
  const clean = (value: string | null | undefined): string | null => {
    const normalized = value?.replace(/\s+/gu, ' ').trim() ?? '';
    return normalized === '' ? null : normalized.slice(0, 500);
  };
  const labelFor = (element: Element): string | null => {
    if (!(element instanceof HTMLElement)) return null;
    const labels = 'labels' in element ? element.labels : null;
    const first = labels instanceof NodeList ? labels.item(0) : null;
    return clean(first?.textContent);
  };
  const roleFor = (element: Element): string | null => {
    const explicit = clean(element.getAttribute('role'));
    if (explicit !== null) return explicit;
    if (element instanceof HTMLButtonElement) return 'button';
    if (element instanceof HTMLAnchorElement && element.href !== '')
      return 'link';
    if (element instanceof HTMLSelectElement) return 'combobox';
    if (element instanceof HTMLTextAreaElement) return 'textbox';
    if (element instanceof HTMLInputElement) {
      if (element.type === 'checkbox') return 'checkbox';
      if (element.type === 'radio') return 'radio';
      if (['button', 'submit', 'reset'].includes(element.type)) return 'button';
      return 'textbox';
    }
    return null;
  };
  const nameFor = (element: Element): string | null =>
    clean(element.getAttribute('aria-label')) ??
    labelFor(element) ??
    clean(element.getAttribute('title')) ??
    clean(element.textContent);
  const stableId = (value: string): boolean =>
    value.length <= 100 &&
    !/\d{5,}/u.test(value) &&
    !/^(react|radix|headlessui|:r)/iu.test(value);
  const cssPath = (element: Element): string => {
    const parts: string[] = [];
    let current: Element | null = element;
    while (current !== null && current !== document.documentElement) {
      let part = current.tagName.toLowerCase();
      if (current.id !== '' && stableId(current.id)) {
        part += `#${CSS.escape(current.id)}`;
        parts.unshift(part);
        break;
      }
      const parent: Element | null = current.parentElement;
      if (parent !== null) {
        const siblings = [...parent.children].filter(
          (candidate) => candidate.tagName === current?.tagName,
        );
        if (siblings.length > 1)
          part += `:nth-of-type(${siblings.indexOf(current) + 1})`;
      }
      parts.unshift(part);
      current = parent;
    }
    return parts.join(' > ') || element.tagName.toLowerCase();
  };
  const describe = (element: Element) => {
    const dataFormcrash = clean(element.getAttribute('data-formcrash'));
    const dataTestId = clean(element.getAttribute('data-testid'));
    const id = stableId(element.id) ? clean(element.id) : null;
    const role = roleFor(element);
    const accessibleName = nameFor(element);
    const name = clean(element.getAttribute('name'));
    const label = labelFor(element);
    const text = ['BUTTON', 'A'].includes(element.tagName)
      ? clean(element.textContent)
      : null;
    const css = cssPath(element);
    const locator =
      dataFormcrash !== null
        ? { strategy: 'data-formcrash', value: dataFormcrash }
        : dataTestId !== null
          ? { strategy: 'data-testid', value: dataTestId }
          : id !== null
            ? { strategy: 'id', value: id }
            : role !== null && accessibleName !== null
              ? { strategy: 'role', role, name: accessibleName }
              : name !== null
                ? { strategy: 'name', value: name }
                : label !== null
                  ? { strategy: 'label', value: label }
                  : text !== null
                    ? { strategy: 'text', value: text }
                    : { strategy: 'css', value: css };
    return {
      locator,
      fingerprint: {
        tagName: element.tagName.toLowerCase(),
        inputType:
          element instanceof HTMLInputElement ? clean(element.type) : null,
        dataFormcrash,
        dataTestId,
        id,
        role,
        accessibleName,
        name,
        label,
        text,
        cssPath: css,
      },
    };
  };
  const unsupported = (element: Element): boolean => {
    if (element.getRootNode() instanceof ShadowRoot) {
      warn(
        'shadow_dom',
        'Shadow DOM targets are unsupported and were not recorded.',
      );
      return true;
    }
    if (element instanceof HTMLElement && element.isContentEditable) {
      warn(
        'contenteditable',
        'Contenteditable editors are unsupported and were not recorded.',
      );
      return true;
    }
    const identifyingText = [
      element.id,
      element.className,
      element.getAttribute('name'),
      element.getAttribute('aria-label'),
    ]
      .join(' ')
      .toLowerCase();
    if (/captcha|recaptcha|hcaptcha/u.test(identifyingText)) {
      warn(
        'captcha',
        'CAPTCHA interactions are unsupported and were not recorded.',
      );
      return true;
    }
    if (/stripe|paypal|adyen|braintree|checkout\.com/u.test(identifyingText)) {
      warn(
        'third_party_payment',
        'Third-party payment interactions are unsupported and were not recorded.',
      );
      return true;
    }
    return false;
  };
  const sensitive = (element: Element, value: string): boolean => {
    if (element.getAttribute('data-formcrash-sensitive') === 'true')
      return true;
    if (element instanceof HTMLInputElement && element.type === 'password')
      return true;
    const description = [
      element.id,
      element.getAttribute('name'),
      element.getAttribute('autocomplete'),
      element.getAttribute('placeholder'),
      element.getAttribute('aria-label'),
      labelFor(element),
    ]
      .join(' ')
      .toLowerCase();
    if (
      /password|passwd|secret|token|credit|card|cvv|cvc|pan|expiry|ssn/u.test(
        description,
      )
    ) {
      return true;
    }
    return /^\d{13,19}$/u.test(value.replace(/[\s-]/gu, ''));
  };
  const targetOf = (event: Event): Element | null => {
    const original = event.composedPath()[0];
    return original instanceof Element
      ? original
      : event.target instanceof Element
        ? event.target
        : null;
  };
  document.addEventListener(
    'DOMContentLoaded',
    () => {
      if (document.querySelector('iframe') !== null) {
        warn('iframe', 'Iframe content is unsupported and was not recorded.');
      }
    },
    { once: true },
  );
  const sendAction = (
    kind: RawRecordingEvent['kind'],
    element: Element,
    value: string | null,
  ): void => {
    if (unsupported(element)) return;
    const isSensitive = value !== null && sensitive(element, value);
    emit({
      kind,
      timestamp: Date.now(),
      url: window.location.href,
      ...describe(element),
      value: isSensitive ? null : value,
      sensitive: isSensitive,
    });
  };
  const sendNavigation = (): void => {
    emit({
      kind: 'navigate',
      timestamp: Date.now(),
      url: window.location.href,
    });
  };
  const pushState = history.pushState.bind(history);
  history.pushState = (
    data: unknown,
    unused: string,
    url?: string | URL | null,
  ) => {
    pushState(data, unused, url);
    queueMicrotask(sendNavigation);
  };
  const replaceState = history.replaceState.bind(history);
  history.replaceState = (
    data: unknown,
    unused: string,
    url?: string | URL | null,
  ) => {
    replaceState(data, unused, url);
    queueMicrotask(sendNavigation);
  };
  window.addEventListener('popstate', sendNavigation);

  document.addEventListener(
    'click',
    (event) => {
      const target = targetOf(event);
      if (target === null || unsupported(target)) return;
      const anchor = target.closest('a');
      if (anchor?.target === '_blank') {
        warn(
          'new_tab',
          'New-tab navigation is unsupported and was not recorded.',
        );
        return;
      }
      if (
        target.closest('label') !== null ||
        target instanceof HTMLInputElement ||
        target instanceof HTMLTextAreaElement ||
        target instanceof HTMLSelectElement
      ) {
        return;
      }
      const button = target.closest('button, input[type="submit"]');
      if (
        button instanceof HTMLButtonElement &&
        (button.type === 'submit' || button.form !== null)
      ) {
        return;
      }
      sendAction('click', target.closest('a, button') ?? target, null);
    },
    true,
  );
  document.addEventListener(
    'input',
    (event) => {
      const target = targetOf(event);
      if (
        target instanceof HTMLInputElement &&
        !['checkbox', 'radio', 'file', 'submit', 'button'].includes(target.type)
      ) {
        sendAction('fill', target, target.value);
      } else if (target instanceof HTMLTextAreaElement) {
        sendAction('fill', target, target.value);
      }
    },
    true,
  );
  document.addEventListener(
    'change',
    (event) => {
      const target = targetOf(event);
      if (target instanceof HTMLInputElement && target.type === 'file') {
        warn(
          'file_upload',
          'File uploads are unsupported and were not recorded.',
        );
      } else if (
        target instanceof HTMLInputElement &&
        target.type === 'checkbox'
      ) {
        sendAction('checkbox', target, String(target.checked));
      } else if (
        target instanceof HTMLInputElement &&
        target.type === 'radio'
      ) {
        sendAction('radio', target, String(target.checked));
      } else if (target instanceof HTMLSelectElement) {
        sendAction('select', target, target.value);
      }
    },
    true,
  );
  document.addEventListener(
    'submit',
    (event) => {
      const form = targetOf(event);
      if (form instanceof HTMLFormElement) sendAction('submit', form, null);
    },
    true,
  );
  for (const eventName of ['dragstart', 'drop']) {
    document.addEventListener(
      eventName,
      () =>
        warn(
          'drag_and_drop',
          'Drag and drop is unsupported and was not recorded.',
        ),
      true,
    );
  }
}

function normalizeError(error: unknown, fallback: string): Error {
  return error instanceof Error ? error : new Error(fallback, { cause: error });
}
