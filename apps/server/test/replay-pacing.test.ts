import { describe, expect, it } from 'vitest';
import type {
  RecordedInteraction,
  RecordedJourneyStep,
} from '@formcrash/contracts';

import { replayStepDelayMs } from '../src/runner/recording/replay-pacing.js';

const previousStep = step('previous', 1_000);
const currentStep = step('current', 3_500);

describe('replay pacing', () => {
  it('adds no delay in fast mode', () => {
    expect(
      replayStepDelayMs({
        pacing: 'fast',
        step: currentStep,
        previousStep,
      }),
    ).toBe(0);
  });

  it('waits one second before every deliberate action', () => {
    expect(replayStepDelayMs({ pacing: 'deliberate', step: currentStep })).toBe(
      1_000,
    );
  });

  it('preserves the recorded idle gap after the prior interaction', () => {
    expect(
      replayStepDelayMs({
        pacing: 'recorded',
        step: currentStep,
        previousStep,
        interaction: interaction('current', 3_500, 100),
        previousInteraction: interaction('previous', 1_000, 400),
      }),
    ).toBe(2_100);
  });

  it('caps long recorded pauses at five seconds', () => {
    expect(
      replayStepDelayMs({
        pacing: 'recorded',
        step: step('late', 30_000),
        previousStep,
      }),
    ).toBe(5_000);
  });
});

function step(id: string, timestamp: number): RecordedJourneyStep {
  return {
    id,
    name: id,
    type: 'click',
    timestamp,
    url: 'https://example.test/',
    locator: { strategy: 'id', value: id },
    fingerprint: null,
    value: null,
    sensitive: false,
  };
}

function interaction(
  stepId: string,
  startedAt: number,
  durationMs: number,
): RecordedInteraction {
  return {
    id: `interaction-${stepId}`,
    stepId,
    sequence: stepId === 'previous' ? 1 : 2,
    pageId: 'page-1',
    framePath: [],
    startedAt,
    durationMs,
    intent: 'click',
    pointerType: 'mouse',
    targetCandidates: [],
    fingerprint: null,
    geometry: null,
    postconditions: [],
    retrySafety: 'safe',
  };
}
