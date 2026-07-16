import type {
  RecordedJourneyStep,
  ReplayLocator,
  TargetFingerprint,
} from '@formcrash/contracts';

import type { ReplayBrowserSession } from '../recording/external-browser.js';

export async function executeRecordedStep(
  session: ReplayBrowserSession,
  step: RecordedJourneyStep,
  resolveValue: (step: RecordedJourneyStep) => string,
): Promise<void> {
  if (step.type === 'navigate') {
    await session.navigate(step.url);
    return;
  }
  if (step.locator === null) throw new Error('Recorded step has no locator.');
  const locator = preferredReplayLocator(step);
  switch (step.type) {
    case 'click':
      await session.click(locator);
      return;
    case 'fill':
      await session.fill(locator, resolveValue(step));
      return;
    case 'checkbox':
    case 'radio':
      await session.setChecked(locator, resolveValue(step) === 'true');
      return;
    case 'select':
      await session.select(locator, resolveValue(step));
      return;
    case 'submit':
      await session.submit(locator);
      return;
  }
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
