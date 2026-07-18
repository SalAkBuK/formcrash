import type {
  Browser,
  BrowserContext,
  ElementHandle,
  Frame,
  Locator,
  Page,
  Request,
} from 'playwright';
import { chromium } from 'playwright';
import { z } from 'zod';

import {
  replayLocatorSchema,
  type RecordedBrowserEnvironment,
  type RecordedPostcondition,
  type RecordedInteraction,
  type RecordedTargetCandidate,
  type RecordedTargetGeometry,
  type OutcomeElementFingerprint,
  type ReplayLocator,
  type TargetFingerprint,
} from '@formcrash/contracts';

export interface RawRecordingEvent {
  readonly kind: 'click' | 'fill' | 'checkbox' | 'radio' | 'select' | 'submit';
  readonly timestamp: number;
  readonly url: string;
  readonly locator: ReplayLocator;
  readonly fingerprint: TargetFingerprint;
  readonly value: string | null;
  readonly sensitive: boolean;
  readonly pointerType: 'mouse' | 'pen' | 'touch' | null;
  readonly targetCandidates: readonly RecordedTargetCandidate[];
  readonly geometry: RecordedTargetGeometry | null;
  readonly postconditions: readonly RecordedPostcondition[];
}

export interface RawTraceEvent {
  readonly kind: 'pointer' | 'keyboard' | 'wheel' | 'focus' | 'paste' | 'drag';
  readonly timestamp: number;
  readonly eventType: string;
  readonly x?: number;
  readonly y?: number;
  readonly button?: number;
  readonly buttons?: number;
  readonly pointerType?: 'mouse' | 'pen' | 'touch';
  readonly key?: string;
  readonly code?: string;
  readonly redacted?: boolean;
  readonly deltaX?: number;
  readonly deltaY?: number;
}

export interface RecordingEventContext {
  readonly pageId: string;
  readonly framePath: readonly string[];
  readonly topFrame: boolean;
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
  readonly recordVideoDirectory?: string;
}

export interface RecordingCallbacks {
  readonly onEvent: (
    event: unknown,
    topFrame: boolean,
    context?: RecordingEventContext,
  ) => void;
  readonly onWarning: (warning: unknown, topFrame: boolean) => void;
  readonly onNavigation: (
    url: string,
    timestamp: number,
    context?: RecordingEventContext,
  ) => void;
  readonly onTraceEvent?: (
    event: unknown,
    context: RecordingEventContext,
  ) => void;
  readonly onEnvironment?: (environment: RecordedBrowserEnvironment) => void;
}

export interface RecordingBrowserSession {
  close(): Promise<void>;
  recordedVideoPaths?(): readonly string[];
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
  countVisibleMatches?(
    locator: ReplayLocator,
    containingText?: string,
  ): Promise<VisibleMatchCount>;
  isDisabled(locator: ReplayLocator): Promise<boolean>;
  textVisible(text: string): Promise<boolean>;
  inputValue(locator: ReplayLocator): Promise<string | null>;
  clickInteraction?(
    interaction: RecordedInteraction,
  ): Promise<InteractionTargetResolution>;
  fillInteraction?(
    interaction: RecordedInteraction,
    value: string,
  ): Promise<InteractionTargetResolution>;
  setCheckedInteraction?(
    interaction: RecordedInteraction,
    checked: boolean,
  ): Promise<InteractionTargetResolution>;
  selectInteraction?(
    interaction: RecordedInteraction,
    value: string,
  ): Promise<InteractionTargetResolution>;
  submitInteraction?(
    interaction: RecordedInteraction,
  ): Promise<InteractionTargetResolution>;
  navigateInteraction?(
    interaction: RecordedInteraction,
    url: string,
  ): Promise<InteractionTargetResolution>;
  verifyInteraction?(
    interaction: RecordedInteraction,
  ): Promise<InteractionVerification>;
  sideEffectSequence?(): number;
  findActionControl?(
    locator: ReplayLocator,
    type: 'click' | 'submit',
  ): Promise<ReplayLocator | null>;
  inspectSemanticElements?(): Promise<readonly SemanticElementSnapshot[]>;
  enterOutcomeSelection?(
    onSelection: (selection: OutcomeElementSelection) => void,
  ): Promise<void>;
  onClosed?(callback: () => void): void;
  currentUrl(): string;
  settle(milliseconds: number): Promise<void>;
  close(): Promise<void>;
}

export interface InteractionTargetResolution {
  readonly strategy: string;
  readonly confidence: number;
  readonly recovered: boolean;
  readonly attempts: readonly string[];
}

export interface InteractionVerification {
  readonly passed: boolean;
  readonly expected: readonly string[];
  readonly observed: readonly string[];
}

export interface VisibleMatchCount {
  readonly visibleCount: number;
  readonly examinedCount: number;
  readonly totalLocatorMatchCount: number;
  readonly truncated: boolean;
}

export interface OutcomeElementSelection {
  readonly topFrame: boolean;
  readonly frameUrl: string;
  readonly locator: ReplayLocator | null;
  readonly fingerprint: OutcomeElementFingerprint;
  readonly inputType: string | null;
  readonly markedSensitive: boolean;
  readonly text: string;
  readonly value: string | null;
  readonly matchCount: number;
  readonly visibleMatchCount: number;
}

export interface SemanticElementSnapshot {
  readonly locator: ReplayLocator;
  readonly classification: 'success' | 'error' | 'loading';
  readonly visible: boolean;
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
  private mutationSequence = 0;
  private screenshotMasks: readonly ReplayLocator[] = [];
  private outcomeSelectionActive = false;
  private closeNotified = false;
  private readonly closeListeners = new Set<() => void>();
  private videoPaths: string[] = [];

