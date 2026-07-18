import type {
  RecordedInteraction,
  RecordedJourneyStep,
  ReplayPacing,
} from '@formcrash/contracts';

import type { ReplayBrowserSession } from './external-browser.js';

const DELIBERATE_DELAY_MS = 1_000;
const MAX_RECORDED_DELAY_MS = 5_000;

export async function paceReplayStep(input: {
  readonly session: ReplayBrowserSession;
  readonly pacing: ReplayPacing;
  readonly step: RecordedJourneyStep;
  readonly interaction?: RecordedInteraction;
  readonly previousStep?: RecordedJourneyStep;
  readonly previousInteraction?: RecordedInteraction;
}): Promise<number> {
  const milliseconds = replayStepDelayMs(input);
  if (milliseconds > 0) await input.session.settle(milliseconds);
  return milliseconds;
}

export function replayStepDelayMs(input: {
  readonly pacing: ReplayPacing;
  readonly step: RecordedJourneyStep;
  readonly interaction?: RecordedInteraction;
  readonly previousStep?: RecordedJourneyStep;
  readonly previousInteraction?: RecordedInteraction;
}): number {
  if (input.pacing === 'fast') return 0;
  if (input.pacing === 'deliberate') return DELIBERATE_DELAY_MS;
  if (input.previousStep === undefined) return 0;

  const currentStartedAt = input.interaction?.startedAt ?? input.step.timestamp;
  const previousStartedAt =
    input.previousInteraction?.startedAt ?? input.previousStep.timestamp;
  const previousDuration = input.previousInteraction?.durationMs ?? 0;
  return Math.min(
    MAX_RECORDED_DELAY_MS,
    Math.max(0, currentStartedAt - previousStartedAt - previousDuration),
  );
}
