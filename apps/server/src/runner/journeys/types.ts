import type {
  SampleJourneyStep,
  SampleJourneyStepSummary,
} from '@formcrash/contracts';

export type { SampleJourneyStep };

export function summarizeStep(
  step: SampleJourneyStep,
): SampleJourneyStepSummary {
  const selector = 'selector' in step.action ? step.action.selector : null;
  const path = 'path' in step.action ? step.action.path : null;

  return {
    id: step.id,
    name: step.name,
    actionType: step.action.type,
    selector,
    path,
  };
}
