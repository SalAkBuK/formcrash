import type {
  RecordedInteraction,
  RecordedJourneyStep,
  ReplayInteractionOutcome,
  ReplayLocator,
  ReplayMode,
  TargetFingerprint,
} from '@formcrash/contracts';

import {
  InteractionResolutionError,
  type ReplayBrowserSession,
} from '../recording/external-browser.js';
import {
  assertNoVisibleAuthenticationRequirement,
  assertSavedAuthenticationActive,
} from './authentication-redirect.js';

export async function executeRecordedStep(
  session: ReplayBrowserSession,
  step: RecordedJourneyStep,
  resolveValue: (step: RecordedJourneyStep) => string,
  options?: {
    readonly interaction?: RecordedInteraction;
    readonly mode?: ReplayMode;
  },
): Promise<ReplayInteractionOutcome> {
  assertSavedAuthenticationActive(step.url, session.currentUrl());
  await assertNoVisibleAuthenticationRequirement(session);
  const securityChallenge = await session.detectSecurityChallenge?.();
  if (securityChallenge !== undefined && securityChallenge !== null) {
    throw new UnsupportedSecurityChallengeError(securityChallenge.message);
  }
  const mode = options?.mode ?? 'adaptive';
  const interaction = options?.interaction;
  if (step.type === 'navigate') {
    if (
      interaction !== undefined &&
      session.navigateInteraction !== undefined
    ) {
      const resolved = await session.navigateInteraction(interaction, step.url);
      return {
        stepId: step.id,
        status: 'verified',
        strategy: resolved.strategy,
        confidence: resolved.confidence,
      };
    }
    await session.navigate(step.url);
    return legacyOutcome(step, 'navigate');
  }
  if (step.locator === null) throw new Error('Recorded step has no locator.');
  const locator = preferredReplayLocator(step);
  const beforeSideEffect = session.sideEffectSequence?.() ?? 0;
  const beforeUrl = session.currentUrl();
  let resolution:
    | {
        readonly strategy: string;
        readonly confidence: number;
        readonly recovered: boolean;
        readonly attempts: readonly string[];
      }
    | undefined;
  switch (step.type) {
    case 'click':
      if (interaction !== undefined && session.clickInteraction !== undefined) {
        try {
          resolution = await session.clickInteraction(interaction);
        } catch (error: unknown) {
          if (!(error instanceof InteractionResolutionError)) throw error;
          if (mode === 'strict') {
            throw new HybridReplayError({
              message: error.message,
              pageId: interaction.pageId,
              framePath: interaction.framePath,
              resolutionAttempts: error.attempts,
              confidence: null,
              expectedState: interaction.postconditions.map((condition) =>
                JSON.stringify(condition),
              ),
              observedState: [],
              sideEffectObserved: false,
            });
          }
          await session.click(locator);
          resolution = {
            strategy: `semantic-${locator.strategy}`,
            confidence: 0.65,
            recovered: true,
            attempts: error.attempts,
          };
        }
      } else {
        await session.click(locator);
      }
      break;
    case 'fill':
      if (interaction !== undefined && session.fillInteraction !== undefined) {
        resolution = await session.fillInteraction(
          interaction,
          resolveValue(step),
        );
      } else {
        await session.fill(locator, resolveValue(step));
      }
      break;
    case 'checkbox':
    case 'radio':
      if (
        interaction !== undefined &&
        session.setCheckedInteraction !== undefined
      ) {
        resolution = await session.setCheckedInteraction(
          interaction,
          resolveValue(step) === 'true',
        );
      } else {
        await session.setChecked(locator, resolveValue(step) === 'true');
      }
      break;
    case 'select':
      if (
        interaction !== undefined &&
        session.selectInteraction !== undefined
      ) {
        resolution = await session.selectInteraction(
          interaction,
          resolveValue(step),
        );
      } else {
        await session.select(locator, resolveValue(step));
      }
      break;
    case 'submit':
      if (
        interaction !== undefined &&
        session.submitInteraction !== undefined
      ) {
        resolution = await session.submitInteraction(interaction);
      } else {
        await session.submit(locator);
      }
      break;
  }
  if (interaction === undefined || session.verifyInteraction === undefined) {
    return legacyOutcome(step, locator.strategy);
  }
  let verification = await session.verifyInteraction(interaction);
  if (verification.passed) {
    return {
      stepId: step.id,
      status: resolution?.recovered === true ? 'recovered' : 'verified',
      strategy: resolution?.strategy ?? locator.strategy,
      confidence: resolution?.confidence ?? 0.8,
    };
  }
  const sideEffectObserved =
    (session.sideEffectSequence?.() ?? 0) > beforeSideEffect ||
    session.currentUrl() !== beforeUrl;
  if (
    mode === 'adaptive' &&
    step.type === 'click' &&
    resolution !== undefined &&
    !sideEffectObserved
  ) {
    await session.click(locator);
    verification = await session.verifyInteraction(interaction);
    if (verification.passed) {
      return {
        stepId: step.id,
        status: 'recovered',
        strategy: `semantic-${locator.strategy}`,
        confidence: Math.min(resolution.confidence, 0.75),
      };
    }
  }
  throw new HybridReplayError({
    message: 'The recorded action did not produce its verified post-state.',
    pageId: interaction.pageId,
    framePath: interaction.framePath,
    resolutionAttempts: resolution?.attempts ?? [],
    confidence: resolution?.confidence ?? null,
    expectedState: verification.expected,
    observedState: verification.observed,
    sideEffectObserved,
  });
}

