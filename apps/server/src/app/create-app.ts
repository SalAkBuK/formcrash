import Fastify, { type FastifyError, type FastifyInstance } from 'fastify';
import cors from '@fastify/cors';

import type { ServerConfig } from './config.js';
import { ScreenshotStore } from '../artifacts/screenshot-store.js';
import { RunEventBroker } from '../events/run-event-broker.js';
import { registerHealthRoute } from '../modules/health/routes.js';
import { registerSampleRunRoutes } from '../modules/runs/sample-routes.js';
import { initializePersistence } from '../persistence/initialize.js';
import { RunRepository } from '../persistence/run-repository.js';
import { SampleRunCoordinator } from '../runner/engine/sample-run-coordinator.js';
import { PlaywrightSampleRunExecutor } from '../runner/engine/sample-runner.js';

export interface CreateAppOptions {
  readonly config: ServerConfig;
  readonly logger?: boolean;
  readonly sampleRunCoordinator?: SampleRunCoordinator;
  readonly runEventBroker?: RunEventBroker;
}

export function createApp(options: CreateAppOptions): FastifyInstance {
  const app = Fastify({
    logger:
      options.logger === false ? false : { level: options.config.logLevel },
  });
  const database = initializePersistence(options.config);
  const runRepository = new RunRepository(database.connection);
  const screenshotStore = new ScreenshotStore(
    options.config.artifactRoot,
    runRepository,
  );
  const runEventBroker = options.runEventBroker ?? new RunEventBroker();

  void app.register(cors, {
    origin: [...options.config.dashboardOrigins],
    methods: ['GET', 'POST', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Last-Event-ID'],
    credentials: false,
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
    new SampleRunCoordinator(
      new PlaywrightSampleRunExecutor(options.config, {
        repository: runRepository,
        screenshotStore,
        eventBroker: runEventBroker,
      }),
      {
        onAsyncError: (error, runId) => {
          app.log.error(
            { error, runId },
            'Asynchronous sample run execution failed',
          );
        },
      },
    );
  app.addHook('preClose', () => {
    runEventBroker.close();
  });
  app.addHook('onClose', async () => {
    await sampleRunCoordinator.waitForIdle();
    database.close();
  });
  registerSampleRunRoutes(
    app,
    sampleRunCoordinator,
    runRepository,
    screenshotStore,
    runEventBroker,
  );

  return app;
}
