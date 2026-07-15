import type { RunEventLog } from '../engine/event-log.js';
import type { CheckoutBrowserSession } from '../infrastructure/browser-session.js';
import {
  IMPATIENT_USER_EXPERIMENT,
  SAMPLE_CHECKOUT_JOURNEY,
} from '../journeys/sample-checkout.js';
import type { SampleJourneyStep } from '../journeys/types.js';
import { summarizeStep } from '../journeys/types.js';
import type { Delay } from '../injectors/impatient-user.js';
import { delay, injectImpatientUser } from '../injectors/impatient-user.js';
import type { SampleApplicationState, SampleRunMode } from '../sample/types.js';

export class JourneyStepExecutionError extends Error {
  readonly step;

  constructor(failedStep: SampleJourneyStep, cause: unknown) {
    super(
      `Journey step “${failedStep.name}” failed.`,
      cause === undefined ? undefined : { cause },
    );
    this.name = 'JourneyStepExecutionError';
    const summary = summarizeStep(failedStep);
    this.step = {
      stepId: summary.id,
      stepName: summary.name,
      actionType: summary.actionType,
      selector: summary.selector,
      path: summary.path,
    };
  }
}

export interface JourneyExecutionOptions {
  readonly baseUrl: string;
  readonly mode: SampleRunMode;
  readonly timeoutMs: number;
  readonly wait?: Delay;
}

export async function executeSampleJourney(
  session: CheckoutBrowserSession,
  events: RunEventLog,
  options: JourneyExecutionOptions,
): Promise<SampleApplicationState> {
  let finalState: SampleApplicationState | null = null;

  for (const step of SAMPLE_CHECKOUT_JOURNEY) {
    const summary = summarizeStep(step);
    events.append('journey.step.started', {
      stepId: summary.id,
      stepName: summary.name,
      actionType: summary.actionType,
      selector: summary.selector,
      path: summary.path,
    });

    try {
      const state = await executeStep(session, step, events, options);
      if (state !== null) finalState = state;
    } catch (error: unknown) {
      throw new JourneyStepExecutionError(step, error);
    }

    events.append('journey.step.completed', {
      stepId: summary.id,
      stepName: summary.name,
      actionType: summary.actionType,
    });
  }

  if (finalState === null) {
    throw new Error(
      'The hardcoded journey completed without reading sample state.',
    );
  }
  return finalState;
}

async function executeStep(
  session: CheckoutBrowserSession,
  step: SampleJourneyStep,
  events: RunEventLog,
  options: JourneyExecutionOptions,
): Promise<SampleApplicationState | null> {
  switch (step.action.type) {
    case 'navigate': {
      const target = new URL(step.action.path, options.baseUrl);
      target.searchParams.set('mode', options.mode);
      await session.navigate(target.toString());
      return null;
    }
    case 'click':
      await session.click(step.action.selector);
      return null;
    case 'fill':
      await session.fill(step.action.selector, step.action.value);
      return null;
    case 'wait_for_visible':
      await session.waitForVisible(step.action.selector);
      return null;
    case 'inject_impatient_user':
      await injectImpatientUser(
        session,
        step.action.selector,
        IMPATIENT_USER_EXPERIMENT,
        events,
        options.wait ?? delay,
      );
      return null;
    case 'read_test_state':
      return waitForSettledState(
        session,
        options.mode,
        options.timeoutMs,
        options.wait ?? delay,
      );
  }
}

async function waitForSettledState(
  session: CheckoutBrowserSession,
  mode: SampleRunMode,
  timeoutMs: number,
  wait: Delay,
): Promise<SampleApplicationState> {
  const deadline = Date.now() + timeoutMs;

  while (Date.now() <= deadline) {
    const state = await session.readSampleState();
    const expectedStateReached =
      mode === 'vulnerable'
        ? state.counts.requests >= 2 && state.counts.orders >= 2
        : state.counts.requests >= 1 && state.counts.orders === 1;

    if (expectedStateReached && session.pendingOrderRequestCount() === 0) {
      return state;
    }
    await wait(50);
  }

  throw new Error(
    `Sample checkout did not reach a settled ${mode} state within ${timeoutMs} ms.`,
  );
}
