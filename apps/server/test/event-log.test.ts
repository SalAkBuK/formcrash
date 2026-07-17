import { describe, expect, it } from 'vitest';

import { RunEventLog } from '../src/runner/engine/event-log.js';

describe('in-memory run events', () => {
  it('assigns monotonic sequence numbers in append order', () => {
    const events = new RunEventLog('run-1');

    events.append('run.created', {});
    events.append('run.starting', {});
    events.append('browser.launched', {});

    expect(events.snapshot().map((event) => event.sequence)).toEqual([1, 2, 3]);
  });

  it('does not expose an event when durable append fails', () => {
    const events = new RunEventLog('run-1', () => {
      throw new Error('persistence unavailable');
    });

    expect(() => events.append('run.created', {})).toThrow(
      'persistence unavailable',
    );
    expect(events.snapshot()).toEqual([]);
  });
});
