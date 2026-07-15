import type { FastifyInstance } from 'fastify';
import { z } from 'zod';

import { ActiveSampleRunError } from '../../runner/engine/sample-run-coordinator.js';
import type { SampleRunCoordinator } from '../../runner/engine/sample-run-coordinator.js';

const sampleRunRequestSchema = z.object({
  mode: z.enum(['vulnerable', 'fixed']),
});

export function registerSampleRunRoutes(
  app: FastifyInstance,
  coordinator: SampleRunCoordinator,
): void {
  app.post('/api/sample-runs', async (request, reply) => {
    const parsed = sampleRunRequestSchema.safeParse(request.body);
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
      return await coordinator.run(parsed.data.mode);
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
    const latest = coordinator.latest;
    if (latest === null) {
      return reply.status(404).send({
        error: {
          code: 'SAMPLE_RUN_NOT_FOUND',
          message:
            'No in-memory sample run has completed in this server process.',
        },
      });
    }
    return latest;
  });
}
