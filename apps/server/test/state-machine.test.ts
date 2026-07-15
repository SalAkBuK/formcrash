import { describe, expect, it } from 'vitest';

import {
  InvalidRunTransitionError,
  RunStateTracker,
  canTransitionRun,
} from '../src/runner/engine/state-machine.js';

describe('run state transitions', () => {
  it('accepts the completed-run transitions', () => {
    const tracker = new RunStateTracker();

    tracker.transition('starting');
    tracker.transition('running');
    tracker.transition('evaluating');
    tracker.transition('passed');

    expect(tracker.status).toBe('passed');
    expect(canTransitionRun('evaluating', 'failed')).toBe(true);
  });

  it('rejects invalid transitions', () => {
    const tracker = new RunStateTracker();

    expect(() => tracker.transition('running')).toThrow(
      InvalidRunTransitionError,
    );
    expect(tracker.status).toBe('created');
  });
});
