import type {
  SampleJourneyActionType,
  SampleJourneyStepSummary,
} from '../sample/types.js';

interface BaseStep {
  readonly id: string;
  readonly name: string;
}

export interface NavigateStep extends BaseStep {
  readonly action: {
    readonly type: 'navigate';
    readonly path: string;
  };
}

export interface ClickStep extends BaseStep {
  readonly action: {
    readonly type: 'click';
    readonly selector: string;
  };
}

export interface FillStep extends BaseStep {
  readonly action: {
    readonly type: 'fill';
    readonly selector: string;
    readonly value: string;
  };
}

export interface WaitForVisibleStep extends BaseStep {
  readonly action: {
    readonly type: 'wait_for_visible';
    readonly selector: string;
  };
}

export interface InjectImpatientUserStep extends BaseStep {
  readonly action: {
    readonly type: 'inject_impatient_user';
    readonly selector: string;
  };
}

export interface ReadTestStateStep extends BaseStep {
  readonly action: {
    readonly type: 'read_test_state';
  };
}

export type SampleJourneyStep =
  | NavigateStep
  | ClickStep
  | FillStep
  | WaitForVisibleStep
  | InjectImpatientUserStep
  | ReadTestStateStep;

export function summarizeStep(
  step: SampleJourneyStep,
): SampleJourneyStepSummary {
  const selector = 'selector' in step.action ? step.action.selector : null;
  const path = 'path' in step.action ? step.action.path : null;

  return {
    id: step.id,
    name: step.name,
    actionType: step.action.type satisfies SampleJourneyActionType,
    selector,
    path,
  };
}
