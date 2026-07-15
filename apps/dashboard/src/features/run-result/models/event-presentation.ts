import type { RunEventEnvelope, RunStatus } from '@formcrash/contracts';

import { sentenceCase } from '../../../lib/formatters';

export type EventCategory =
  | 'run'
  | 'journey'
  | 'request'
  | 'disruption'
  | 'assertion'
  | 'artifact'
  | 'error'
  | 'browser'
  | 'other';

export interface EventPresentation {
  readonly category: EventCategory;
  readonly label: string;
  readonly summary: string;
}

export function presentRunEvent(event: RunEventEnvelope): EventPresentation {
  const payload = event.payload;
  switch (event.eventType) {
    case 'journey.step.started':
      return {
        category: 'journey',
        label: 'Journey step started',
        summary:
          readString(payload, 'stepName') ?? 'A saved journey step began.',
      };
    case 'journey.step.completed':
      return {
        category: 'journey',
        label: 'Journey step completed',
        summary:
          readString(payload, 'stepName') ?? 'A saved journey step completed.',
      };
    case 'experiment.injected':
      return {
        category: 'disruption',
        label: 'Impatient User disruption active',
        summary: `Submit Order will be triggered ${readNumber(payload, 'triggerCount') ?? 2} times, ${readNumber(payload, 'intervalMs') ?? 100} ms apart.`,
      };
    case 'experiment.triggered':
      return {
        category: 'disruption',
        label: 'Disruption trigger issued',
        summary: `Trigger ${readNumber(payload, 'triggerNumber') ?? '?'} targeted Submit Order.`,
      };
    case 'request.started':
      return {
        category: 'request',
        label: 'Order request started',
        summary: `${readString(payload, 'method') ?? 'POST'} ${readString(payload, 'path') ?? '/api/orders'}`,
      };
    case 'request.completed': {
      const statusCode = readNumber(payload, 'statusCode');
      return {
        category: 'request',
        label: 'Order request completed',
        summary:
          statusCode === null
            ? 'The observed order request did not return a status.'
            : `The order request returned HTTP ${statusCode}.`,
      };
    }
    case 'assertion.evaluating':
      return {
        category: 'assertion',
        label: 'Recovery assertion evaluating',
        summary: 'Checking that no more than one order was created.',
      };
    case 'assertion.passed':
    case 'assertion.failed':
      return {
        category: 'assertion',
        label:
          event.eventType === 'assertion.passed'
            ? 'Recovery assertion passed'
            : 'Recovery assertion failed',
        summary: `${readNumber(payload, 'observedCount') ?? '?'} created orders observed; maximum allowed is 1.`,
      };
    case 'artifact.captured':
      return {
        category: 'artifact',
        label: 'Screenshot captured',
        summary: `${formatArtifactLabel(readString(payload, 'label'))} evidence was persisted.`,
      };
    case 'artifact.capture_failed':
      return {
        category: 'error',
        label: 'Screenshot unavailable',
        summary:
          readString(payload, 'message') ??
          'Screenshot capture did not complete.',
      };
    case 'runner.error':
      return {
        category: 'error',
        label: 'Runner error',
        summary:
          readString(payload, 'message') ??
          'The controlled browser run stopped.',
      };
    default:
      return presentGenericEvent(event);
  }
}

export function currentJourneyStep(
  events: readonly RunEventEnvelope[],
): string | null {
  for (let index = events.length - 1; index >= 0; index -= 1) {
    const event = events[index];
    if (event?.eventType === 'journey.step.started') {
      return readString(event.payload, 'stepName');
    }
  }
  return null;
}

export function countEvents(
  events: readonly RunEventEnvelope[],
  eventType: string,
): number {
  return events.filter((event) => event.eventType === eventType).length;
}

export function mergeRunEvents(
  current: readonly RunEventEnvelope[],
  incoming: RunEventEnvelope,
): readonly RunEventEnvelope[] {
  const bySequence = new Map(current.map((event) => [event.sequence, event]));
  bySequence.set(incoming.sequence, incoming);
  return [...bySequence.values()].sort(
    (left, right) => left.sequence - right.sequence,
  );
}

export function deriveRunStatus(
  events: readonly RunEventEnvelope[],
  persistedStatus: RunStatus,
): RunStatus {
  const mapping: Readonly<Record<string, RunStatus>> = {
    'run.created': 'created',
    'run.starting': 'starting',
    'run.running': 'running',
    'run.evaluating': 'evaluating',
    'run.passed': 'passed',
    'run.failed': 'failed',
    'run.incomplete': 'incomplete',
    'runner.error': 'runner_error',
  };
  for (let index = events.length - 1; index >= 0; index -= 1) {
    const event = events[index];
    if (event === undefined) continue;
    const status = mapping[event.eventType];
    if (status !== undefined) return status;
  }
  return persistedStatus;
}

function presentGenericEvent(event: RunEventEnvelope): EventPresentation {
  const prefix = event.eventType.split('.')[0];
  const category: EventCategory =
    prefix === 'run'
      ? 'run'
      : prefix === 'journey'
        ? 'journey'
        : prefix === 'browser'
          ? 'browser'
          : 'other';
  return {
    category,
    label: sentenceCase(event.eventType),
    summary: 'Persisted run event.',
  };
}

function readString(value: unknown, key: string): string | null {
  if (typeof value !== 'object' || value === null || !(key in value))
    return null;
  const property = value[key as keyof typeof value];
  return typeof property === 'string' ? property : null;
}

function readNumber(value: unknown, key: string): number | null {
  if (typeof value !== 'object' || value === null || !(key in value))
    return null;
  const property = value[key as keyof typeof value];
  return typeof property === 'number' ? property : null;
}

function formatArtifactLabel(value: string | null): string {
  if (value === null) return 'Screenshot';
  return sentenceCase(value.replaceAll('-', ' '));
}