  constructor(
    private readonly browser: Browser,
    private readonly context: BrowserContext,
    private readonly page: Page,
    private readonly timeoutMs: number,
  ) {
    page.setDefaultTimeout(timeoutMs);
    page.setDefaultNavigationTimeout(timeoutMs);
    page.on('close', () => this.notifyClosed());
    context.on('close', () => this.notifyClosed());
    browser.on('disconnected', () => this.notifyClosed());
    page.on('request', (request) => {
      this.requestSequence += 1;
      if (!['GET', 'HEAD', 'OPTIONS'].includes(request.method())) {
        this.mutationSequence += 1;
      }
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
    const target = resolveLocator(this.page, locator);
    try {
      await target.click();
    } catch (error: unknown) {
      if (!isTransientDetachedClick(error)) throw error;
      const recovered = resolveLocator(this.page, locator);
      if ((await recovered.count()) !== 1 || !(await recovered.isVisible())) {
        throw error;
      }
      const disabled = await recovered.evaluate(
        (element) =>
          (element instanceof HTMLButtonElement && element.disabled) ||
          element.getAttribute('aria-disabled') === 'true',
      );
      if (disabled) {
        throw new Error('Recorded click target is disabled.', { cause: error });
      }
      const box = await recovered.boundingBox();
      if (box === null) throw error;
      await this.page.mouse.click(
        box.x + box.width / 2,
        box.y + box.height / 2,
      );
    }
  }

  async clickInteraction(
    interaction: RecordedInteraction,
  ): Promise<InteractionTargetResolution> {
    const resolved = await this.resolveInteractionTarget(interaction);
    const box = await resolved.target.boundingBox();
    if (box === null) {
      throw new InteractionResolutionError(
        'The recorded target has no clickable geometry.',
        resolved.resolution.attempts,
      );
    }
    const offsetX = clampOffset(
      interaction.geometry?.pointerOffsetX,
      box.width,
    );
    const offsetY = clampOffset(
      interaction.geometry?.pointerOffsetY,
      box.height,
    );
    const page =
      'mainFrame' in resolved.scope ? resolved.scope : resolved.scope.page();
    await page.mouse.click(box.x + offsetX, box.y + offsetY);
    return resolved.resolution;
  }

  async fillInteraction(
    interaction: RecordedInteraction,
    value: string,
  ): Promise<InteractionTargetResolution> {
    const resolved = await this.resolveInteractionTarget(interaction);
    await resolved.target.click();
    const page =
      'mainFrame' in resolved.scope ? resolved.scope : resolved.scope.page();
    await page.keyboard.press('ControlOrMeta+A');
    await page.keyboard.insertText(value);
    return resolved.resolution;
  }

  async setCheckedInteraction(
    interaction: RecordedInteraction,
    checked: boolean,
  ): Promise<InteractionTargetResolution> {
    const resolved = await this.resolveInteractionTarget(interaction);
    if ((await resolved.target.isChecked()) !== checked) {
      await resolved.target.click();
    }
    return resolved.resolution;
  }

  async selectInteraction(
    interaction: RecordedInteraction,
    value: string,
  ): Promise<InteractionTargetResolution> {
    const resolved = await this.resolveInteractionTarget(interaction);
    await resolved.target.selectOption(value);
    return resolved.resolution;
  }

  async submitInteraction(
    interaction: RecordedInteraction,
  ): Promise<InteractionTargetResolution> {
    const resolved = await this.resolveInteractionTarget(interaction);
    await resolved.target.evaluate((element) => {
      if (!(element instanceof HTMLFormElement)) {
        throw new Error('Recorded submit target is no longer a form.');
      }
      element.requestSubmit();
    });
    return resolved.resolution;
  }

  async navigateInteraction(
    interaction: RecordedInteraction,
    url: string,
  ): Promise<InteractionTargetResolution> {
    const scope = this.scopeFor(interaction);
    await scope.goto(url, { waitUntil: 'load' });
    return {
      strategy: interaction.framePath.length === 0 ? 'page' : 'frame-page',
      confidence: 1,
      recovered: false,
      attempts: [],
    };
  }

  async verifyInteraction(
    interaction: RecordedInteraction,
  ): Promise<InteractionVerification> {
    if (interaction.postconditions.length === 0) {
      return { passed: true, expected: [], observed: [] };
    }
    const scope = this.scopeFor(interaction);
    const expected = interaction.postconditions.map(describePostcondition);
    let observed: string[];
    const deadline = Date.now() + Math.min(this.timeoutMs, 3_000);
    do {
      const results = await Promise.all(
        interaction.postconditions.map((condition) =>
          observePostcondition(scope, condition),
        ),
      );
      observed = results.map((item) => item.observed);
      if (results.every((item) => item.passed)) {
        return { passed: true, expected, observed };
      }
      await this.page.waitForTimeout(50);
    } while (Date.now() < deadline);
    return { passed: false, expected, observed };
  }

  sideEffectSequence(): number {
    return this.mutationSequence;
  }

  private scopeFor(interaction: RecordedInteraction): Page | Frame {
    const pageIndex = Number.parseInt(
      interaction.pageId.replace(/^page-/u, ''),
      10,
    );
    const page = this.context.pages()[Math.max(pageIndex - 1, 0)] ?? this.page;
    let frame = page.mainFrame();
    for (const segment of interaction.framePath) {
      const index = Number.parseInt(segment.replace(/^frame-/u, ''), 10);
      frame = frame.childFrames()[index] ?? frame;
    }
    return frame === page.mainFrame() ? page : frame;
  }

  private async resolveInteractionTarget(
    interaction: RecordedInteraction,
  ): Promise<{
    readonly scope: Page | Frame;
    readonly target: Locator;
    readonly resolution: InteractionTargetResolution;
  }> {
    const scope = this.scopeFor(interaction);
    const attempts: string[] = [];
    const candidates = [...interaction.targetCandidates].sort(
      (left, right) => right.confidence - left.confidence,
    );
    for (const [index, candidate] of candidates.entries()) {
      const target = resolveLocator(scope, candidate.locator);
      const count = await target.count().catch(() => 0);
      attempts.push(
        `${candidate.locator.strategy}: ${count} candidate match(es)`,
      );
      if (count !== 1) continue;
      if (!(await target.isVisible().catch(() => false))) continue;
      return {
        scope,
        target,
        resolution: {
          strategy: candidate.locator.strategy,
          confidence: candidate.confidence,
          recovered: index > 0,
          attempts,
        },
      };
    }
    throw new InteractionResolutionError(
      'No unique visible target matched the recorded interaction.',
      attempts,
    );
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

  async countVisibleMatches(
    locator: ReplayLocator,
    containingText?: string,
  ): Promise<VisibleMatchCount> {
    const matches = resolveLocator(this.page, locator);
    const totalLocatorMatchCount = await matches.count();
    const count = Math.min(totalLocatorMatchCount, 100);
    let visible = 0;
    for (let index = 0; index < count; index += 1) {
      const match = matches.nth(index);
      if (!(await match.isVisible())) continue;
      if (containingText !== undefined) {
        const text = (await match.innerText()).replace(/\s+/gu, ' ').trim();
        if (!text.includes(containingText)) continue;
      }
      visible += 1;
    }
    return {
      visibleCount: visible,
      examinedCount: count,
      totalLocatorMatchCount,
      truncated: totalLocatorMatchCount > count,
    };
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

  async findActionControl(
    locator: ReplayLocator,
    type: 'click' | 'submit',
  ): Promise<ReplayLocator | null> {
    const target = resolveLocator(this.page, locator);
    if ((await target.count()) === 0) return null;
    const control =
      type === 'submit'
        ? target
            .locator(
              'button[type="submit"], input[type="submit"], button:not([type])',
            )
            .first()
        : target.first();
    if ((await control.count()) === 0) return null;
    return stableLocatorFor(control);
  }

  async inspectSemanticElements(): Promise<readonly SemanticElementSnapshot[]> {
    const candidates = this.page.locator(
      [
        '[data-formcrash]',
        '[data-testid]',
        '[id]',
        '[role="alert"]',
        '[role="status"]',
        '[aria-live]',
      ].join(','),
    );
    const count = Math.min(await candidates.count(), 100);
    const snapshots: SemanticElementSnapshot[] = [];
    const seen = new Set<string>();
    for (let index = 0; index < count; index += 1) {
      const candidate = candidates.nth(index);
      const handle = await candidate
        .elementHandle({ timeout: Math.min(100, this.timeoutMs) })
        .catch(() => null);
      if (handle === null) {
        const currentCount = await candidates.count().catch(() => 0);
        if (index >= currentCount) break;
        continue;
      }
      try {
        const classification = await handle
          .evaluate(classifySemanticElement)
          .catch(() => null);
        if (classification === null) continue;
        const locator = await stableLocatorForElement(handle).catch(() => null);
        if (locator === null) continue;
        const key = JSON.stringify(locator);
        if (seen.has(key)) continue;
        seen.add(key);
        snapshots.push({
          locator,
          classification,
          visible: await handle.isVisible().catch(() => false),
        });
        if (snapshots.length >= 20) break;
      } finally {
        await handle.dispose().catch(() => undefined);
      }
    }
    return snapshots;
  }

  async enterOutcomeSelection(
    onSelection: (selection: OutcomeElementSelection) => void,
  ): Promise<void> {
    if (this.outcomeSelectionActive) return;
    this.outcomeSelectionActive = true;
    await this.context.exposeBinding(
      '__formcrashSelectOutcome',
      ({ frame }, payload: unknown) => {
        void this.handleOutcomeSelection(frame, payload, onSelection).catch(
          () => undefined,
        );
      },
    );
    const script = buildOutcomeSelectorInitScript();
    await this.context.addInitScript({ content: script });
    await Promise.all(
      this.page.frames().map(async (frame) => {
        await frame.evaluate(script).catch(() => undefined);
      }),
    );
  }

  onClosed(callback: () => void): void {
    this.closeListeners.add(callback);
    if (this.closeNotified) callback();
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
    const videos = this.context
      .pages()
      .map((page) => page.video())
      .filter((video) => video !== null);
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
    this.videoPaths = (
      await Promise.all(videos.map((video) => video.path().catch(() => null)))
    ).filter((videoPath): videoPath is string => videoPath !== null);
    if (contextError !== undefined) {
      throw normalizeError(
        contextError,
        'The browser context could not be closed.',
      );
    }
  }

  recordedVideoPaths(): readonly string[] {
    return [...this.videoPaths];
  }

  private notifyClosed(): void {
    if (this.closeNotified) return;
    this.closeNotified = true;
    for (const listener of this.closeListeners) listener();
  }

  private async handleOutcomeSelection(
    frame: Frame,
    payload: unknown,
    onSelection: (selection: OutcomeElementSelection) => void,
  ): Promise<void> {
    const parsed = rawOutcomeSelectionSchema.safeParse(payload);
    if (!parsed.success) return;
    const locatorResult = replayLocatorSchema.safeParse(parsed.data.locator);
    const locator = locatorResult.success ? locatorResult.data : null;
    let matchCount = 0;
    let visibleMatchCount = 0;
    if (locator !== null) {
      const matches = resolveLocator(this.page, locator);
      matchCount = await matches.count();
      for (let index = 0; index < Math.min(matchCount, 100); index += 1) {
        if (
          await matches
            .nth(index)
            .isVisible()
            .catch(() => false)
        ) {
          visibleMatchCount += 1;
        }
      }
    }
    onSelection({
      topFrame: frame === this.page.mainFrame(),
      frameUrl: frame.url(),
      locator,
      fingerprint: parsed.data.fingerprint,
      inputType: parsed.data.inputType,
      markedSensitive: parsed.data.markedSensitive,
      text: parsed.data.text,
      value: parsed.data.value,
      matchCount,
      visibleMatchCount,
    });
  }
}

async function stableLocatorFor(
  locator: Locator,
): Promise<ReplayLocator | null> {
  return locator.evaluate(stableLocatorFromElement);
}

async function stableLocatorForElement(
  element: ElementHandle<Element>,
): Promise<ReplayLocator | null> {
  return element.evaluate(stableLocatorFromElement);
}

function stableLocatorFromElement(element: Element): ReplayLocator | null {
  const dataFormcrash = (element.getAttribute('data-formcrash') ?? '').trim();
  if (dataFormcrash !== '' && dataFormcrash.length <= 160)
    return {
      strategy: 'data-formcrash' as const,
      value: dataFormcrash,
    };
  const dataTestId = (element.getAttribute('data-testid') ?? '').trim();
  if (dataTestId !== '' && dataTestId.length <= 160)
    return { strategy: 'data-testid' as const, value: dataTestId };
  if (
    element.id !== '' &&
    element.id.length <= 100 &&
    !/\d{5,}/u.test(element.id) &&
    !/^(react|radix|headlessui|:r|_r_)/iu.test(element.id)
  )
    return { strategy: 'id' as const, value: element.id };
  const name = (element.getAttribute('name') ?? '').trim();
  return name === '' || name.length > 160
    ? null
    : { strategy: 'name' as const, value: name };
}

function classifySemanticElement(
  element: Element,
): SemanticElementSnapshot['classification'] | null {
  const tokens = [
    element.getAttribute('data-formcrash'),
    element.getAttribute('data-testid'),
    element.id,
    element.className,
    element.getAttribute('role'),
    element.getAttribute('aria-live'),
  ]
    .join(' ')
    .toLowerCase();
  if (
    /(?:success|complete|completed|confirmation|confirmed|saved)/u.test(tokens)
  )
    return 'success';
  if (/(?:error|invalid|failure|failed|danger|alert)/u.test(tokens))
    return 'error';
  if (/(?:loading|pending|progress|spinner|busy)/u.test(tokens))
    return 'loading';
  return null;
}

export class PlaywrightExternalBrowserOwner implements ExternalBrowserOwner {
  constructor(
    private readonly afterRecordingPageReady?: (page: Page) => Promise<void>,
    private readonly onReplayPageCreated?: (page: Page) => void,
  ) {}

  async launchRecording(
    options: ExternalBrowserOptions,
    callbacks: RecordingCallbacks,
  ): Promise<RecordingBrowserSession> {
    const browser = await chromium.launch({ headless: options.headless });
    try {
      const context = await browser.newContext({
        viewport: { width: 1440, height: 900 },
        ...(options.storageStatePath === undefined
          ? {}
          : { storageState: options.storageStatePath }),
        ...(options.recordVideoDirectory === undefined
          ? {}
          : {
              recordVideo: {
                dir: options.recordVideoDirectory,
                size: { width: 1440, height: 900 },
              },
            }),
      });
      const page = await context.newPage();
      const pageIds = new WeakMap<Page, string>();
      let pageSequence = 0;
      const identifyPage = (candidate: Page): string => {
        const existing = pageIds.get(candidate);
        if (existing !== undefined) return existing;
        pageSequence += 1;
        const id = `page-${pageSequence}`;
        pageIds.set(candidate, id);
        return id;
      };
      identifyPage(page);
      const eventContext = (
        sourcePage: Page,
        frame: Frame,
      ): RecordingEventContext => ({
        pageId: identifyPage(sourcePage),
        framePath: framePath(frame),
        topFrame: frame === sourcePage.mainFrame(),
      });
      await context.exposeBinding(
        '__formcrashRecord',
        ({ page: sourcePage, frame }, payload: unknown) => {
          const metadata = eventContext(sourcePage, frame);
          callbacks.onEvent(payload, metadata.topFrame, metadata);
        },
      );
      await context.exposeBinding(
        '__formcrashWarn',
        ({ frame }, payload: unknown) => {
          callbacks.onWarning(payload, isTopFrame(page, frame));
        },
      );
      await context.exposeBinding(
        '__formcrashTrace',
        ({ page: sourcePage, frame }, payload: unknown) => {
          callbacks.onTraceEvent?.(payload, eventContext(sourcePage, frame));
        },
      );
      await context.addInitScript({
        content: buildBrowserRecorderInitScript(),
      });
      page.on('framenavigated', (frame) => {
        if (frame === page.mainFrame()) {
          callbacks.onNavigation(
            frame.url(),
            Date.now(),
            eventContext(page, frame),
          );
        }
      });
      context.on('page', (openedPage) => {
        if (openedPage === page) return;
        identifyPage(openedPage);
        openedPage.on('framenavigated', (frame) => {
          if (frame === openedPage.mainFrame()) {
            callbacks.onNavigation(
              frame.url(),
              Date.now(),
              eventContext(openedPage, frame),
            );
          }
        });
      });
      const session = new PlaywrightExternalSession(
        browser,
        context,
        page,
        options.timeoutMs,
      );
      await session.navigate(options.targetUrl);
      callbacks.onEnvironment?.(await captureBrowserEnvironment(browser, page));
      const recorderReady = await page.evaluate<boolean>(
        'globalThis.__formcrashRecorderReady === true',
      );
      if (!recorderReady) {
        throw new Error('Browser recorder initialization did not complete.');
      }
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
      this.onReplayPageCreated?.(page);
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

function framePath(frame: Frame): readonly string[] {
  const result: string[] = [];
  let current: Frame | null = frame;
  while (current.parentFrame() !== null) {
    const parent = current.parentFrame();
    if (parent === null) break;
    const index = parent.childFrames().indexOf(current);
    result.unshift(`frame-${Math.max(index, 0)}`);
    current = parent;
  }
  return result;
}

async function captureBrowserEnvironment(
  browser: Browser,
  page: Page,
): Promise<RecordedBrowserEnvironment> {
  const viewport = page.viewportSize() ?? { width: 1440, height: 900 };
  const values = await page.evaluate(() => ({
    deviceScaleFactor: window.devicePixelRatio,
    locale: navigator.language,
    timezoneId: Intl.DateTimeFormat().resolvedOptions().timeZone,
    userAgent: navigator.userAgent,
    colorScheme: window.matchMedia('(prefers-color-scheme: dark)').matches
      ? ('dark' as const)
      : ('light' as const),
  }));
  return {
    viewportWidth: viewport.width,
    viewportHeight: viewport.height,
    deviceScaleFactor: values.deviceScaleFactor,
    locale: values.locale,
    timezoneId: values.timezoneId,
    userAgent: values.userAgent,
    colorScheme: values.colorScheme,
    browserName: 'chromium',
    browserVersion: browser.version(),
  };
}

function resolveLocator(page: Page | Frame, locator: ReplayLocator) {
  switch (locator.strategy) {
    case 'data-formcrash':
      return page.locator(`[data-formcrash=${JSON.stringify(locator.value)}]`);
    case 'data-testid':
      return page.getByTestId(locator.value);
    case 'id':
      return page.locator(`#${escapeCss(locator.value)}`);
    case 'role':
      return page
        .getByRole(locator.role as never, {
          name: locator.name,
          exact: true,
        })
        .or(resolveRoleTextFallback(page, locator.role, locator.name));
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

export class InteractionResolutionError extends Error {
  constructor(
    message: string,
    readonly attempts: readonly string[],
  ) {
    super(message);
    this.name = 'InteractionResolutionError';
  }
}

function clampOffset(value: number | null | undefined, extent: number): number {
  if (extent <= 0) return 0;
  if (value === null || value === undefined || !Number.isFinite(value)) {
    return extent / 2;
  }
  return Math.min(Math.max(value, 1), Math.max(extent - 1, 1));
}

function describePostcondition(condition: RecordedPostcondition): string {
  switch (condition.kind) {
    case 'url':
      return `URL is ${condition.value}`;
    case 'control_value':
      return `control value is ${condition.value}`;
    case 'checked':
      return `checked is ${String(condition.value)}`;
    case 'aria_attribute':
      return `${condition.name} is ${condition.value ?? 'absent'}`;
    case 'visible_text':
      return `visible text contains ${condition.value}`;
  }
}

async function observePostcondition(
  scope: Page | Frame,
  condition: RecordedPostcondition,
): Promise<{ readonly passed: boolean; readonly observed: string }> {
  if (condition.kind === 'url') {
    const value = scope.url();
    return { passed: value === condition.value, observed: `URL is ${value}` };
  }
  if (condition.target === null) {
    return { passed: false, observed: 'postcondition target is missing' };
  }
  const target = resolveLocator(scope, condition.target);
  if ((await target.count().catch(() => 0)) !== 1) {
    return { passed: false, observed: 'postcondition target is not unique' };
  }
  switch (condition.kind) {
    case 'control_value': {
      const value = await target.inputValue().catch(() => '');
      return {
        passed: value === condition.value,
        observed: `control value is ${value}`,
      };
    }
    case 'checked': {
      const value = await target.isChecked().catch(() => false);
      return {
        passed: value === condition.value,
        observed: `checked is ${String(value)}`,
      };
    }
    case 'aria_attribute': {
      const value = await target.getAttribute(condition.name);
      return {
        passed: value === condition.value,
        observed: `${condition.name} is ${value ?? 'absent'}`,
      };
    }
    case 'visible_text': {
      const visible = await target.isVisible().catch(() => false);
      const value = (await target.innerText().catch(() => ''))
        .replace(/\s+/gu, ' ')
        .trim();
      return {
        passed: visible && value.includes(condition.value),
        observed: `visible text is ${value}`,
      };
    }
  }
}

function escapeCss(value: string): string {
  return value.replace(
    /[^a-zA-Z0-9_-]/gu,
    (character) => `\\${character.codePointAt(0)?.toString(16) ?? ''} `,
  );
}

function escapeRegularExpression(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&');
}

function resolveRoleTextFallback(
  page: Page | Frame,
  role: string,
  name: string,
): Locator {
  const selector =
    role === 'button'
      ? `button:visible, input[type="button"]:visible, input[type="submit"]:visible, input[type="reset"]:visible, [role="button"]:visible`
      : role === 'link'
        ? `a[href]:visible, [role="link"]:visible`
        : role === 'combobox'
          ? `select:visible, [role="combobox"]:visible`
          : role === 'checkbox'
            ? `input[type="checkbox"]:visible, [role="checkbox"]:visible`
            : role === 'radio'
              ? `input[type="radio"]:visible, [role="radio"]:visible`
              : `[role=${JSON.stringify(role)}]:visible`;
  return page.locator(selector).filter({
    hasText: new RegExp(`^\\s*${escapeRegularExpression(name)}\\s*$`, 'u'),
  });
}

const rawOutcomeSelectionSchema = z.object({
  locator: z.unknown(),
  fingerprint: z.object({
    tagName: z.string().min(1).max(80),
    dataFormcrash: z.string().max(160).nullable(),
    dataTestId: z.string().max(160).nullable(),
    id: z.string().max(160).nullable(),
    role: z.string().max(80).nullable(),
    accessibleName: z.string().max(240).nullable(),
    name: z.string().max(160).nullable(),
    cssPath: z.string().min(1).max(1_000),
  }),
  inputType: z.string().max(80).nullable(),
  markedSensitive: z.boolean(),
  text: z.string().max(1_000),
  value: z.string().max(1_000).nullable(),
});

function buildOutcomeSelectorInitScript(): string {
  return `(${installOutcomeSelector.toString()})();`;
}

function installOutcomeSelector(): void {
  type Binding = (payload: unknown) => Promise<void>;
  const bindings = window as typeof window & {
    __formcrashSelectOutcome?: Binding;
    __formcrashOutcomeSelectorReady?: boolean;
  };
  if (bindings.__formcrashOutcomeSelectorReady === true) return;
  bindings.__formcrashOutcomeSelectorReady = true;

  const clean = (
    value: string | null | undefined,
    maximum: number,
  ): string | null => {
    const normalized = value?.replace(/\s+/gu, ' ').trim() ?? '';
    return normalized === '' ? null : normalized.slice(0, maximum);
  };
  const stableId = (value: string): boolean =>
    value.length <= 100 &&
    !/\d{5,}/u.test(value) &&
    !/^(react|radix|headlessui|:r|_r_)/iu.test(value);
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
        if (siblings.length > 1) {
          part += `:nth-of-type(${siblings.indexOf(current) + 1})`;
        }
      }
      parts.unshift(part);
      current = parent;
    }
    return (parts.join(' > ') || element.tagName.toLowerCase()).slice(0, 1_000);
  };
  const labelFor = (element: Element): string | null => {
    if (!('labels' in element)) return null;
    const labels = element.labels;
    return labels instanceof NodeList
      ? clean(labels.item(0)?.textContent, 240)
      : null;
  };
  const roleFor = (element: Element): string | null => {
    const explicit = clean(element.getAttribute('role'), 80);
    if (explicit !== null) return explicit;
    if (element instanceof HTMLButtonElement) return 'button';
    if (element instanceof HTMLAnchorElement) return 'link';
    if (element instanceof HTMLInputElement) return 'textbox';
    if (element instanceof HTMLSelectElement) return 'combobox';
    if (element instanceof HTMLTableRowElement) return 'row';
    if (element instanceof HTMLLIElement) return 'listitem';
    return null;
  };
  const accessibleNameFor = (
    element: Element,
    role: string | null,
  ): string | null => {
    const labelledBy = clean(element.getAttribute('aria-labelledby'), 240);
    const labelledByText =
      labelledBy === null
        ? null
        : clean(
            labelledBy
              .split(/\s+/u)
              .map((id) => document.getElementById(id)?.textContent ?? '')
              .join(' '),
            240,
          );
    return (
      clean(element.getAttribute('aria-label'), 240) ??
      labelledByText ??
      labelFor(element) ??
      clean(element.getAttribute('title'), 240) ??
      (role === 'row' || role === 'listitem'
        ? clean(element.textContent, 240)
        : null)
    );
  };
  const describe = (element: Element) => {
    const dataFormcrash = clean(element.getAttribute('data-formcrash'), 160);
    const dataTestId = clean(element.getAttribute('data-testid'), 160);
    const id = stableId(element.id) ? clean(element.id, 160) : null;
    const name = clean(element.getAttribute('name'), 160);
    const role = roleFor(element);
    const accessibleName = accessibleNameFor(element, role);
    const locator =
      dataFormcrash !== null
        ? { strategy: 'data-formcrash', value: dataFormcrash }
        : dataTestId !== null
          ? { strategy: 'data-testid', value: dataTestId }
          : id !== null
            ? { strategy: 'id', value: id }
            : name !== null
              ? { strategy: 'name', value: name }
              : role !== null && accessibleName !== null
                ? { strategy: 'role', role, name: accessibleName }
                : { strategy: 'css', value: cssPath(element) };
    return {
      locator,
      fingerprint: {
        tagName: element.tagName.toLowerCase().slice(0, 80),
        dataFormcrash,
        dataTestId,
        id,
        role,
        accessibleName,
        name,
        cssPath: cssPath(element),
      },
      inputType:
        element instanceof HTMLInputElement ? clean(element.type, 80) : null,
      markedSensitive:
        element.getAttribute('data-formcrash-sensitive') === 'true',
      text:
        clean(
          element instanceof HTMLInputElement ||
            element instanceof HTMLTextAreaElement
            ? element.value
            : element.textContent,
          1_000,
        ) ?? '',
      value:
        element instanceof HTMLInputElement ||
        element instanceof HTMLTextAreaElement ||
        element instanceof HTMLSelectElement
          ? clean(element.value, 1_000)
          : null,
    };
  };
  const select = (event: MouseEvent): void => {
    const target = event.composedPath()[0];
    if (!(target instanceof Element)) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    const selectable =
      target.closest('[data-formcrash], [data-testid], [id], [name], [role]') ??
      target;
    void bindings.__formcrashSelectOutcome?.(describe(selectable));
  };
  document.addEventListener('click', select, true);
  document.documentElement.style.cursor = 'crosshair';
}

export function buildBrowserRecorderInitScript(
  recorderSource: string = installBrowserRecorder.toString(),
): string {
  return `(() => {
    const __name = (target, value) =>
      Object.defineProperty(target, "name", { value, configurable: true });
    (${recorderSource})();
  })();`;
}

function installBrowserRecorder(): void {
  type Binding = (payload: unknown) => Promise<void>;
  const bindings = window as typeof window & {
    __formcrashRecord?: Binding;
    __formcrashWarn?: Binding;
    __formcrashTrace?: Binding;
    __formcrashRecorderReady?: boolean;
  };

  const emit = (payload: unknown): void => {
    void bindings.__formcrashRecord?.(payload);
  };
  const trace = (payload: unknown): void => {
    void bindings.__formcrashTrace?.(payload);
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
  const accessibleNameFor = (
    element: Element,
    role: string | null,
  ): string | null => {
    const labelledBy = clean(element.getAttribute('aria-labelledby'));
    const labelledByText =
      labelledBy === null
        ? null
        : clean(
            labelledBy
              .split(/\s+/u)
              .map((id) => document.getElementById(id)?.textContent ?? '')
              .join(' '),
          );
    const named =
      clean(element.getAttribute('aria-label')) ??
      labelledByText ??
      labelFor(element) ??
      clean(element.getAttribute('title'));
    if (named !== null) return named;
    return role !== null &&
      ['button', 'link', 'menuitem', 'option', 'tab', 'treeitem'].includes(role)
      ? clean(element.textContent)
      : null;
  };
  const stableId = (value: string): boolean =>
    value.length <= 100 &&
    !/\d{5,}/u.test(value) &&
    !/^(react|radix|headlessui|:r|_r_)/iu.test(value);
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
  const describe = (
    element: Element,
    pointer?: { readonly clientX: number; readonly clientY: number },
  ) => {
    const dataFormcrash = clean(element.getAttribute('data-formcrash'));
    const dataTestId = clean(element.getAttribute('data-testid'));
    const id = stableId(element.id) ? clean(element.id) : null;
    const role = roleFor(element);
    const accessibleName = accessibleNameFor(element, role);
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
    const candidates: Array<{
      locator: Record<string, string>;
      source: string;
      confidence: number;
    }> = [];
    const addCandidate = (
      candidate: Record<string, string> | null,
      source: string,
      confidence: number,
    ): void => {
      if (
        candidate !== null &&
        !candidates.some(
          (item) => JSON.stringify(item.locator) === JSON.stringify(candidate),
        )
      ) {
        candidates.push({ locator: candidate, source, confidence });
      }
    };
    addCandidate(
      dataFormcrash === null
        ? null
        : { strategy: 'data-formcrash', value: dataFormcrash },
      'test_attribute',
      1,
    );
    addCandidate(
      dataTestId === null
        ? null
        : { strategy: 'data-testid', value: dataTestId },
      'test_attribute',
      0.98,
    );
    addCandidate(
      id === null ? null : { strategy: 'id', value: id },
      'id',
      0.94,
    );
    addCandidate(
      role === null || accessibleName === null
        ? null
        : { strategy: 'role', role, name: accessibleName },
      'accessibility',
      0.9,
    );
    addCandidate(
      name === null ? null : { strategy: 'name', value: name },
      'name',
      0.86,
    );
    addCandidate(
      label === null ? null : { strategy: 'label', value: label },
      'label',
      0.84,
    );
    addCandidate(
      text === null ? null : { strategy: 'text', value: text },
      'text',
      0.72,
    );
    addCandidate({ strategy: 'css', value: css }, 'structure', 0.45);
    const rect = element.getBoundingClientRect();
    return {
      locator,
      targetCandidates: candidates,
      geometry: {
        x: rect.x,
        y: rect.y,
        width: rect.width,
        height: rect.height,
        pointerOffsetX: pointer === undefined ? null : pointer.clientX - rect.x,
        pointerOffsetY: pointer === undefined ? null : pointer.clientY - rect.y,
      },
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
        'Shadow DOM target was preserved in the raw trace but cannot be represented as a semantic v1 step.',
      );
      return true;
    }
    if (element instanceof HTMLElement && element.isContentEditable) {
      warn(
        'contenteditable',
        'Contenteditable input was preserved in the raw trace but cannot be represented as a semantic v1 step.',
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
      /password|passwd|secret|token|credit|card|cvv|cvc|pan|expiry|ssn|emirates.?id|national.?id|identity|passport/u.test(
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
        warn(
          'iframe',
          'Iframe activity is preserved in the raw trace; semantic replay requires an allowlisted frame origin.',
        );
      }
    },
    { once: true },
  );
  const postconditionsFor = (
    element: Element,
    isSensitive: boolean,
    comboboxTextBefore: string | null,
  ): Array<Record<string, unknown>> => {
    const conditions: Array<Record<string, unknown>> = [];
    const ownLocator = describe(element).locator;
    if (
      !isSensitive &&
      (element instanceof HTMLInputElement ||
        element instanceof HTMLTextAreaElement ||
        element instanceof HTMLSelectElement)
    ) {
      conditions.push({
        kind: 'control_value',
        value: element.value.slice(0, 10_000),
        target: ownLocator,
      });
    }
    if (element instanceof HTMLInputElement) {
      if (element.type === 'checkbox' || element.type === 'radio') {
        conditions.push({
          kind: 'checked',
          value: element.checked,
          target: ownLocator,
        });
      }
    }
    for (const attribute of [
      'aria-expanded',
      'aria-selected',
      'aria-checked',
    ]) {
      if (element.hasAttribute(attribute)) {
        conditions.push({
          kind: 'aria_attribute',
          name: attribute,
          value: clean(element.getAttribute(attribute)),
          target: ownLocator,
        });
      }
    }
    const interactionRole = roleFor(element);
    const optionInteraction =
      interactionRole === 'option' ||
      interactionRole === 'menuitem' ||
      element.closest('[role="listbox"], [role="menu"]') !== null;
    const possibleCombobox = document.querySelector('[role="combobox"]');
    const currentComboboxText = clean(possibleCombobox?.textContent);
    const combobox =
      optionInteraction || currentComboboxText !== comboboxTextBefore
        ? possibleCombobox
        : null;
    const comboboxText = clean(combobox?.textContent);
    if (combobox !== null && comboboxText !== null && combobox !== element) {
      conditions.push({
        kind: 'visible_text',
        value: comboboxText,
        target: describe(combobox).locator,
      });
    }
    return conditions.slice(0, 12);
  };
  const sendAction = (
    kind: RawRecordingEvent['kind'],
    element: Element,
    value: string | null,
    pointer?: PointerEvent | MouseEvent,
  ): void => {
    if (unsupported(element)) return;
    const isSensitive = value !== null && sensitive(element, value);
    const timestamp = Date.now();
    const description = describe(element, pointer);
    const comboboxTextBefore = clean(
      document.querySelector('[role="combobox"]')?.textContent,
    );
    const deliver = (): void =>
      emit({
        kind,
        timestamp,
        url: window.location.href,
        ...description,
        value: isSensitive ? null : value,
        sensitive: isSensitive,
        pointerType:
          pointer instanceof PointerEvent ? pointer.pointerType : 'mouse',
        postconditions: postconditionsFor(
          element,
          isSensitive,
          comboboxTextBefore,
        ),
      });
    if (kind === 'click' || kind === 'submit') queueMicrotask(deliver);
    else deliver();
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
        (button instanceof HTMLButtonElement ||
          button instanceof HTMLInputElement) &&
        button.type === 'submit' &&
        button.form !== null
      ) {
        return;
      }
      sendAction(
        'click',
        target.closest('a, button, [role="option"], [role="menuitem"]') ??
          target,
        null,
        event,
      );
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
      } else if (target instanceof HTMLElement && target.isContentEditable) {
        sendAction('fill', target, target.textContent ?? '');
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
  let pointerMoveScheduled = false;
  let latestPointerMove: PointerEvent | null = null;
  document.addEventListener(
    'pointermove',
    (event) => {
      latestPointerMove = event;
      if (pointerMoveScheduled) return;
      pointerMoveScheduled = true;
      requestAnimationFrame(() => {
        pointerMoveScheduled = false;
        const current = latestPointerMove;
        if (current === null) return;
        trace({
          kind: 'pointer',
          eventType: 'pointermove',
          timestamp: Date.now(),
          x: current.clientX,
          y: current.clientY,
          button: current.button,
          buttons: current.buttons,
          pointerType: current.pointerType,
        });
      });
    },
    true,
  );
  for (const eventName of ['pointerdown', 'pointerup']) {
    document.addEventListener(
      eventName,
      (event) => {
        if (!(event instanceof PointerEvent)) return;
        trace({
          kind: 'pointer',
          eventType: eventName,
          timestamp: Date.now(),
          x: event.clientX,
          y: event.clientY,
          button: event.button,
          buttons: event.buttons,
          pointerType: event.pointerType,
        });
      },
      true,
    );
  }
  for (const eventName of ['keydown', 'keyup']) {
    document.addEventListener(
      eventName,
      (event) => {
        if (!(event instanceof KeyboardEvent)) return;
        const target = targetOf(event);
        const mustRedact =
          target !== null && sensitive(target, 'redacted-probe-value');
        trace({
          kind: 'keyboard',
          eventType: eventName,
          timestamp: Date.now(),
          key:
            mustRedact || event.key.length === 1
              ? '[REDACTED_CHARACTER]'
              : event.key.slice(0, 100),
          code:
            mustRedact || event.key.length === 1
              ? '[REDACTED_CODE]'
              : event.code.slice(0, 100),
          redacted: mustRedact,
        });
      },
      true,
    );
  }
  document.addEventListener(
    'wheel',
    (event) =>
      trace({
        kind: 'wheel',
        eventType: 'wheel',
        timestamp: Date.now(),
        deltaX: event.deltaX,
        deltaY: event.deltaY,
      }),
    { capture: true, passive: true },
  );
  document.addEventListener(
    'focusin',
    (event) => {
      const target = targetOf(event);
      if (
        target instanceof HTMLInputElement &&
        target.type !== 'password' &&
        sensitive(target, target.value)
      ) {
        target.style.setProperty('-webkit-text-security', 'disc');
        target.setAttribute('data-formcrash-video-masked', 'true');
      }
      trace({
        kind: 'focus',
        eventType: 'focusin',
        timestamp: Date.now(),
      });
    },
    true,
  );
  document.addEventListener(
    'paste',
    () =>
      trace({
        kind: 'paste',
        eventType: 'paste',
        timestamp: Date.now(),
        redacted: true,
      }),
    true,
  );
  for (const eventName of ['dragstart', 'dragend', 'drop']) {
    document.addEventListener(
      eventName,
      () => {
        trace({
          kind: 'drag',
          eventType: eventName,
          timestamp: Date.now(),
        });
        if (eventName === 'dragstart') {
          warn(
            'drag_and_drop',
            'Drag activity is preserved in the raw trace but has no semantic v1 fallback.',
          );
        }
      },
      true,
    );
  }
  bindings.__formcrashRecorderReady = true;
}

function normalizeError(error: unknown, fallback: string): Error {
  return error instanceof Error ? error : new Error(fallback, { cause: error });
}

function isTransientDetachedClick(error: unknown): boolean {
  if (!(error instanceof Error)) return false;
  return (
    error.message.includes('element was detached from the DOM') ||
    error.message.includes('element is not stable')
  );
}
