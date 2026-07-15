import type {
  AssertionResultStatus,
  RunEventEnvelope,
  RunStatus,
} from '@formcrash/contracts';

export type SampleRunMode = 'vulnerable' | 'fixed';

export type SampleJourneyActionType =
  | 'navigate'
  | 'click'
  | 'fill'
  | 'wait_for_visible'
  | 'inject_impatient_user'
  | 'read_test_state';

export interface SampleJourneyStepSummary {
  readonly id: string;
  readonly name: string;
  readonly actionType: SampleJourneyActionType;
  readonly selector: string | null;
  readonly path: string | null;
}

export interface SampleJourneySummary {
  readonly id: 'sample-checkout-priority-0';
  readonly name: 'Sample checkout order submission';
  readonly steps: readonly SampleJourneyStepSummary[];
}

export interface ImpatientUserExperimentSummary {
  readonly experimentType: 'impatient_user';
  readonly triggerCount: 2;
  readonly intervalMs: 100;
  readonly targetStep: 'submit-order';
}

export interface CreatedOrdersAssertionResult {
  readonly assertionType: 'max_created_orders';
  readonly expectedMaximum: 1;
  readonly observedCount: number | null;
  readonly status: AssertionResultStatus;
  readonly expectedDescription: 'No more than one order should be created.';
  readonly observedDescription: string;
}

export interface BrowserRequestEvidence {
  readonly requestId: string;
  readonly method: 'POST';
  readonly path: '/api/orders';
  readonly startedAtMs: number;
  readonly completedAtMs: number | null;
  readonly statusCode: number | null;
  readonly failed: boolean;
}

export interface SampleObservedState {
  readonly browserOrderRequestCount: number;
  readonly requestAttemptCount: number;
  readonly acceptedCount: number;
  readonly deduplicatedCount: number;
  readonly rejectedCount: number;
  readonly createdOrderCount: number;
  readonly orderIds: readonly string[];
  readonly requests: readonly BrowserRequestEvidence[];
}

export interface FailedJourneyStep {
  readonly stepId: string;
  readonly stepName: string;
  readonly actionType: SampleJourneyActionType;
  readonly selector: string | null;
  readonly path: string | null;
}

export interface SampleRunnerError {
  readonly code:
    | 'target_unavailable'
    | 'browser_launch_failed'
    | 'journey_step_failed'
    | 'browser_cleanup_failed'
    | 'runner_failure';
  readonly message: string;
  readonly failedStep: FailedJourneyStep | null;
}

export interface SampleRunResult {
  readonly runId: string;
  readonly status: Extract<RunStatus, 'passed' | 'failed' | 'runner_error'>;
  readonly mode: SampleRunMode;
  readonly startedAt: string;
  readonly completedAt: string;
  readonly durationMs: number;
  readonly journey: SampleJourneySummary;
  readonly experiment: ImpatientUserExperimentSummary;
  readonly assertions: readonly [CreatedOrdersAssertionResult];
  readonly events: readonly RunEventEnvelope[];
  readonly observed: SampleObservedState | null;
  readonly runnerError: SampleRunnerError | null;
}

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
