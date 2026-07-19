import { randomUUID } from 'node:crypto';

import {
  capturedOutcomeTargetSchema,
  generatedValueBindingSchema,
  outcomeCaptureSessionSchema,
  outcomeCaptureWarningSchema,
  type ApproveOutcomeCheckRequest,
  type CapturedOutcomeTarget,
  type EphemeralRuntimeValues,
  type GeneratedValueBinding,
  type GeneratedValueExpression,
  type OutcomeCaptureSession,
  type OutcomeCaptureWarning,
  type OutcomeCheck,
  type ReplayLocator,
} from '@formcrash/contracts';

import type { ServerConfig } from '../../app/config.js';
import type { OutcomeCheckRepository } from '../../persistence/outcome-check-repository.js';
import type { ProjectJourneyRepository } from '../../persistence/project-journey-repository.js';
import type { ProjectSettingsRepository } from '../../persistence/project-settings-repository.js';
import { RunEventLog } from '../engine/event-log.js';
import type { AuthStateStore } from '../external/auth-session.js';
import {
  assertNoVisibleAuthenticationRequirement,
  assertSavedAuthenticationSessionActive,
  SavedAuthenticationExpiredError,
} from '../external/authentication-redirect.js';
import { executeHttpHook } from '../external/http-hooks.js';
import { executeRecordedStep } from '../external/journey-actions.js';
import { assertProductionConfirmed } from '../external/production-safety.js';
import {
  isStepValueSensitive,
  resolveHook,
  resolveRuntime,
  resolveStepValue,
  type ResolvedRuntime,
} from '../external/runtime-values.js';
import type { BrowserOwnership } from '../infrastructure/browser-ownership.js';
import {
  PlaywrightExternalBrowserOwner,
  type ExternalBrowserOwner,
  type OutcomeElementSelection,
  type ReplayBrowserSession,
} from '../recording/external-browser.js';
import { createOutcomeBaseline } from './baseline-journey.js';

const DEFAULT_CAPTURE_TTL_MS = 10 * 60 * 1_000;

interface ActiveCapture {
  readonly id: string;
  readonly browser: ReplayBrowserSession;
  readonly release: () => void;
  readonly runtime: ResolvedRuntime;
  readonly events: RunEventLog;
  readonly afterRunHook: ReturnType<typeof resolveHook> | null;
}

export class OutcomeCaptureStaleError extends Error {
  constructor() {
    super('The outcome capture session is stale. Start a new baseline replay.');
    this.name = 'OutcomeCaptureStaleError';
  }
}

export class OutcomeCaptureNotActiveError extends Error {
  constructor() {
    super('The outcome capture session is not active.');
    this.name = 'OutcomeCaptureNotActiveError';
  }
}

export class OutcomeCaptureManager {
  private readonly browserOwner: ExternalBrowserOwner;
  private readonly sessions = new Map<string, OutcomeCaptureSession>();
  private active: ActiveCapture | null = null;

  constructor(
    private readonly config: ServerConfig,
    private readonly projects: ProjectJourneyRepository,
    private readonly settings: ProjectSettingsRepository,
    private readonly authStore: AuthStateStore,
    private readonly outcomes: OutcomeCheckRepository,
    private readonly ownership: BrowserOwnership,
    browserOwner?: ExternalBrowserOwner,
    private readonly now: () => number = Date.now,
    private readonly ttlMs = DEFAULT_CAPTURE_TTL_MS,
  ) {
    this.browserOwner = browserOwner ?? new PlaywrightExternalBrowserOwner();
  }

