import type { RunStatus } from '@formcrash/contracts';

const allowedTransitions = {
  created: ['starting'],
  starting: ['running', 'runner_error'],
  running: ['evaluating', 'stopping', 'runner_error'],
  evaluating: ['passed', 'failed', 'runner_error'],
  stopping: ['incomplete'],
  passed: [],
  failed: [],
  incomplete: [],
  runner_error: [],
} as const satisfies Record<RunStatus, readonly RunStatus[]>;

export class InvalidRunTransitionError extends Error {
  constructor(from: RunStatus, to: RunStatus) {
    super(`Invalid run transition: ${from} -> ${to}.`);
    this.name = 'InvalidRunTransitionError';
  }
}

export function canTransitionRun(from: RunStatus, to: RunStatus): boolean {
  return (allowedTransitions[from] as readonly RunStatus[]).includes(to);
}

export class RunStateTracker {
  private currentStatus: RunStatus = 'created';

  get status(): RunStatus {
    return this.currentStatus;
  }

  transition(to: RunStatus): void {
    if (!canTransitionRun(this.currentStatus, to)) {
      throw new InvalidRunTransitionError(this.currentStatus, to);
    }
    this.currentStatus = to;
  }
}
