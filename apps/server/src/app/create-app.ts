import Fastify, { type FastifyError, type FastifyInstance } from 'fastify';

import type { ServerConfig } from './config.js';
import { registerHealthRoute } from '../modules/health/routes.js';
import { registerSampleRunRoutes } from '../modules/runs/sample-routes.js';
import { SampleRunCoordinator } from '../runner/engine/sample-run-coordinator.js';
import { PlaywrightSampleRunExecutor } from '../runner/engine/sample-runner.js';

export interface CreateAppOptions {
  readonly config: ServerConfig;
  readonly logger?: boolean;
  readonly sampleRunCoordinator?: SampleRunCoordinator;
}

export function createApp(options: CreateAppOptions): FastifyInstance {
  const app = Fastify({
    logger:
      options.logger === false ? false : { level: options.config.logLevel },
  });

  app.setErrorHandler((error: FastifyError, request, reply) => {
    request.log.error({ error }, 'Request failed');

    const statusCode =
      error.statusCode !== undefined && error.statusCode < 500
        ? error.statusCode
        : 500;

    return reply.status(statusCode).send({
      error: statusCode === 500 ? 'Internal Server Error' : error.name,
      message:
        statusCode === 500
          ? 'The control server could not complete the request.'
          : error.message,
      statusCode,
    });
  });

  registerHealthRoute(app);
  const sampleRunCoordinator =
    options.sampleRunCoordinator ??
    new SampleRunCoordinator(new PlaywrightSampleRunExecutor(options.config));
  registerSampleRunRoutes(app, sampleRunCoordinator);

  return app;
}