  async start(
    journeyId: string,
    ephemeral: EphemeralRuntimeValues,
    confirmProduction = false,
  ): Promise<OutcomeCaptureSession> {
    const journey = this.projects.getJourney(journeyId);
    if (journey === null) throw new Error('Journey was not found.');
    const criticalAction = this.outcomes.getCriticalAction(journeyId);
    if (criticalAction === null) {
      throw new Error(
        'Approve a Critical Action before defining an Outcome Check.',
      );
    }
    const project = this.projects.getProject(journey.projectId);
    if (project === null) throw new Error('Journey project was not found.');
    assertProductionConfirmed(
      project,
      confirmProduction,
      'Outcome baseline replay',
    );
    const baseline = createOutcomeBaseline(journey);
    const baselineJourney = baseline.journey;
    const storedSettings = this.settings.get(project.id);
    const id = randomUUID();
    const startedAtMs = this.now();
    const runtime = resolveRuntime({
      runId: id,
      journey: baselineJourney,
      declarations: storedSettings.variables,
      ephemeral,
      hooks: [storedSettings.beforeRunHook, storedSettings.afterRunHook],
    });
    const session = outcomeCaptureSessionSchema.parse({
      id,
      journeyId,
      criticalActionId: criticalAction.id,
      generatedInputs: baseline.generatedInputs,
      status: 'launching',
      selectedTarget: null,
      selectionWarnings: [],
      finalPathname: null,
      errorMessage: null,
      startedAt: new Date(startedAtMs).toISOString(),
      expiresAt: new Date(startedAtMs + this.ttlMs).toISOString(),
      completedAt: null,
    });
    const release = this.ownership.acquire('outcome_capture');
    this.sessions.set(id, session);
    const events = new RunEventLog(`outcome-capture-${id}`);
    let browser: ReplayBrowserSession | null = null;
    try {
      if (storedSettings.beforeRunHook !== null) {
        await executeHttpHook(
          'before',
          resolveHook(
            storedSettings.beforeRunHook,
            runtime.values,
            runtime.context,
          ),
          events,
        );
      }
      const storageStatePath = this.authStore.usablePath(project.id);
      const trace = this.projects.getJourneyTraceManifest(journey.id);
      browser = await this.browserOwner.launchReplay({
        targetUrl: project.targetUrl,
        headless: this.config.browserHeadless,
        timeoutMs: this.config.browserTimeoutMs,
        ...(trace === null ? {} : { environment: trace.environment }),
        ...(storageStatePath === null ? {} : { storageStatePath }),
      });
      browser.setScreenshotMasks(
        baselineJourney.steps
          .filter(
            (step) =>
              step.locator !== null && isStepValueSensitive(step, runtime),
          )
          .map((step) => step.locator)
          .filter((locator) => locator !== null),
      );
      this.active = {
        id,
        browser,
        release,
        runtime,
        events,
        afterRunHook:
          storedSettings.afterRunHook === null
            ? null
            : resolveHook(
                storedSettings.afterRunHook,
                runtime.values,
                runtime.context,
              ),
      };
      browser.onClosed?.(() => {
        void this.handleBrowserClosed(id);
      });
      this.update(id, { status: 'replaying' });
      await browser.navigate(project.targetUrl);
      await assertSavedAuthenticationSessionActive(project.targetUrl, browser);
      for (const step of baselineJourney.steps) {
        await executeRecordedStep(browser, step, (item) =>
          resolveStepValue(item, runtime),
        );
      }
      await browser.settle(900);
      await assertNoVisibleAuthenticationRequirement(browser);
      const finalPathname = pathnameOf(browser.currentUrl());
      if (browser.enterOutcomeSelection === undefined) {
        throw new Error(
          'The replay browser does not support outcome selection.',
        );
      }
      await browser.enterOutcomeSelection((selection) => {
        this.acceptSelection(id, selection);
      });
      return this.update(id, {
        status: 'awaiting_selection',
        finalPathname,
      });
    } catch (error: unknown) {
      if (error instanceof SavedAuthenticationExpiredError) {
        await this.failAndClose(id, error.message);
        throw error;
      }
      const message =
        error instanceof Error && error.message.trim() !== ''
          ? error.message
          : 'The baseline replay could not reach outcome-selection mode.';
      await this.failAndClose(id, message, browser, release);
      return this.requireSession(id);
    }
  }

  async get(id: string): Promise<OutcomeCaptureSession | null> {
    const session = this.sessions.get(id);
    if (session === undefined) return null;
    if (this.active?.id === id && this.isExpired(session)) {
      await this.expire(id);
    }
    return this.sessions.get(id) ?? null;
  }

  async getForJourney(
    journeyId: string,
  ): Promise<OutcomeCaptureSession | null> {
    const id = this.active?.id;
    if (id === undefined) return null;
    const capture = await this.get(id);
    return capture?.journeyId === journeyId ? capture : null;
  }

