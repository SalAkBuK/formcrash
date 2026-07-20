import type { OutcomeCheck, OutcomeCheckType } from '@formcrash/contracts';

export function describeOutcomeCheck(check: OutcomeCheck): string {
  if (check.type === 'matching_item_appears_exactly_once') {
    return `Exactly one result matching ${check.binding.template} should appear.`;
  }
  if (check.type === 'final_pathname_matches') {
    return `The journey should finish at ${check.expectedPathname}.`;
  }
  return 'The selected result element should be visible.';
}

export function defaultOutcomeCheckDescription(
  type: OutcomeCheckType,
  finalPathname: string | null,
): string {
  if (type === 'matching_item_appears_exactly_once') {
    return 'Exactly one matching item should appear.';
  }
  if (type === 'final_pathname_matches') {
    return finalPathname === null
      ? 'The journey should finish at the captured pathname.'
      : `The journey should finish at ${finalPathname}.`;
  }
  return 'The selected result element should be visible.';
}

export function outcomeCheckTypeLabel(type: OutcomeCheckType): string {
  if (type === 'matching_item_appears_exactly_once') {
    return 'Matching item appears exactly once';
  }
  if (type === 'final_pathname_matches') return 'Final pathname matches';
  return 'Visible element exists';
}
