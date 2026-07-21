import type { PersistedJourney } from '@formcrash/contracts';

export function guidedStepValueOverrides(
  journey: PersistedJourney,
): Readonly<Record<string, string>> {
  const overrides: Record<string, string> = {};
  for (const step of journey.steps) {
    if (step.value?.kind !== 'safe' || step.value.value.includes('{{')) {
      continue;
    }
    const descriptor = stepDescriptor(step);
    if (descriptor.includes('email')) {
      overrides[step.id] = '{{unique.email}}';
    } else if (
      descriptor.includes('phone') ||
      descriptor.includes('mobile') ||
      step.fingerprint?.inputType === 'tel'
    ) {
      overrides[step.id] = '{{unique.phone}}';
    } else if (
      descriptor.includes('name') &&
      !descriptor.includes('username')
    ) {
      overrides[step.id] = '{{unique.name}}';
    } else if (
      /(username|reference|passport|emirates|identifier|number|code)/u.test(
        descriptor,
      )
    ) {
      overrides[step.id] = '{{unique.text}}';
    }
  }
  return overrides;
}

function stepDescriptor(step: PersistedJourney['steps'][number]): string {
  return [
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
}
