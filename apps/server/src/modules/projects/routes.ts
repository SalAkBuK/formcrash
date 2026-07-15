import {
  createProjectRequestSchema,
  journeyListSchema,
  projectListSchema,
  runExternalExperimentRequestSchema,
  saveRecordedJourneyRequestSchema,
} from '@formcrash/contracts';
import type { FastifyInstance, FastifyReply } from 'fastify';

import type { ProjectJourneyRepository } from '../../persistence/project-journey-repository.js';
import { BrowserOwnershipConflictError } from '../../runner/infrastructure/browser-ownership.js';
import {
  InvalidTemplateError,
  MissingRuntimeVariablesError,
} from '../../runner/external/runtime-values.js';
import type { JourneyReplayService } from '../../runner/recording/journey-replay.js';
import { RecordingNotActiveError } from '../../runner/recording/recording-manager.js';
import type { RecordingManager } from '../../runner/recording/recording-manager.js';

interface ProjectParams {
  readonly projectId: string;
}

interface RecordingParams extends ProjectParams {
  readonly sessionId: string;
}

interface JourneyParams {
  readonly journeyId: string;
}

export function registerProjectRoutes(
  app: FastifyInstance,
  repository: ProjectJourneyRepository,
  recordings: RecordingManager,
  replay: JourneyReplayService,
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
          await replay.replay(request.params.journeyId, parsed.data.variables),
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
