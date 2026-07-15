import type { RunEventEnvelope, RunStatus } from '@formcrash/contracts';

export interface RunExecutionRequest {
  readonly runId: string;
  readonly snapshotId: string;
}

export interface RunExecutionResult {
  readonly finalStatus: Extract<
    RunStatus,
    'passed' | 'failed' | 'incomplete' | 'runner_error'
  >;
  readonly events: readonly RunEventEnvelope[];
}

export interface RunEngine {
  execute(request: RunExecutionRequest): Promise<RunExecutionResult>;
  stop(runId: string): Promise<void>;
}
