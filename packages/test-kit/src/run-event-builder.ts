import type { RunEventEnvelope } from '@formcrash/contracts';

let eventSequence = 0;

export function buildRunEvent(
  overrides: Partial<RunEventEnvelope> = {},
): RunEventEnvelope {
  eventSequence += 1;

  return {
    eventId: `test-event-${eventSequence}`,
    runId: 'test-run-1',
    eventType: 'test.event',
    relativeTimestampMs: 0,
    recordedAt: '2026-01-01T00:00:00.000Z',
    schemaVersion: 1,
    payload: {},
    ...overrides,
  };
}
