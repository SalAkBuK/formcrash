import Fastify, { type FastifyError, type FastifyInstance } from 'fastify';
import cors from '@fastify/cors';

import type { ServerConfig } from './config.js';
import { ScreenshotStore } from '../artifacts/screenshot-store.js';
import { RunEventBroker } from '../events/run-event-broker.js';
import { registerHealthRoute } from '../modules/health/routes.js';
import { registerSampleRunRoutes } from '../modules/runs/sample-routes.js';
import { registerProjectRoutes } from '../modules/projects/routes.js';
import { registerExternalExperimentRoutes } from '../modules/external-experiments/routes.js';
import { initializePersistence } from '../persistence/initialize.js';
import { RunRepository } from '../persistence/run-repository.js';
import { ProjectJourneyRepository } from '../persistence/project-journey-repository.js';
import { ProjectSettingsRepository } from '../persistence/project-settings-repository.js';
import { ExternalExperimentRepository } from '../persistence/external-experiment-repository.js';
import { SampleRunCoordinator } from '../runner/engine/sample-run-coordinator.js';
import { PlaywrightSampleRunExecutor } from '../runner/engine/sample-runner.js';
import { BrowserOwnership } from '../runner/infrastructure/browser-ownership.js';
import { RecordingManager } from '../runner/recording/recording-manager.js';
import { JourneyReplayService } from '../runner/recording/journey-replay.js';
import {
  AuthCaptureManager,
  AuthStateStore,
} from '../runner/external/auth-session.js';
import { ProjectSettingsService } from '../runner/external/project-settings-service.js';
import { RequestDiscoveryService } from '../runner/external/request-discovery.js';
import { ExternalExperimentRunner } from '../runner/external/external-experiment-runner.js';
import { AuthValidationService } from '../runner/external/auth-validation.js';

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
  const projectRepository = new ProjectJourneyRepository(database.connection);
  const projectSettingsRepository = new ProjectSettingsRepository(
    database.connection,
  );
  const externalExperimentRepository = new ExternalExperimentRepository(
    database.connection,
  );
  const externalScreenshotStore = new ScreenshotStore(
    options.config.artifactRoot,
    externalExperimentRepository,
  );
  const screenshotStore = new ScreenshotStore(
    options.config.artifactRoot,
    runRepository,
  );
  const runEventBroker = options.runEventBroker ?? new RunEventBroker();
  const browserOwnership = new BrowserOwnership();
  const authStateStore = new AuthStateStore(
    options.config.artifactRoot,
    projectSettingsRepository,
  );
  const projectSettings = new ProjectSettingsService(
    projectRepository,
    projectSettingsRepository,
    authStateStore,
  );
  const authCaptures = new AuthCaptureManager(
    options.config,
    projectRepository,
    projectSettingsRepository,
    authStateStore,
    browserOwnership,
  );
  const authValidation = new AuthValidationService(
    options.config,
    projectRepository,
    authStateStore,
    browserOwnership,
  );
  const recordingManager = new RecordingManager(
    options.config,
    projectRepository,
    browserOwnership,
    undefined,
    authStateStore,
  );
  const journeyReplay = new JourneyReplayService(
    options.config,
    projectRepository,
    browserOwnership,
    undefined,
    projectSettingsRepository,
    authStateStore,
  );
  const requestDiscovery = new RequestDiscoveryService(
    options.config,
    projectRepository,
    projectSettingsRepository,
    authStateStore,
    browserOwnership,
  );
  const externalRunner = new ExternalExperimentRunner(
    options.config,
    projectRepository,
    projectSettingsRepository,
    authStateStore,
    externalExperimentRepository,
    browserOwnership,
  );

  void app.register(cors, {
    origin: [...options.config.dashboardOrigins],
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
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
        browserOwnership,
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
    await authCaptures.close();
    await recordingManager.close();
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
  registerProjectRoutes(
    app,
    projectRepository,
    recordingManager,
    journeyReplay,
    {
      authStore: authStateStore,
      experiments: externalExperimentRepository,
      screenshots: externalScreenshotStore,
    },
  );
  registerExternalExperimentRoutes(app, {
    artifactRoot: options.config.artifactRoot,
    projects: projectRepository,
    settings: projectSettings,
    authStore: authStateStore,
    authCaptures,
    authValidation,
    discovery: requestDiscovery,
    experiments: externalExperimentRepository,
    runner: externalRunner,
  });

  return app;
}
