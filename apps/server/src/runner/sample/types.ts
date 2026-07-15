import type {
  BrowserRequestEvidence,
  CreatedOrdersAssertionResult,
  FailedJourneyStep,
  ImpatientUserExperiment,
  PersistedRunDetail,
  SampleJourneyStepSummary,
  SampleJourneySummary,
  SampleObservedState,
  SampleRunnerError,
  SampleRunMode,
} from '@formcrash/contracts';

export type {
  BrowserRequestEvidence,
  CreatedOrdersAssertionResult,
  FailedJourneyStep,
  SampleJourneyStepSummary,
  SampleJourneySummary,
  SampleObservedState,
  SampleRunnerError,
  SampleRunMode,
};

export type SampleJourneyActionType = SampleJourneyStepSummary['actionType'];
export type ImpatientUserExperimentSummary = ImpatientUserExperiment;
export type SampleRunResult = PersistedRunDetail;

export interface SampleRunExecutor {
  run(mode: SampleRunMode): Promise<SampleRunResult>;
}

export interface SampleApplicationState {
  readonly counts: {
    readonly orders: number;
    readonly requests: number;
    readonly accepted: number;
    readonly deduplicated: number;
    readonly rejected: number;
  };
  readonly orders: readonly { readonly id: string }[];
}
