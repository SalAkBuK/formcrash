import {
  approveCriticalActionRequestSchema,
  approveOutcomeCheckRequestSchema,
  createProjectRequestSchema,
  criticalActionResponseSchema,
  deleteProjectResponseSchema,
  deleteResourceResponseSchema,
  journeyListSchema,
  outcomeCaptureSessionSchema,
  outcomeCaptureResponseSchema,
  outcomeCheckListSchema,
  outcomeCheckSchema,
  projectListSchema,
  runExternalExperimentRequestSchema,
  saveRecordedJourneyRequestSchema,
  startOutcomeCaptureRequestSchema,
} from '@formcrash/contracts';
import type { FastifyInstance, FastifyReply } from 'fastify';
import { createReadStream } from 'node:fs';

import type { ProjectJourneyRepository } from '../../persistence/project-journey-repository.js';
import {
  CriticalActionLockedError,
  type OutcomeCheckRepository,
} from '../../persistence/outcome-check-repository.js';
import type { ExternalExperimentRepository } from '../../persistence/external-experiment-repository.js';
import type { ScreenshotStore } from '../../artifacts/screenshot-store.js';
import type { JourneyTraceStore } from '../../artifacts/journey-trace-store.js';
import type { AuthStateStore } from '../../runner/external/auth-session.js';
import { BrowserOwnershipConflictError } from '../../runner/infrastructure/browser-ownership.js';
import {
  InvalidTemplateError,
  MissingRuntimeVariablesError,
} from '../../runner/external/runtime-values.js';
import type { JourneyReplayService } from '../../runner/recording/journey-replay.js';
import { ProductionConfirmationRequiredError } from '../../runner/external/production-safety.js';
import { SavedAuthenticationExpiredError } from '../../runner/external/authentication-redirect.js';
import { RecordingNotActiveError } from '../../runner/recording/recording-manager.js';
import type { RecordingManager } from '../../runner/recording/recording-manager.js';
import {
  OutcomeCaptureNotActiveError,
  OutcomeCaptureStaleError,
  type OutcomeCaptureManager,
} from '../../runner/outcomes/outcome-capture-manager.js';

interface ProjectParams {
  readonly projectId: string;
}
interface DeleteProjectQuery {
  readonly force?: string | boolean;
}

interface RecordingParams extends ProjectParams {
  readonly sessionId: string;
}

interface JourneyParams {
  readonly journeyId: string;
}
interface JourneyVideoParams extends JourneyParams {
  readonly videoIndex: string;
}

interface OutcomeCaptureParams {
  readonly captureId: string;
}

interface OutcomeCheckParams extends JourneyParams {
  readonly outcomeCheckId: string;
}