  async approve(
    id: string,
    input: ApproveOutcomeCheckRequest,
  ): Promise<OutcomeCheck> {
    const session = await this.requireActive(id);
    if (input.type === 'final_pathname_matches') {
      if (
        session.finalPathname === null ||
        input.expectedPathname !== session.finalPathname
      ) {
        throw new Error(
          'The approved pathname must match the baseline replay’s final pathname.',
        );
      }
      return this.outcomes.saveOutcomeCheck({
        journeyId: session.journeyId,
        criticalActionId: session.criticalActionId,
        type: input.type,
        description: input.description,
        expectedPathname: input.expectedPathname,
      });
    }
    if (
      session.status !== 'selection_ready' ||
      session.selectedTarget === null
    ) {
      throw new Error(
        'Select one reliable visible element before approving this Outcome Check.',
      );
    }
    if (input.type === 'visible_element_exists') {
      return this.outcomes.saveOutcomeCheck({
        journeyId: session.journeyId,
        criticalActionId: session.criticalActionId,
        type: input.type,
        description: input.description,
        target: session.selectedTarget,
      });
    }
    const binding = session.selectedTarget.generatedBindings.find(
      (candidate) => candidate.expression === input.bindingExpression,
    );
    if (binding === undefined) {
      throw new Error(
        'The selected element does not contain the approved generated value.',
      );
    }
    return this.outcomes.saveOutcomeCheck({
      journeyId: session.journeyId,
      criticalActionId: session.criticalActionId,
      type: input.type,
      description: input.description,
      target: session.selectedTarget,
      binding,
    });
  }

  async close(id: string): Promise<OutcomeCaptureSession> {
    const session = this.sessions.get(id);
    if (session === undefined) throw new OutcomeCaptureNotActiveError();
    if (this.active?.id !== id) return session;
    return this.finish(id, 'completed');
  }

  async closeAll(): Promise<void> {
    if (this.active === null) return;
    await this.finish(this.active.id, 'completed');
  }

  private acceptSelection(
    id: string,
    selection: OutcomeElementSelection,
  ): void {
    if (this.active?.id !== id) return;
    const session = this.sessions.get(id);
    if (session === undefined || this.isExpired(session)) return;
    const analyzed = analyzeSelection(selection, this.active.runtime);
    if (analyzed.target === null) {
      this.update(id, {
        status: 'selection_rejected',
        selectedTarget: null,
        selectionWarnings: [...analyzed.warnings],
      });
      return;
    }
    this.update(id, {
      status: 'selection_ready',
      selectedTarget: analyzed.target,
      selectionWarnings: [...analyzed.warnings],
    });
  }

  private async requireActive(id: string): Promise<OutcomeCaptureSession> {
    const session = this.sessions.get(id);
    if (session === undefined || this.active?.id !== id) {
      throw new OutcomeCaptureNotActiveError();
    }
    if (this.isExpired(session)) {
      await this.expire(id);
      throw new OutcomeCaptureStaleError();
    }
    return this.requireSession(id);
  }

  private isExpired(session: OutcomeCaptureSession): boolean {
    return this.now() >= Date.parse(session.expiresAt);
  }

  private async expire(id: string): Promise<void> {
    await this.finish(id, 'expired');
  }

  private async failAndClose(
    id: string,
    message: string,
    browser: ReplayBrowserSession | null = this.active?.browser ?? null,
    release: (() => void) | null = this.active?.release ?? null,
  ): Promise<void> {
    const active = this.active?.id === id ? this.active : null;
    if (active !== null) this.active = null;
    await browser?.close().catch(() => undefined);
    if (active?.afterRunHook !== null && active?.afterRunHook !== undefined) {
      await executeHttpHook('after', active.afterRunHook, active.events).catch(
        () => undefined,
      );
    }
    (active?.release ?? release)?.();
    this.update(id, {
      status: 'runner_error',
      errorMessage: message.slice(0, 1_000),
      completedAt: new Date(this.now()).toISOString(),
    });
  }

  private async handleBrowserClosed(id: string): Promise<void> {
    if (this.active?.id !== id) return;
    await this.failAndClose(
      id,
      'Chromium was closed before the Outcome Check capture finished. Start a new baseline replay.',
    );
  }

