import type { OutcomeCheck } from '@formcrash/contracts';

export function describeOutcomeCheck(check: OutcomeCheck): string {
  if (check.type === 'matching_item_appears_exactly_once') {
    return `Exactly one result matching ${check.binding.template} should appear.`;
  }
  if (check.type === 'final_pathname_matches') {
    return `The journey should finish at ${check.expectedPathname}.`;
  }
  return 'The selected result element should be visible.';
}
