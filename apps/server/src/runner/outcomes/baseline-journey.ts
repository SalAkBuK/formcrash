import {
  generatedBaselineInputSchema,
  persistedJourneySchema,
  type GeneratedBaselineInput,
  type GeneratedValueExpression,
  type PersistedJourney,
} from '@formcrash/contracts';

export function createOutcomeBaseline(journey: PersistedJourney): {
  readonly journey: PersistedJourney;
  readonly generatedInputs: readonly GeneratedBaselineInput[];
} {
  const generatedInputs: GeneratedBaselineInput[] = [];
  const baselineJourney = persistedJourneySchema.parse({
    ...journey,
    steps: journey.steps.map((step) => {
      if (step.value?.kind !== 'safe' || step.value.value.includes('{{')) {
        return step;
      }
      const expression = generatedExpressionFor(step);
      if (expression === null) return step;
      generatedInputs.push(
        generatedBaselineInputSchema.parse({
          stepId: step.id,
          stepName: step.name,
          expression,
          template: `{{${expression}}}`,
          label: generatedLabel(expression),
        }),
      );
      return {
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
  return { journey: baselineJourney, generatedInputs };
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
  return /(username|reference|passport|emirates|identifier|number|code)/u.test(
    descriptor,
  )
    ? 'unique.text'
    : null;
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
