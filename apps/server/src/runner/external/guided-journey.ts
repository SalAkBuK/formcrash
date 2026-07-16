import {
  persistedJourneySchema,
  type PersistedJourney,
} from '@formcrash/contracts';

export function createGuidedJourneySnapshot(
  journey: PersistedJourney,
  overrides: Readonly<Record<string, string>>,
  normalize: boolean,
): PersistedJourney {
  const steps = journey.steps.map((step) => {
    const override = overrides[step.id];
    if (override === undefined) return step;
    if (step.value?.kind !== 'safe') {
      throw new Error(
        `Step value override ${step.id} does not target a safe recorded value.`,
      );
    }
    return {
      ...step,
      value: { kind: 'safe' as const, value: override },
    };
  });
  for (const stepId of Object.keys(overrides)) {
    if (!journey.steps.some((step) => step.id === stepId)) {
      throw new Error(`Step value override ${stepId} was not found.`);
    }
  }
  const normalized = normalize ? normalizeJourneySteps(steps) : steps;
  return persistedJourneySchema.parse({
    ...journey,
    steps: normalized,
    recordingMetadata: {
      ...journey.recordingMetadata,
      normalizationRule: normalize
        ? `${journey.recordingMetadata.normalizationRule} Guided Test also removed exact consecutive navigation duplicates and coalesced adjacent fills for the same locator.`
        : journey.recordingMetadata.normalizationRule,
    },
  });
}

function normalizeJourneySteps(
  steps: PersistedJourney['steps'],
): PersistedJourney['steps'] {
  const normalized: PersistedJourney['steps'][number][] = [];
  for (const step of steps) {
    const previous = normalized.at(-1);
    if (
      step.type === 'navigate' &&
      previous?.type === 'navigate' &&
      step.url === previous.url
    ) {
      continue;
    }
    if (
      step.type === 'fill' &&
      previous?.type === 'fill' &&
      step.locator !== null &&
      JSON.stringify(step.locator) === JSON.stringify(previous.locator)
    ) {
      normalized[normalized.length - 1] = step;
      continue;
    }
    normalized.push(step);
  }
  return normalized;
}
