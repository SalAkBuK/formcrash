import type { RunEventEnvelope } from '@formcrash/contracts';

export type JsonValue =
  | null
  | boolean
  | number
  | string
  | JsonValue[]
  | { readonly [key: string]: JsonValue };

export class RunEventLog {
  private readonly events: RunEventEnvelope[] = [];
  private readonly startedAt = performance.now();

  constructor(
    private readonly runId: string,
    private readonly onAppend?: (event: RunEventEnvelope) => void,
  ) {}

  append(eventType: string, payload: JsonValue): RunEventEnvelope {
    const sequence = this.events.length + 1;
    const event: RunEventEnvelope = {
      eventId: `${this.runId}-event-${String(sequence).padStart(4, '0')}`,
      runId: this.runId,
      eventType,
      sequence,
      relativeTimestampMs: Math.max(
        0,
        Math.round(performance.now() - this.startedAt),
      ),
      recordedAt: new Date().toISOString(),
      schemaVersion: 1,
      payload,
    };
    this.onAppend?.(event);
    this.events.push(event);
    return event;
  }

  snapshot(): readonly RunEventEnvelope[] {
    return structuredClone(this.events);
  }
}