  private async finish(
    id: string,
    status: 'completed' | 'expired',
  ): Promise<OutcomeCaptureSession> {
    const active = this.active;
    if (active === null || active.id !== id) {
      throw new OutcomeCaptureNotActiveError();
    }
    this.update(id, { status: 'closing' });
    this.active = null;
    let errorMessage: string | null = null;
    try {
      await active.browser.close();
    } catch {
      errorMessage = 'Chromium cleanup did not complete successfully.';
    }
    if (active.afterRunHook !== null) {
      await executeHttpHook('after', active.afterRunHook, active.events).catch(
        () => {
          errorMessage =
            'The baseline replay closed, but the configured cleanup hook failed.';
        },
      );
    }
    active.release();
    return this.update(id, {
      status,
      errorMessage,
      completedAt: new Date(this.now()).toISOString(),
    });
  }

  private update(
    id: string,
    patch: Partial<OutcomeCaptureSession>,
  ): OutcomeCaptureSession {
    const current = this.requireSession(id);
    const updated = outcomeCaptureSessionSchema.parse({
      ...current,
      ...patch,
      id: current.id,
      journeyId: current.journeyId,
      criticalActionId: current.criticalActionId,
      generatedInputs: current.generatedInputs,
      startedAt: current.startedAt,
      expiresAt: current.expiresAt,
    });
    this.sessions.set(id, updated);
    return updated;
  }

  private requireSession(id: string): OutcomeCaptureSession {
    const session = this.sessions.get(id);
    if (session === undefined) {
      throw new OutcomeCaptureNotActiveError();
    }
    return session;
  }
}

function analyzeSelection(
  selection: OutcomeElementSelection,
  runtime: ResolvedRuntime,
): {
  readonly target: CapturedOutcomeTarget | null;
  readonly warnings: readonly OutcomeCaptureWarning[];
} {
  const warnings: OutcomeCaptureWarning[] = [];
  if (!selection.topFrame) {
    warnings.push(
      warning(
        'unsupported_iframe',
        'Outcome selection inside an iframe is unsupported. Select a top-level page element.',
      ),
    );
  }
  if (looksSensitive(selection)) {
    warnings.push(
      warning(
        'sensitive_content',
        'The selected element is classified as sensitive and cannot be captured as an Outcome Check.',
      ),
    );
  }
  const inspectedStrings = [
    selection.text,
    selection.value ?? '',
    ...Object.values(selection.fingerprint).filter(
      (value): value is string => value !== null,
    ),
    ...locatorStrings(selection.locator),
  ];
  if (containsSensitiveValue(inspectedStrings, runtime)) {
    warnings.push(
      warning(
        'sensitive_content',
        'The selected element contains sensitive or secret-derived content and was not captured.',
      ),
    );
  }
  if (selection.locator === null || selection.locator.strategy === 'css') {
    warnings.push(
      warning(
        'unstable_locator',
        'The selected element has no stable test attribute, ID, name, or accessible locator.',
      ),
    );
  }
  const bindings = generatedBindings(selection, runtime);
  if (
    selection.locator !== null &&
    containsGeneratedValue(locatorStrings(selection.locator), runtime)
  ) {
    warnings.push(
      warning(
        'dynamic_locator',
        'The locator depends on a run-specific generated value and cannot be persisted safely.',
      ),
    );
  }
  if (selection.matchCount !== 1 || selection.visibleMatchCount !== 1) {
    warnings.push(
      warning(
        'ambiguous_locator',
        `The selected locator matched ${selection.matchCount} element(s), including ${selection.visibleMatchCount} visible match(es).`,
      ),
    );
  }
  if (bindings.length === 0) {
    warnings.push(
      warning(
        'generated_binding_unavailable',
        'No generated identity value was found in the selected element. It can be used for visibility, but not for an exactly-once matching check.',
      ),
    );
  }
  const rejected = warnings.some((item) =>
    [
      'unsupported_iframe',
      'unstable_locator',
      'sensitive_content',
      'dynamic_locator',
      'ambiguous_locator',
    ].includes(item.code),
  );
  if (rejected || selection.locator === null) {
    return { target: null, warnings };
  }
  const previewSource =
    selection.text ||
    selection.fingerprint.accessibleName ||
    selection.fingerprint.tagName;
  const target = capturedOutcomeTargetSchema.parse({
    locator: selection.locator,
    fingerprint: sanitizeFingerprint(selection.fingerprint, runtime),
    preview: sanitizeGeneratedText(previewSource, runtime).slice(0, 300),
    reliability: warnings.length === 0 ? 'high' : 'review',
    warnings,
    generatedBindings: bindings,
  });
  return { target, warnings };
}

