import type { FastifyInstance } from 'fastify';
import { startSampleRunRequestSchema } from '@formcrash/contracts';
import { z } from 'zod';

import type { ScreenshotStore } from '../../artifacts/screenshot-store.js';
import type { RunEventBroker } from '../../events/run-event-broker.js';
import type { RunRepository } from '../../persistence/run-repository.js';
import { ActiveSampleRunError } from '../../runner/engine/sample-run-coordinator.js';
import type { SampleRunCoordinator } from '../../runner/engine/sample-run-coordinator.js';
import { parseLastEventId, streamRunEvents } from './run-events-sse.js';

const runListQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(20),
  offset: z.coerce.number().int().nonnegative().default(0),
});

const runParametersSchema = z.object({ runId: z.string().min(1) });
const artifactParametersSchema = runParametersSchema.extend({
  artifactId: z.string().min(1),
});

export function registerSampleRunRoutes(
  app: FastifyInstance,
  coordinator: SampleRunCoordinator,
  repository: RunRepository,
  screenshotStore: ScreenshotStore,
  eventBroker: RunEventBroker,
): void {
  app.post('/api/sample-runs', (request, reply) => {
    const parsed = startSampleRunRequestSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({
        error: {
          code: 'INVALID_SAMPLE_RUN_REQUEST',
          message: 'Mode must be either vulnerable or fixed.',
          issues: parsed.error.issues.map((issue) => ({
            path: issue.path.join('.'),
            message: issue.message,
          })),
        },
      });
    }

    try {
      return reply.status(202).send(coordinator.start(parsed.data.mode));
    } catch (error: unknown) {
      if (error instanceof ActiveSampleRunError) {
        return reply.status(409).send({
          error: {
            code: 'SAMPLE_RUN_ACTIVE',
            message: error.message,
          },
        });
      }

      request.log.error({ error }, 'Unexpected sample-run request failure');
      return reply.status(500).send({
        error: {
          code: 'SAMPLE_RUN_REQUEST_FAILED',
          message: 'The control server could not produce a sample run result.',
        },
      });
    }
  });

  app.get('/api/sample-runs/latest', (_request, reply) => {
    const latest = repository.getLatestRun();
    if (latest === null) {
      return reply.status(404).send({
        error: {
          code: 'SAMPLE_RUN_NOT_FOUND',
          message: 'No persisted sample run exists.',
        },
      });
    }
    return latest;
  });

  app.get('/api/runs', (request, reply) => {
    const parsed = runListQuerySchema.safeParse(request.query);
    if (!parsed.success) {
      return reply.status(400).send({
        error: {
          code: 'INVALID_RUN_LIST_QUERY',
          message:
            'Run pagination must use a limit from 1 to 100 and a non-negative offset.',
        },
      });
    }
    return repository.listRuns(parsed.data.limit, parsed.data.offset);
  });

  app.get('/api/runs/:runId', (request, reply) => {
    const parsed = runParametersSchema.safeParse(request.params);
    if (!parsed.success) return reply.status(404).send(runNotFound());
    const run = repository.getRun(parsed.data.runId);
    return run === null ? reply.status(404).send(runNotFound()) : run;
  });

  app.get('/api/runs/:runId/events', (request, reply) => {
    const parsed = runParametersSchema.safeParse(request.params);
    if (!parsed.success) return reply.status(404).send(runNotFound());
    const header = request.headers['last-event-id'];
    if (Array.isArray(header)) {
      return reply.status(400).send(invalidLastEventId());
    }
    let afterSequence: number;
    try {
      afterSequence = parseLastEventId(header);
    } catch {
      return reply.status(400).send(invalidLastEventId());
    }
    streamRunEvents(
      request,
      reply,
      parsed.data.runId,
      afterSequence,
      repository,
      eventBroker,
    );
  });

  app.get('/api/runs/:runId/artifacts/:artifactId', (request, reply) => {
    const parsed = artifactParametersSchema.safeParse(request.params);
    if (!parsed.success) return reply.status(404).send(artifactNotFound());
    const artifact = repository.getArtifact(
      parsed.data.runId,
      parsed.data.artifactId,
    );
    if (artifact === null) return reply.status(404).send(artifactNotFound());

    try {
      return reply.type(artifact.mimeType).send(screenshotStore.read(artifact));
    } catch (error: unknown) {
      request.log.warn(
        { error, artifactId: artifact.artifactId, runId: artifact.runId },
        'Artifact metadata exists but its file is unavailable',
      );
      return reply
        .type('application/json')
        .status(404)
        .send(artifactNotFound());
    }
  });
}

function runNotFound() {
  return {
    error: {
      code: 'RUN_NOT_FOUND',
      message: 'The requested run was not found.',
    },
  };
}

function artifactNotFound() {
  return {
    error: {
      code: 'ARTIFACT_NOT_FOUND',
      message: 'The requested artifact was not found.',
    },
  };
}

function invalidLastEventId() {
  return {
    error: {
      code: 'INVALID_LAST_EVENT_ID',
      message: 'Last-Event-ID must be a non-negative safe integer.',
    },
  };
}
