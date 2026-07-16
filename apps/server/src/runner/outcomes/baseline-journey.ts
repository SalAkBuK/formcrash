import {
  persistedJourneySchema,
  type GeneratedValueExpression,
  type PersistedJourney,
} from '@formcrash/contracts';

export function createBaselineJourney(
  journey: PersistedJourney,
): PersistedJourney {
  return persistedJourneySchema.parse({
    ...journey,
    steps: journey.steps.map((step) => {
      if (step.value?.kind !== 'safe' || step.value.value.includes('{{')) {
        return step;
      }
      const expression = generatedExpressionFor(step);
      return expression === null
        ? step
        : {
            ...step,
            value: {
              kind: 'safe' as const,
              value: `{{${expression}}}`,
            },
          };
    }),
    recordingMetadata: {
      ...journey.recordingMetadata,
      normalizationRule: `${journey.recordingMetadata.normalizationRule} Outcome baseline replay replaces common safe identity fields with run-specific generated templates.`,
    },
  });
}

function generatedExpressionFor(
  step: PersistedJourney['steps'][number],
): GeneratedValueExpression | null {
  const descriptor = [
    step.fingerprint?.inputType,
    step.fingerprint?.name,
    step.fingerprint?.label,
    step.fingerprint?.accessibleName,
    step.fingerprint?.id,
    step.name,
  ]
    .filter((value): value is string => value !== null && value !== undefined)
    .join(' ')
    .toLowerCase();
  if (descriptor.includes('email')) return 'unique.email';
  if (
    descriptor.includes('phone') ||
    descriptor.includes('mobile') ||
    step.fingerprint?.inputType === 'tel'
  ) {
    return 'unique.phone';
  }
  if (descriptor.includes('name') && !descriptor.includes('username')) {
    return 'unique.name';
  }
  return /(username|reference|passport|emirates|identifier|number)/u.test(
    descriptor,
  )
    ? 'unique.text'
    : null;
}
