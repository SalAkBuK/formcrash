import {
  isTerminalRunStatus,
  sseRunEventSchema,
  type RunEventEnvelope,
} from '@formcrash/contracts';
import type { FastifyReply, FastifyRequest } from 'fastify';

import type { RunEventBroker } from '../../events/run-event-broker.js';
import type { RunRepository } from '../../persistence/run-repository.js';

const HEARTBEAT_INTERVAL_MS = 15_000;

export function streamRunEvents(
  request: FastifyRequest,
  reply: FastifyReply,
  runId: string,
  afterSequence: number,
  repository: RunRepository,
  broker: RunEventBroker,
): void {
  const initialStatus = repository.getRunStatus(runId);
  if (initialStatus === null) {
    void reply.status(404).send({
      error: {
        code: 'RUN_NOT_FOUND',
        message: 'The requested run was not found.',
      },
    });
    return;
  }

  reply.hijack();
  const response = reply.raw;
  response.statusCode = 200;
  response.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
  response.setHeader('Cache-Control', 'no-cache, no-transform');
  response.setHeader('Connection', 'keep-alive');
  response.setHeader('X-Accel-Buffering', 'no');
  response.flushHeaders();

  let lastSentSequence = afterSequence;
  let ended = false;
  let heartbeat: NodeJS.Timeout | null = null;
  let unsubscribe: () => void = () => undefined;

  const cleanup = (): void => {
    if (ended) return;
    ended = true;
    if (heartbeat !== null) clearInterval(heartbeat);
    unsubscribe();
  };
  const end = (): void => {
    if (ended) return;
    cleanup();
    response.end();
  };
  const send = (eventInput: RunEventEnvelope): void => {
    if (ended || eventInput.sequence <= lastSentSequence) return;
    const event = sseRunEventSchema.parse(eventInput);
    response.write(encodeSseEvent(event));
    lastSentSequence = event.sequence;
  };
  const replayPersisted = (): void => {
    for (const event of repository.getEventsAfter(runId, lastSentSequence)) {
      send(event);
    }
  };
  const finishTerminalStream = (): void => {
    if (ended) return;
    replayPersisted();
    end();
  };

  unsubscribe = broker.subscribe(runId, {
    onEvent: send,
    onTerminal: finishTerminalStream,
    onServerClose: end,
  });
  request.raw.once('close', cleanup);

  replayPersisted();
  const currentStatus = repository.getRunStatus(runId);
  if (currentStatus !== null && isTerminalRunStatus(currentStatus)) {
    end();
    return;
  }

  heartbeat = setInterval(() => {
    if (!ended) response.write(': heartbeat\n\n');
  }, HEARTBEAT_INTERVAL_MS);
  heartbeat.unref();
}

export function parseLastEventId(value: string | undefined): number {
  if (value === undefined || value === '') return 0;
  if (!/^\d+$/u.test(value)) {
    throw new Error('Last-Event-ID must be a non-negative integer.');
  }
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed)) {
    throw new Error('Last-Event-ID is outside the supported range.');
  }
  return parsed;
}

export function encodeSseEvent(eventInput: RunEventEnvelope): string {
  const event = sseRunEventSchema.parse(eventInput);
  return `id: ${event.sequence}\nevent: run-event\ndata: ${JSON.stringify(event)}\n\n`;
}
