import type { RecordedJourneyStep } from '@formcrash/contracts';

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
  switch (step.type) {
    case 'click':
      await session.click(step.locator);
      return;
    case 'fill':
      await session.fill(step.locator, resolveValue(step));
      return;
    case 'checkbox':
    case 'radio':
      await session.setChecked(step.locator, resolveValue(step) === 'true');
      return;
    case 'select':
      await session.select(step.locator, resolveValue(step));
      return;
    case 'submit':
      await session.submit(step.locator);
      return;
  }
}