function generatedBindings(
  selection: OutcomeElementSelection,
  runtime: ResolvedRuntime,
): readonly GeneratedValueBinding[] {
  const content = [selection.text, selection.value ?? ''].join(' ');
  return generatedValues(runtime)
    .filter((item) => item.value !== '' && content.includes(item.value))
    .map((item) =>
      generatedValueBindingSchema.parse({
        expression: item.expression,
        template: `{{${item.expression}}}`,
        label: generatedLabel(item.expression),
      }),
    );
}

function generatedValues(runtime: ResolvedRuntime): ReadonlyArray<{
  readonly expression: GeneratedValueExpression;
  readonly value: string;
}> {
  return [
    { expression: 'unique.email', value: runtime.context.uniqueEmail },
    { expression: 'unique.name', value: runtime.context.uniqueName },
    { expression: 'unique.phone', value: runtime.context.uniquePhone },
    { expression: 'unique.text', value: runtime.context.uniqueText },
  ];
}

function generatedLabel(expression: GeneratedValueExpression): string {
  switch (expression) {
    case 'unique.email':
      return 'Generated unique email';
    case 'unique.name':
      return 'Generated unique name';
    case 'unique.phone':
      return 'Generated unique phone';
    case 'unique.text':
      return 'Generated unique identifier';
  }
}

function sanitizeFingerprint(
  fingerprint: OutcomeElementSelection['fingerprint'],
  runtime: ResolvedRuntime,
): OutcomeElementSelection['fingerprint'] {
  return Object.fromEntries(
    Object.entries(fingerprint).map(([key, value]) => [
      key,
      typeof value === 'string' ? sanitizeGeneratedText(value, runtime) : value,
    ]),
  ) as OutcomeElementSelection['fingerprint'];
}

function sanitizeGeneratedText(
  value: string,
  runtime: ResolvedRuntime,
): string {
  let sanitized = value.replace(/\s+/gu, ' ').trim();
  for (const generated of [...generatedValues(runtime)].sort(
    (left, right) => right.value.length - left.value.length,
  )) {
    if (generated.value !== '') {
      sanitized = sanitized.replaceAll(
        generated.value,
        `{{${generated.expression}}}`,
      );
    }
  }
  return sanitized;
}

function containsGeneratedValue(
  values: readonly string[],
  runtime: ResolvedRuntime,
): boolean {
  return generatedValues(runtime).some(
    (generated) =>
      generated.value !== '' &&
      values.some((value) => value.includes(generated.value)),
  );
}

function containsSensitiveValue(
  values: readonly string[],
  runtime: ResolvedRuntime,
): boolean {
  const sensitive = [...runtime.values.values()]
    .filter((item) => item.sensitive && item.value.length >= 3)
    .map((item) => item.value);
  return sensitive.some((secret) =>
    values.some(
      (value) =>
        value.includes(secret) || value.includes(encodeURIComponent(secret)),
    ),
  );
}

function looksSensitive(selection: OutcomeElementSelection): boolean {
  if (selection.markedSensitive) return true;
  if (selection.inputType?.toLowerCase() === 'password') return true;
  const descriptor = [
    selection.fingerprint.dataFormcrash,
    selection.fingerprint.dataTestId,
    selection.fingerprint.id,
    selection.fingerprint.accessibleName,
    selection.fingerprint.name,
  ]
    .filter((value): value is string => value !== null)
    .join(' ')
    .toLowerCase();
  if (
    /password|passwd|secret|token|credit|card|cvv|cvc|pan|expiry|ssn/u.test(
      descriptor,
    )
  ) {
    return true;
  }
  return /^\d{13,19}$/u.test(
    (selection.value ?? selection.text).replace(/[\s-]/gu, ''),
  );
}

function locatorStrings(locator: ReplayLocator | null): readonly string[] {
  if (locator === null) return [];
  return locator.strategy === 'role'
    ? [locator.role, locator.name]
    : [locator.value];
}

function warning(
  code: OutcomeCaptureWarning['code'],
  message: string,
): OutcomeCaptureWarning {
  return outcomeCaptureWarningSchema.parse({ code, message });
}

function pathnameOf(url: string): string {
  return new URL(url).pathname;
}