export class UnsupportedSecurityChallengeError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'UnsupportedSecurityChallengeError';
  }
}

export class HybridReplayError extends Error {
  readonly pageId: string;
  readonly framePath: readonly string[];
  readonly resolutionAttempts: readonly string[];
  readonly confidence: number | null;
  readonly expectedState: readonly string[];
  readonly observedState: readonly string[];
  readonly sideEffectObserved: boolean;

  constructor(input: {
    readonly message: string;
    readonly pageId: string;
    readonly framePath: readonly string[];
    readonly resolutionAttempts: readonly string[];
    readonly confidence: number | null;
    readonly expectedState: readonly string[];
    readonly observedState: readonly string[];
    readonly sideEffectObserved: boolean;
  }) {
    super(input.message);
    this.name = 'HybridReplayError';
    this.pageId = input.pageId;
    this.framePath = input.framePath;
    this.resolutionAttempts = input.resolutionAttempts;
    this.confidence = input.confidence;
    this.expectedState = input.expectedState;
    this.observedState = input.observedState;
    this.sideEffectObserved = input.sideEffectObserved;
  }
}

function legacyOutcome(
  step: RecordedJourneyStep,
  strategy: string,
): ReplayInteractionOutcome {
  return {
    stepId: step.id,
    status: 'verified',
    strategy,
    confidence: 0.7,
  };
}

export function preferredReplayLocator(
  step: RecordedJourneyStep,
): ReplayLocator {
  if (step.locator === null)
    throw new Error('Recorded step has no replay locator.');
  if (step.locator.strategy !== 'id' || stableElementId(step.locator.value)) {
    return step.locator;
  }
  return locatorFromFingerprint(step.fingerprint) ?? step.locator;
}

function locatorFromFingerprint(
  fingerprint: TargetFingerprint | null,
): ReplayLocator | null {
  if (fingerprint === null) return null;
  if (fingerprint.dataFormcrash !== null) {
    return {
      strategy: 'data-formcrash',
      value: fingerprint.dataFormcrash,
    };
  }
  if (fingerprint.dataTestId !== null) {
    return { strategy: 'data-testid', value: fingerprint.dataTestId };
  }
  if (fingerprint.id !== null && stableElementId(fingerprint.id)) {
    return { strategy: 'id', value: fingerprint.id };
  }
  if (fingerprint.name !== null) {
    return { strategy: 'name', value: fingerprint.name };
  }
  if (fingerprint.label !== null) {
    return { strategy: 'label', value: fingerprint.label };
  }
  if (fingerprint.role !== null && fingerprint.accessibleName !== null) {
    return {
      strategy: 'role',
      role: fingerprint.role,
      name: fingerprint.accessibleName,
    };
  }
  if (fingerprint.text !== null) {
    return { strategy: 'text', value: fingerprint.text };
  }
  return fingerprint.cssPath === ''
    ? null
    : { strategy: 'css', value: fingerprint.cssPath };
}

function stableElementId(value: string): boolean {
  return (
    value.length <= 100 &&
    !/\d{5,}/u.test(value) &&
    !/^(react|radix|headlessui|:r|_r_)/iu.test(value)
  );
}
