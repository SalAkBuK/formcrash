import type { RunEventLog } from '../engine/event-log.js';
import type { CheckoutBrowserSession } from '../infrastructure/browser-session.js';
import type { ImpatientUserExperimentSummary } from '../sample/types.js';

export type Delay = (milliseconds: number) => Promise<void>;

export const delay: Delay = (milliseconds) =>
  new Promise((resolve) => setTimeout(resolve, milliseconds));

export async function injectImpatientUser(
  session: CheckoutBrowserSession,
  selector: string,
  experiment: ImpatientUserExperimentSummary,
  events: RunEventLog,
  wait: Delay = delay,
): Promise<void> {
  events.append('experiment.injected', {
    experimentType: experiment.experimentType,
    targetStep: experiment.targetStep,
    triggerCount: experiment.triggerCount,
    intervalMs: experiment.intervalMs,
  });

  for (
    let triggerNumber = 1;
    triggerNumber <= experiment.triggerCount;
    triggerNumber += 1
  ) {
    events.append('experiment.triggered', {
      experimentType: experiment.experimentType,
      triggerNumber,
      targetStep: experiment.targetStep,
    });
    await session.click(selector, { force: true });

    if (triggerNumber < experiment.triggerCount) {
      await wait(experiment.intervalMs);
    }
  }
}
