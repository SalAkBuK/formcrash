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

export function canTransitionRun(from: RunStatus, to: RunStatus): boolean {
  return (allowedTransitions[from] as readonly RunStatus[]).includes(to);
}