export function registerProjectRoutes(
  app: FastifyInstance,
  repository: ProjectJourneyRepository,
  recordings: RecordingManager,
  replay: JourneyReplayService,
  cleanup: {
    readonly authStore: AuthStateStore;
    readonly experiments: ExternalExperimentRepository;
    readonly screenshots: ScreenshotStore;
    readonly traces: JourneyTraceStore;
  },
  outcome: {
    readonly repository: OutcomeCheckRepository;
    readonly captures: OutcomeCaptureManager;
  },
): void {
  app.get('/api/projects', async (_request, reply) =>
    reply.send(projectListSchema.parse({ items: repository.listProjects() })),
  );

  app.post('/api/projects', async (request, reply) => {
    const parsed = createProjectRequestSchema.safeParse(request.body);
    if (!parsed.success)
      return invalid(reply, 'INVALID_PROJECT', parsed.error.issues[0]?.message);
    const project = repository.createProject(parsed.data);
    return reply.status(201).send(project);
  });

  app.get<{ Params: ProjectParams }>(
    '/api/projects/:projectId',
    async (request, reply) => {
      const project = repository.getProject(request.params.projectId);
      return project === null
        ? notFound(reply, 'Project')
        : reply.send(project);
    },
  );

  app.delete<{ Params: ProjectParams; Querystring: DeleteProjectQuery }>(
    '/api/projects/:projectId',
    async (request, reply) => {
      const force =
        request.query.force === true || request.query.force === 'true';
      if (force && request.params.projectId === 'project-sample-checkout') {
        return reply.status(409).send({
          error: {
            code: 'PROTECTED_PROJECT',
            message: 'The bundled Sample Checkout project cannot be deleted.',
          },
        });
      }
      const artifacts = force
        ? cleanup.experiments.listArtifactsForProject(request.params.projectId)
        : [];
      const tracePaths = force
        ? repository.listTracePathsForProject(request.params.projectId)
        : [];
      if (force) cleanup.authStore.clear(request.params.projectId);
      const result = repository.deleteProject(request.params.projectId, force);
      if (result === 'not_found') return notFound(reply, 'Project');
      if (result === 'protected') {
        return reply.status(409).send({
          error: {
            code: 'PROTECTED_PROJECT',
            message: 'The bundled Sample Checkout project cannot be deleted.',
          },
        });
      }
      if (result === 'has_activity') {
        return reply.status(409).send({
          error: {
            code: 'PROJECT_HAS_ACTIVITY',
            message:
              'Projects with recordings, journeys, experiments, or runs cannot be deleted.',
          },
        });
      }
      cleanup.screenshots.remove(artifacts);
      cleanup.traces.remove(tracePaths);
      return reply.send(
        deleteProjectResponseSchema.parse({
          deletedProjectId: request.params.projectId,
        }),
      );
    },
  );

  app.post<{ Params: ProjectParams }>(
    '/api/projects/:projectId/recordings',
    async (request, reply) => {
      if (repository.getProject(request.params.projectId) === null) {
        return notFound(reply, 'Project');
      }
      try {
        const session = await recordings.start(request.params.projectId);
        return reply.status(201).send(session);
      } catch (error: unknown) {
        if (error instanceof BrowserOwnershipConflictError)
          return conflict(reply, error.message);
        if (error instanceof SavedAuthenticationExpiredError) {
          return reply.status(409).send({
            error: {
              code: 'AUTHENTICATION_REQUIRED',
              message: error.message,
            },
          });
        }
        throw error;
      }
    },
  );

  app.get<{ Params: RecordingParams }>(
    '/api/projects/:projectId/recordings/:sessionId',
    async (request, reply) => {
      const session = recordings.get(request.params.sessionId);
      return session === null || session.projectId !== request.params.projectId
        ? notFound(reply, 'Recording session')
        : reply.send(session);
    },
  );

  app.post<{ Params: RecordingParams }>(
    '/api/projects/:projectId/recordings/:sessionId/stop',
    async (request, reply) => {
      const existing = recordings.get(request.params.sessionId);
      if (
        existing === null ||
        existing.projectId !== request.params.projectId
      ) {
        return notFound(reply, 'Recording session');
      }
      try {
        const session = await recordings.stop(request.params.sessionId);
        return reply.send(session);
      } catch (error: unknown) {
        if (error instanceof RecordingNotActiveError) {
          return reply.status(409).send({
            error: { code: 'RECORDING_NOT_ACTIVE', message: error.message },
          });
        }
        throw error;
      }
    },
  );

  app.post<{ Params: RecordingParams }>(
    '/api/projects/:projectId/recordings/:sessionId/journeys',
    async (request, reply) => {
      const parsed = saveRecordedJourneyRequestSchema.safeParse(request.body);
      if (!parsed.success)
        return invalid(
          reply,
          'INVALID_JOURNEY',
          parsed.error.issues[0]?.message,
        );
      try {
        const journey = recordings.save(
          request.params.projectId,
          request.params.sessionId,
          parsed.data,
        );
        return reply.status(201).send(journey);
      } catch (error: unknown) {
        return invalid(
          reply,
          'INVALID_JOURNEY',
          error instanceof Error ? error.message : undefined,
        );
      }
    },
  );

  app.get<{ Params: ProjectParams }>(
    '/api/projects/:projectId/journeys',
    async (request, reply) => {
      if (repository.getProject(request.params.projectId) === null) {
        return notFound(reply, 'Project');
      }
      return reply.send(
        journeyListSchema.parse({
          items: repository.listJourneys(request.params.projectId),
        }),
      );
    },
  );

  app.get<{ Params: JourneyParams }>(
    '/api/journeys/:journeyId',
    async (request, reply) => {
      const journey = repository.getJourney(request.params.journeyId);
      return journey === null
        ? notFound(reply, 'Journey')
        : reply.send(journey);
    },
  );

  app.get<{ Params: JourneyVideoParams }>(
    '/api/journeys/:journeyId/trace/videos/:videoIndex',
    async (request, reply) => {
      const manifest = repository.getJourneyTraceManifest(
        request.params.journeyId,
      );
      if (manifest === null) return notFound(reply, 'Journey trace');
      const index = Number.parseInt(request.params.videoIndex, 10);
      if (!Number.isInteger(index) || index < 0) {
        return notFound(reply, 'Journey video');
      }
      const videoPath = cleanup.traces.videoPath(manifest, index);
      if (videoPath === null) return notFound(reply, 'Journey video');
      return reply
        .header('Cache-Control', 'no-store')
        .type('video/webm')
        .send(createReadStream(videoPath));
    },
  );

  app.get<{ Params: JourneyParams }>(
    '/api/journeys/:journeyId/critical-action',
    async (request, reply) => {
      if (repository.getJourney(request.params.journeyId) === null) {
        return notFound(reply, 'Journey');
      }
      return reply.send(
        criticalActionResponseSchema.parse({
          criticalAction: outcome.repository.getCriticalAction(
            request.params.journeyId,
          ),
        }),
      );
    },
  );

  app.put<{ Params: JourneyParams }>(
    '/api/journeys/:journeyId/critical-action',
    async (request, reply) => {
      const journey = repository.getJourney(request.params.journeyId);
      if (journey === null) return notFound(reply, 'Journey');
      const parsed = approveCriticalActionRequestSchema.safeParse(request.body);
      if (!parsed.success) {
        return invalid(
          reply,
          'INVALID_CRITICAL_ACTION',
          parsed.error.issues[0]?.message,
        );
      }
      try {
        return reply.send(
          outcome.repository.approveCriticalAction(journey, parsed.data),
        );
      } catch (error: unknown) {
        if (error instanceof CriticalActionLockedError) {
          return reply.status(409).send({
            error: {
              code: 'CRITICAL_ACTION_LOCKED',
              message: error.message,
            },
          });
        }
        return invalid(
          reply,
          'INVALID_CRITICAL_ACTION',
          error instanceof Error ? error.message : undefined,
        );
      }
    },
  );

  app.get<{ Params: JourneyParams }>(
    '/api/journeys/:journeyId/outcome-checks',
    async (request, reply) => {
      if (repository.getJourney(request.params.journeyId) === null) {
        return notFound(reply, 'Journey');
      }
      return reply.send(
        outcomeCheckListSchema.parse({
          items: outcome.repository.listOutcomeChecks(request.params.journeyId),
        }),
      );
    },
  );

  app.delete<{ Params: OutcomeCheckParams }>(
    '/api/journeys/:journeyId/outcome-checks/:outcomeCheckId',
    async (request, reply) => {
      if (repository.getJourney(request.params.journeyId) === null) {
        return notFound(reply, 'Journey');
      }
      const result = outcome.repository.deleteOutcomeCheck(
        request.params.journeyId,
        request.params.outcomeCheckId,
      );
      if (result === 'not_found') return notFound(reply, 'Outcome Check');
      return reply.send(
        deleteResourceResponseSchema.parse({
          deletedId: request.params.outcomeCheckId,
        }),
      );
    },
  );

  app.get<{ Params: JourneyParams }>(
    '/api/journeys/:journeyId/outcome-capture',
    async (request, reply) => {
      if (repository.getJourney(request.params.journeyId) === null) {
        return notFound(reply, 'Journey');
      }
      return reply.send(
        outcomeCaptureResponseSchema.parse({
          capture: await outcome.captures.getForJourney(
            request.params.journeyId,
          ),
        }),
      );
    },
  );

  app.post<{ Params: JourneyParams }>(
    '/api/journeys/:journeyId/outcome-captures',
    async (request, reply) => {
      if (repository.getJourney(request.params.journeyId) === null) {
        return notFound(reply, 'Journey');
      }
      const parsed = startOutcomeCaptureRequestSchema.safeParse(
        request.body ?? {},
      );
      if (!parsed.success) {
        return invalid(
          reply,
          'INVALID_OUTCOME_CAPTURE',
          parsed.error.issues[0]?.message,
        );
      }
      try {
        return reply
          .status(201)
          .send(
            outcomeCaptureSessionSchema.parse(
              await outcome.captures.start(
                request.params.journeyId,
                parsed.data.variables,
                parsed.data.confirmProduction,
              ),
            ),
          );
      } catch (error: unknown) {
        if (error instanceof BrowserOwnershipConflictError) {
          return conflict(reply, error.message);
        }
        if (error instanceof MissingRuntimeVariablesError) {
          return reply.status(400).send({
            error: {
              code: 'MISSING_RUNTIME_VARIABLES',
              message: 'Required runtime variables were not provided.',
              missingVariables: error.missingVariables,
            },
          });
        }
        if (error instanceof InvalidTemplateError) {
          return invalid(reply, 'INVALID_TEMPLATE', error.message);
        }
        if (error instanceof ProductionConfirmationRequiredError) {
          return reply.status(409).send({
            error: {
              code: 'PRODUCTION_CONFIRMATION_REQUIRED',
              message: error.message,
            },
          });
        }
        if (error instanceof SavedAuthenticationExpiredError) {
          return reply.status(409).send({
            error: {
              code: 'AUTHENTICATION_REQUIRED',
              message: error.message,
            },
          });
        }
        return invalid(
          reply,
          'INVALID_OUTCOME_CAPTURE',
          error instanceof Error ? error.message : undefined,
        );
      }
    },
  );

  app.get<{ Params: OutcomeCaptureParams }>(
    '/api/outcome-captures/:captureId',
    async (request, reply) => {
      const capture = await outcome.captures.get(request.params.captureId);
      return capture === null
        ? notFound(reply, 'Outcome capture session')
        : reply.send(outcomeCaptureSessionSchema.parse(capture));
    },
  );

  app.post<{ Params: OutcomeCaptureParams }>(
    '/api/outcome-captures/:captureId/outcome-checks',
    async (request, reply) => {
      const parsed = approveOutcomeCheckRequestSchema.safeParse(request.body);
      if (!parsed.success) {
        return invalid(
          reply,
          'INVALID_OUTCOME_CHECK',
          parsed.error.issues[0]?.message,
        );
      }
      try {
        return reply
          .status(201)
          .send(
            outcomeCheckSchema.parse(
              await outcome.captures.approve(
                request.params.captureId,
                parsed.data,
              ),
            ),
          );
      } catch (error: unknown) {
        if (error instanceof OutcomeCaptureStaleError) {
          return reply.status(409).send({
            error: { code: 'OUTCOME_CAPTURE_STALE', message: error.message },
          });
        }
        if (error instanceof OutcomeCaptureNotActiveError) {
          return reply.status(409).send({
            error: {
              code: 'OUTCOME_CAPTURE_NOT_ACTIVE',
              message: error.message,
            },
          });
        }
        return invalid(
          reply,
          'INVALID_OUTCOME_CHECK',
          error instanceof Error ? error.message : undefined,
        );
      }
    },
  );

  app.post<{ Params: OutcomeCaptureParams }>(
    '/api/outcome-captures/:captureId/close',
    async (request, reply) => {
      try {
        return reply.send(
          outcomeCaptureSessionSchema.parse(
            await outcome.captures.close(request.params.captureId),
          ),
        );
      } catch (error: unknown) {
        if (error instanceof OutcomeCaptureNotActiveError) {
          return reply.status(409).send({
            error: {
              code: 'OUTCOME_CAPTURE_NOT_ACTIVE',
              message: error.message,
            },
          });
        }
        throw error;
      }
    },
  );

  app.delete<{ Params: JourneyParams }>(
    '/api/journeys/:journeyId',
    async (request, reply) => {
      const artifacts = cleanup.experiments.listArtifactsForJourney(
        request.params.journeyId,
      );
      const result = repository.deleteJourney(request.params.journeyId);
      if (result === 'not_found') return notFound(reply, 'Journey');
      cleanup.screenshots.remove(artifacts);
      return reply.send(
        deleteResourceResponseSchema.parse({
          deletedId: request.params.journeyId,
        }),
      );
    },
  );

  app.post<{ Params: JourneyParams }>(
    '/api/journeys/:journeyId/replay',
    async (request, reply) => {
      if (repository.getJourney(request.params.journeyId) === null) {
        return notFound(reply, 'Journey');
      }
      const parsed = runExternalExperimentRequestSchema.safeParse(
        request.body ?? {},
      );
      if (!parsed.success) {
        return invalid(
          reply,
          'INVALID_REPLAY_REQUEST',
          parsed.error.issues[0]?.message,
        );
      }
      try {
        return reply.send(
          await replay.replay(
            request.params.journeyId,
            parsed.data.variables,
            parsed.data.confirmProduction,
            parsed.data.replayMode,
            parsed.data.replayPacing,
          ),
        );
      } catch (error: unknown) {
        if (error instanceof BrowserOwnershipConflictError)
          return conflict(reply, error.message);
        if (error instanceof MissingRuntimeVariablesError) {
          return reply.status(400).send({
            error: {
              code: 'MISSING_RUNTIME_VARIABLES',
              message: 'Required runtime variables were not provided.',
              missingVariables: error.missingVariables,
            },
          });
        }
        if (error instanceof InvalidTemplateError) {
          return invalid(reply, 'INVALID_TEMPLATE', error.message);
        }
        if (error instanceof ProductionConfirmationRequiredError) {
          return reply.status(409).send({
            error: {
              code: 'PRODUCTION_CONFIRMATION_REQUIRED',
              message: error.message,
            },
          });
        }
        if (error instanceof SavedAuthenticationExpiredError) {
          return reply.status(409).send({
            error: {
              code: 'AUTHENTICATION_REQUIRED',
              message: error.message,
            },
          });
        }
        if (
          error instanceof Error &&
          error.message.includes('authentication state is missing')
        ) {
          return invalid(reply, 'AUTHENTICATION_STATE_MISSING', error.message);
        }
        throw error;
      }
    },
  );
}

function invalid(reply: FastifyReply, code: string, message?: string) {
  return reply.status(400).send({
    error: { code, message: message ?? 'The request is invalid.' },
  });
}

function notFound(reply: FastifyReply, resource: string) {
  return reply.status(404).send({
    error: {
      code: `${resource.toUpperCase().replaceAll(' ', '_')}_NOT_FOUND`,
      message: `${resource} was not found.`,
    },
  });
}

function conflict(reply: FastifyReply, message: string) {
  return reply.status(409).send({ error: { code: 'BROWSER_ACTIVE', message } });
}
