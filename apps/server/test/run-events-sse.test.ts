import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  runEventEnvelopeSchema,
  type RunEventEnvelope,
  type RunStatus,
} from '@formcrash/contracts';

import { createApp } from '../src/app/create-app.js';
import { RunEventBroker } from '../src/events/run-event-broker.js';
import { initializePersistence } from '../src/persistence/initialize.js';
import { RunRepository } from '../src/persistence/run-repository.js';
import { createTemporaryTestConfig } from './fixtures.js';

const cleanups: Array<() => Promise<void> | void> = [];

afterEach(async () => {
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup();
});

describe('persisted run SSE', () => {
  it('replays persisted events, streams new events, and resumes by sequence ID', async () => {
    const context = createSseContext();
    createRun(context.repository, 'sse-run');
    persistAndPublish(context, event('sse-run', 1, 'run.created'), false);
    persistAndPublish(context, event('sse-run', 2, 'run.starting'), false);

    const streamPromise = context.app.inject({
      method: 'GET',
      url: '/api/runs/sse-run/events',
    });
    await vi.waitFor(() =>
      expect(context.broker.subscriberCount('sse-run')).toBe(1),
    );

    persistAndPublish(context, event('sse-run', 3, 'request.started'));
    setStatus(context, 'sse-run', 'failed');
    persistAndPublish(context, event('sse-run', 4, 'run.failed'));
    context.broker.complete('sse-run');

    const stream = await streamPromise;
    expect(stream.statusCode).toBe(200);
    expect(stream.headers['content-type']).toContain('text/event-stream');
    expect(parseFrames(stream.body).map((item) => item.id)).toEqual([
      1, 2, 3, 4,
    ]);
    expect(parseFrames(stream.body).map((item) => item.event.sequence)).toEqual(
      [1, 2, 3, 4],
    );
    expect(context.broker.subscriberCount('sse-run')).toBe(0);

    const resumed = await context.app.inject({
      method: 'GET',
      url: '/api/runs/sse-run/events',
      headers: { 'last-event-id': '2' },
    });
    expect(parseFrames(resumed.body).map((item) => item.id)).toEqual([3, 4]);
  });

  it('returns normal errors before opening an event stream', async () => {
    const context = createSseContext();

    expect(
      (
        await context.app.inject({
          method: 'GET',
          url: '/api/runs/unknown/events',
        })
      ).statusCode,
    ).toBe(404);
    createRun(context.repository, 'known-run');
    expect(
      (
        await context.app.inject({
          method: 'GET',
          url: '/api/runs/known-run/events',
          headers: { 'last-event-id': 'invalid' },
        })
      ).statusCode,
    ).toBe(400);
  });

  it('terminates a runner-error stream with its partial persisted timeline', async () => {
    const context = createSseContext();
    createRun(context.repository, 'runner-error-run');
    persistAndPublish(
      context,
      event('runner-error-run', 1, 'run.created'),
      false,
    );
    setStatus(context, 'runner-error-run', 'runner_error');
    persistAndPublish(
      context,
      event('runner-error-run', 2, 'runner.error'),
      false,
    );

    const response = await context.app.inject({
      method: 'GET',
      url: '/api/runs/runner-error-run/events',
    });

    expect(
      parseFrames(response.body).map((item) => item.event.eventType),
    ).toEqual(['run.created', 'runner.error']);
  });

  it('removes the subscription when a network client disconnects', async () => {
    const context = createSseContext();
    createRun(context.repository, 'disconnect-run');
    const address = await context.app.listen({ host: '127.0.0.1', port: 0 });
    const controller = new AbortController();
    const response = await fetch(`${address}/api/runs/disconnect-run/events`, {
      signal: controller.signal,
    });
    expect(response.status).toBe(200);
    await vi.waitFor(() =>
      expect(context.broker.subscriberCount('disconnect-run')).toBe(1),
    );

    controller.abort();
    await vi.waitFor(() =>
      expect(context.broker.subscriberCount('disconnect-run')).toBe(0),
    );
  });

  it('closes open SSE responses during server shutdown', async () => {
    const context = createSseContext();
    createRun(context.repository, 'shutdown-run');
    const address = await context.app.listen({ host: '127.0.0.1', port: 0 });
    const response = await fetch(`${address}/api/runs/shutdown-run/events`);
    if (response.body === null)
      throw new Error('SSE response body is missing.');
    const reader = response.body.getReader();
    await vi.waitFor(() =>
      expect(context.broker.subscriberCount('shutdown-run')).toBe(1),
    );

    await context.app.close();
    expect((await reader.read()).done).toBe(true);
    expect(context.broker.subscriberCount()).toBe(0);
  });
});

interface SseContext {
  readonly app: ReturnType<typeof createApp>;
  readonly broker: RunEventBroker;
  readonly database: ReturnType<typeof initializePersistence>;
  readonly repository: RunRepository;
}

function createSseContext(): SseContext {
  const temporary = createTemporaryTestConfig();
  const database = initializePersistence(temporary.config);
  const repository = new RunRepository(database.connection);
  const broker = new RunEventBroker();
  const app = createApp({
    config: temporary.config,
    logger: false,
    runEventBroker: broker,
  });
  cleanups.push(async () => {
    await app.close();
    database.close();
    temporary.cleanup();
  });
  return { app, broker, database, repository };
}

function createRun(repository: RunRepository, runId: string): void {
  const definition = repository.loadSeededExperiment();
  repository.createRun({
    runId,
    experimentVersionId: definition.experimentVersionId,
    mode: 'vulnerable',
    startedAt: '2026-07-15T00:00:00.000Z',
    targetUrl: 'http://127.0.0.1:4200',
    journey: definition.journey,
    experiment: definition.experiment,
    assertions: definition.assertions,
  });
}

function setStatus(
  context: SseContext,
  runId: string,
  status: RunStatus,
): void {
  context.repository.updateRunStatus(runId, status);
}

function persistAndPublish(
  context: SseContext,
  runEvent: RunEventEnvelope,
  publish = true,
): void {
  context.repository.appendEvent(runEvent);
  if (publish) context.broker.publish(runEvent);
}

function event(
  runId: string,
  sequence: number,
  eventType: string,
): RunEventEnvelope {
  return runEventEnvelopeSchema.parse({
    eventId: `${runId}-event-${sequence}`,
    runId,
    eventType,
    sequence,
    relativeTimestampMs: sequence * 10,
    recordedAt: '2026-07-15T00:00:00.000Z',
    schemaVersion: 1,
    payload: {},
  });
}

function parseFrames(
  body: string,
): readonly { readonly id: number; readonly event: RunEventEnvelope }[] {
  return body
    .split('\n\n')
    .filter((block) => block.includes('event: run-event'))
    .map((block) => {
      const lines = block.split('\n');
      const idLine = lines.find((line) => line.startsWith('id: '));
      const dataLine = lines.find((line) => line.startsWith('data: '));
      if (idLine === undefined || dataLine === undefined) {
        throw new Error('Incomplete SSE frame.');
      }
      return {
        id: Number(idLine.slice(4)),
        event: runEventEnvelopeSchema.parse(JSON.parse(dataLine.slice(6))),
      };
    });
}
