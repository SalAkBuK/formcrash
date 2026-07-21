import {
  authCaptureSessionSchema,
  authValidationResultSchema,
  createExternalExperimentRequestSchema,
  createExternalExperimentSuiteRequestSchema,
  createExternalExperimentVersionRequestSchema,
  deleteResourceResponseSchema,
  externalExperimentListSchema,
  externalExperimentVersionSchema,
  externalRunDetailSchema,
  externalRunComparisonRequestSchema,
  externalRunComparisonResponseSchema,
  externalRunListQuerySchema,
  externalRunListSchema,
  externalTestDetailSchema,
  externalTestSummaryListSchema,
  networkEvidenceCandidateListSchema,
  projectExecutionSettingsInputSchema,
  productionReplayAcknowledgementInputSchema,
  requestDiscoveryRequestSchema,
  runExternalExperimentRequestSchema,
} from '@formcrash/contracts';
import type { FastifyInstance, FastifyReply } from 'fastify';

import { ScreenshotStore } from '../../artifacts/screenshot-store.js';
import {
  ExternalTestNameExistsError,
  type ExternalExperimentRepository,
} from '../../persistence/external-experiment-repository.js';
import type { ProjectJourneyRepository } from '../../persistence/project-journey-repository.js';
import { BrowserOwnershipConflictError } from '../../runner/infrastructure/browser-ownership.js';
import type {
  AuthCaptureManager,
  AuthStateStore,
} from '../../runner/external/auth-session.js';
import type { AuthValidationService } from '../../runner/external/auth-validation.js';
import { SavedAuthenticationExpiredError } from '../../runner/external/authentication-redirect.js';
import type { ExternalExperimentRunner } from '../../runner/external/external-experiment-runner.js';
import type { ProjectSettingsService } from '../../runner/external/project-settings-service.js';
import type { RequestDiscoveryService } from '../../runner/external/request-discovery.js';
import { ProductionConfirmationRequiredError } from '../../runner/external/production-safety.js';
import {
  InvalidTemplateError,
  MissingRuntimeVariablesError,
} from '../../runner/external/runtime-values.js';
import { compareExternalRuns } from '../../runner/outcomes/external-run-comparison.js';
import { rankRequestCandidates } from '../../runner/external/request-recommendation.js';

interface ProjectParams {
  readonly projectId: string;
}
interface CaptureParams extends ProjectParams {
  readonly captureId: string;
}
interface JourneyParams {
  readonly journeyId: string;
}
interface ExperimentParams {
  readonly experimentVersionId: string;
}
interface TestParams {
  readonly testId: string;
}
interface RunParams {
  readonly runId: string;
}
interface ExternalRunQuery {
  readonly projectId?: string;
  readonly journeyId?: string;
  readonly limit?: string | number;
  readonly offset?: string | number;
}
interface ArtifactParams extends RunParams {
  readonly artifactId: string;
}

export function registerExternalExperimentRoutes(
  app: FastifyInstance,
  dependencies: {
    readonly artifactRoot: string;
    readonly projects: ProjectJourneyRepository;
    readonly settings: ProjectSettingsService;
    readonly authStore: AuthStateStore;
    readonly authCaptures: AuthCaptureManager;
    readonly authValidation: AuthValidationService;
    readonly discovery: RequestDiscoveryService;
    readonly experiments: ExternalExperimentRepository;
    readonly runner: ExternalExperimentRunner;
  },
): void {
  const artifactStore = new ScreenshotStore(
    dependencies.artifactRoot,
    dependencies.experiments,
  );

  app.get<{ Params: ProjectParams }>(
    '/api/projects/:projectId/experiments',
    async (request, reply) => {
      if (dependencies.projects.getProject(request.params.projectId) === null) {
        return notFound(reply, 'Project');
      }
      return reply.send(
        externalExperimentListSchema.parse({
          items: dependencies.experiments.listVersionsByProject(
            request.params.projectId,
          ),
        }),
      );
    },
  );

  app.get<{ Params: ProjectParams }>(
    '/api/projects/:projectId/settings',
    async (request, reply) => {
      try {
        return reply.send(dependencies.settings.get(request.params.projectId));
      } catch {
        return notFound(reply, 'Project');
      }
    },
  );

  app.put<{ Params: ProjectParams }>(
    '/api/projects/:projectId/settings',
    async (request, reply) => {
      const parsed = projectExecutionSettingsInputSchema.safeParse(
        request.body,
      );
      if (!parsed.success)
        return invalid(
          reply,
          'INVALID_PROJECT_SETTINGS',
          parsed.error.issues[0]?.message,
        );
      try {
        return reply.send(
          dependencies.settings.save(request.params.projectId, parsed.data),
        );
      } catch (error: unknown) {
        return invalid(reply, 'INVALID_PROJECT_SETTINGS', publicMessage(error));
      }
    },
  );

  app.put<{ Params: ProjectParams }>(
    '/api/projects/:projectId/settings/production-replay-acknowledgement',
    async (request, reply) => {
      const parsed = productionReplayAcknowledgementInputSchema.safeParse(
        request.body,
      );
      if (!parsed.success) {
        return invalid(
          reply,
          'INVALID_PRODUCTION_REPLAY_ACKNOWLEDGEMENT',
          parsed.error.issues[0]?.message,
        );
      }
      try {
        return reply.send(
          dependencies.settings.setProductionReplayAcknowledgement(
            request.params.projectId,
            parsed.data.acknowledged,
          ),
        );
      } catch {
        return notFound(reply, 'Project');
      }
    },
  );

  app.post<{ Params: ProjectParams }>(
    '/api/projects/:projectId/auth-captures',
    async (request, reply) => {
      if (dependencies.projects.getProject(request.params.projectId) === null) {
        return notFound(reply, 'Project');
      }
      try {
        const capture = await dependencies.authCaptures.start(
          request.params.projectId,
        );
        return reply.status(201).send(authCaptureSessionSchema.parse(capture));
      } catch (error: unknown) {
        if (error instanceof BrowserOwnershipConflictError)
          return conflict(reply, error.message);
        throw error;
      }
    },
  );

  app.get<{ Params: CaptureParams }>(
    '/api/projects/:projectId/auth-captures/:captureId',
    async (request, reply) => {
      const capture = dependencies.authCaptures.get(request.params.captureId);
      return capture === null || capture.projectId !== request.params.projectId
        ? notFound(reply, 'Authentication capture')
        : reply.send(capture);
    },
  );

  app.post<{ Params: CaptureParams }>(
    '/api/projects/:projectId/auth-captures/:captureId/confirm',
    async (request, reply) => {
      const capture = dependencies.authCaptures.get(request.params.captureId);
      if (capture === null || capture.projectId !== request.params.projectId) {
        return notFound(reply, 'Authentication capture');
      }
      try {
        return reply.send(
          await dependencies.authCaptures.confirm(request.params.captureId),
        );
      } catch (error: unknown) {
        return conflict(reply, publicMessage(error));
      }
    },
  );

  app.post<{ Params: CaptureParams }>(
    '/api/projects/:projectId/auth-captures/:captureId/cancel',
    async (request, reply) => {
      const capture = dependencies.authCaptures.get(request.params.captureId);
      if (capture === null || capture.projectId !== request.params.projectId) {
        return notFound(reply, 'Authentication capture');
      }
      try {
        return reply.send(
          await dependencies.authCaptures.cancel(request.params.captureId),
        );
      } catch (error: unknown) {
        return conflict(reply, publicMessage(error));
      }
    },
  );

  app.delete<{ Params: ProjectParams }>(
    '/api/projects/:projectId/authentication',
    async (request, reply) => {
      try {
        return reply.send(
          dependencies.settings.clearAuthentication(request.params.projectId),
        );
      } catch {
        return notFound(reply, 'Project');
      }
    },
  );

  app.post<{ Params: ProjectParams }>(
    '/api/projects/:projectId/authentication/continue-without-sign-in',
    async (request, reply) => {
      try {
        return reply.send(
          dependencies.settings.continueWithoutAuthentication(
            request.params.projectId,
          ),
        );
      } catch {
        return notFound(reply, 'Project');
      }
    },
  );

  app.post<{ Params: ProjectParams }>(
    '/api/projects/:projectId/authentication/test',
    async (request, reply) => {
      if (dependencies.projects.getProject(request.params.projectId) === null) {
        return notFound(reply, 'Project');
      }
      try {
        return reply.send(
          authValidationResultSchema.parse(
            await dependencies.authValidation.validate(
              request.params.projectId,
            ),
          ),
        );
      } catch (error: unknown) {
        if (error instanceof BrowserOwnershipConflictError) {
          return conflict(reply, error.message);
        }
        return invalid(
          reply,
          'AUTHENTICATION_VALIDATION_FAILED',
          publicMessage(error),
        );
      }
    },
  );

  app.post<{ Params: JourneyParams }>(
    '/api/journeys/:journeyId/request-discovery',
    async (request, reply) => {
      const parsed = requestDiscoveryRequestSchema.safeParse(request.body);
      if (!parsed.success)
        return invalid(
          reply,
          'INVALID_DISCOVERY_REQUEST',
          parsed.error.issues[0]?.message,
        );
      try {
        return reply.send(
          await dependencies.discovery.discover({
            journeyId: request.params.journeyId,
            ...parsed.data,
          }),
        );
      } catch (error: unknown) {
        return handleExecutionError(reply, error);
      }
    },
  );

  app.get<{
    Params: JourneyParams;
    Querystring: { readonly targetStepId?: string };
  }>(
    '/api/journeys/:journeyId/network-evidence-candidates',
    async (request, reply) => {
      const journey = dependencies.projects.getJourney(
        request.params.journeyId,
      );
      if (journey === null) return notFound(reply, 'Journey');
      const targetStepId = request.query.targetStepId;
      const target = journey.steps.find((step) => step.id === targetStepId);
      if (
        targetStepId === undefined ||
        target === undefined ||
        !['click', 'submit'].includes(target.type)
      ) {
        return invalid(
          reply,
          'INCOMPATIBLE_TARGET_STEP',
          'Choose a recorded click or submit step.',
        );
      }

      const recordingEvidence =
        dependencies.projects.listRecordingRequestEvidence(
          journey.id,
          targetStepId,
        );
      const priorRun =
        recordingEvidence.length === 0
          ? dependencies.experiments
              .listPriorRunRequestEvidence(journey.id, targetStepId)
              .find((item) => item.evidence.length > 0)
          : undefined;
      const evidence =
        recordingEvidence.length > 0
          ? recordingEvidence
          : (priorRun?.evidence ?? []);
      const source =
        recordingEvidence.length > 0
          ? ('recording' as const)
          : priorRun === undefined
            ? null
            : ('prior_run' as const);
      const ranked = rankRequestCandidates({
        candidates: evidence.map((item) => ({
          method: item.method,
          pathname: item.pathname,
          origin: item.origin,
          status: item.status,
          failed: item.failed,
          relativeTimestampMs: item.relativeTimestampMs,
          occurrences: item.occurrences,
        })),
        targetOrigin: new URL(journey.steps[0]?.url ?? target.url).origin,
        journeyName: journey.name,
        targetStepName: target.name,
        targetPathname: new URL(target.url).pathname,
      });
      return reply.send(
        networkEvidenceCandidateListSchema.parse({
          items: ranked.candidates.map((candidate) => ({
            ...candidate,
            source,
            sourceRunId: priorRun?.runId ?? null,
            actionStepId: targetStepId,
            host: new URL(candidate.origin).host,
            observedAt:
              evidence.find(
                (item) =>
                  item.method === candidate.method &&
                  item.origin === candidate.origin &&
                  item.pathname === candidate.pathname &&
                  item.status === candidate.status,
              )?.observedAt ?? new Date(0).toISOString(),
          })),
          source,
          explanation:
            source === 'recording'
              ? 'Sanitized mutation candidates were captured during the original recording. Approving one does not replay the journey.'
              : source === 'prior_run'
                ? 'This legacy journey has no recording-time candidate. These sanitized candidates came from an existing run and require explicit approval before reuse.'
                : 'No bounded recording or prior-run request evidence is available. This test will remain browser-only.',
        }),
      );
    },
  );

  app.post<{ Params: JourneyParams }>(
    '/api/journeys/:journeyId/experiments',
    async (request, reply) => {
      const parsed = createExternalExperimentRequestSchema.safeParse(
        request.body,
      );
      if (!parsed.success)
        return invalid(
          reply,
          'INVALID_EXPERIMENT',
          parsed.error.issues[0]?.message,
        );
      const journey = dependencies.projects.getJourney(
        request.params.journeyId,
      );
      if (journey === null) return notFound(reply, 'Journey');
      const target = journey.steps.find(
        (step) => step.id === parsed.data.targetStepId,
      );
      if (
        target === undefined ||
        (target.type !== 'click' && target.type !== 'submit')
      ) {
        return invalid(
          reply,
          'INCOMPATIBLE_TARGET_STEP',
          'Impatient User can target only recorded click or submit steps.',
        );
      }
      try {
        const experiment = dependencies.experiments.createTest({
          projectId: journey.projectId,
          journey,
          request: parsed.data,
        });
        return reply
          .status(201)
          .send(externalExperimentVersionSchema.parse(experiment));
      } catch (error: unknown) {
        if (error instanceof ExternalTestNameExistsError) {
          return reply.status(409).send({
            error: {
              code: 'TEST_NAME_EXISTS',
              message: error.message,
            },
          });
        }
        throw error;
      }
    },
  );

  app.post<{ Params: JourneyParams }>(
    '/api/journeys/:journeyId/experiment-suite',
    async (request, reply) => {
      const parsed = createExternalExperimentSuiteRequestSchema.safeParse(
        request.body,
      );
      if (!parsed.success) {
        return invalid(
          reply,
          'INVALID_EXPERIMENT_SUITE',
          parsed.error.issues[0]?.message,
        );
      }
      const journey = dependencies.projects.getJourney(
        request.params.journeyId,
      );
      if (journey === null) return notFound(reply, 'Journey');
      const target = journey.steps.find(
        (step) => step.id === parsed.data.tests[0]?.targetStepId,
      );
      if (
        target === undefined ||
        (target.type !== 'click' && target.type !== 'submit')
      ) {
        return invalid(
          reply,
          'INCOMPATIBLE_TARGET_STEP',
          'Impatient User can target only recorded click or submit steps.',
        );
      }
      try {
        const versions = dependencies.experiments.createTestSuite({
          projectId: journey.projectId,
          journey,
          requests: parsed.data.tests,
        });
        return reply
          .status(201)
          .send(externalExperimentListSchema.parse({ items: versions }));
      } catch (error: unknown) {
        if (error instanceof ExternalTestNameExistsError) {
          return reply.status(409).send({
            error: {
              code: 'TEST_NAME_EXISTS',
              message: error.message,
            },
          });
        }
        throw error;
      }
    },
  );

  app.post<{ Params: TestParams }>(
    '/api/external-experiments/:testId/versions',
    async (request, reply) => {
      const parsed = createExternalExperimentVersionRequestSchema.safeParse(
        request.body,
      );
      if (!parsed.success) {
        return invalid(
          reply,
          'INVALID_EXPERIMENT_VERSION',
          parsed.error.issues[0]?.message,
        );
      }
      if (
        dependencies.experiments.getLatestVersion(request.params.testId) ===
        null
      ) {
        return notFound(reply, 'Test');
      }
      const version = dependencies.experiments.createVersion({
        testId: request.params.testId,
        request: parsed.data,
      });
      return reply
        .status(201)
        .send(externalExperimentVersionSchema.parse(version));
    },
  );

  app.get<{ Params: JourneyParams }>(
    '/api/journeys/:journeyId/experiments',
    async (request, reply) => {
      if (dependencies.projects.getJourney(request.params.journeyId) === null) {
        return notFound(reply, 'Journey');
      }
      return reply.send(
        externalExperimentListSchema.parse({
          items: dependencies.experiments.listVersions(
            request.params.journeyId,
          ),
        }),
      );
    },
  );

  app.get<{ Params: JourneyParams }>(
    '/api/journeys/:journeyId/tests',
    async (request, reply) => {
      if (dependencies.projects.getJourney(request.params.journeyId) === null) {
        return notFound(reply, 'Journey');
      }
      return reply.send(
        externalTestSummaryListSchema.parse({
          items: dependencies.experiments.listTestSummaries(
            request.params.journeyId,
          ),
        }),
      );
    },
  );

  app.get<{ Params: TestParams }>(
    '/api/external-tests/:testId',
    async (request, reply) => {
      const detail = dependencies.experiments.getTestDetail(
        request.params.testId,
      );
      return detail === null
        ? notFound(reply, 'Test')
        : reply.send(externalTestDetailSchema.parse(detail));
    },
  );

  app.delete<{ Params: TestParams }>(
    '/api/external-tests/:testId',
    async (request, reply) => {
      const artifacts = dependencies.experiments.deleteTest(
        request.params.testId,
      );
      if (artifacts === null) return notFound(reply, 'Test');
      artifactStore.remove(artifacts);
      return reply.send(
        deleteResourceResponseSchema.parse({
          deletedId: request.params.testId,
        }),
      );
    },
  );

  app.get<{ Params: ExperimentParams }>(
    '/api/external-experiments/:experimentVersionId',
    async (request, reply) => {
      const experiment = dependencies.experiments.resolveVersion(
        request.params.experimentVersionId,
      );
      return experiment === null
        ? notFound(reply, 'Experiment version')
        : reply.send(experiment);
    },
  );

  app.delete<{ Params: ExperimentParams }>(
    '/api/external-experiments/:experimentVersionId',
    async (request, reply) => {
      const artifacts = dependencies.experiments.deleteVersion(
        request.params.experimentVersionId,
      );
      if (artifacts === null) return notFound(reply, 'Experiment version');
      artifactStore.remove(artifacts);
      return reply.send(
        deleteResourceResponseSchema.parse({
          deletedId: request.params.experimentVersionId,
        }),
      );
    },
  );

  app.post<{ Params: ExperimentParams }>(
    '/api/external-experiments/:experimentVersionId/runs',
    async (request, reply) => {
      const parsed = runExternalExperimentRequestSchema.safeParse(
        request.body ?? {},
      );
      if (!parsed.success)
        return invalid(
          reply,
          'INVALID_RUN_REQUEST',
          parsed.error.issues[0]?.message,
        );
      try {
        return reply.send(
          externalRunDetailSchema.parse(
            await dependencies.runner.run(
              request.params.experimentVersionId,
              parsed.data.variables,
              parsed.data.confirmProduction,
              parsed.data.replayMode,
              parsed.data.replayPacing,
            ),
          ),
        );
      } catch (error: unknown) {
        return handleExecutionError(reply, error);
      }
    },
  );

  app.get<{ Params: RunParams }>(
    '/api/external-runs/:runId',
    async (request, reply) => {
      const run = dependencies.experiments.getRun(request.params.runId);
      return run === null ? notFound(reply, 'External run') : reply.send(run);
    },
  );

  app.post('/api/external-run-comparisons', async (request, reply) => {
    const parsed = externalRunComparisonRequestSchema.safeParse(request.body);
    if (!parsed.success) {
      return invalid(
        reply,
        'INVALID_EXTERNAL_RUN_COMPARISON',
        parsed.error.issues[0]?.message,
      );
    }
    const before = dependencies.experiments.getRun(parsed.data.beforeRunId);
    if (before === null) return notFound(reply, 'Before external run');
    const after = dependencies.experiments.getRun(parsed.data.afterRunId);
    if (after === null) return notFound(reply, 'After external run');
    return reply.send(
      externalRunComparisonResponseSchema.parse(
        compareExternalRuns(before, after),
      ),
    );
  });

  app.delete<{ Params: RunParams }>(
    '/api/external-runs/:runId',
    async (request, reply) => {
      const artifacts = dependencies.experiments.deleteRun(
        request.params.runId,
      );
      if (artifacts === null) return notFound(reply, 'External run');
      artifactStore.remove(artifacts);
      return reply.send(
        deleteResourceResponseSchema.parse({
          deletedId: request.params.runId,
        }),
      );
    },
  );

  app.get<{ Querystring: ExternalRunQuery }>(
    '/api/external-runs',
    async (request, reply) => {
      const parsed = externalRunListQuerySchema.safeParse(request.query);
      if (!parsed.success) {
        return invalid(
          reply,
          'INVALID_EXTERNAL_RUN_QUERY',
          parsed.error.issues[0]?.message,
        );
      }
      return reply.send(
        externalRunListSchema.parse(
          dependencies.experiments.listRuns(parsed.data),
        ),
      );
    },
  );

  app.get<{ Params: ArtifactParams }>(
    '/api/external-runs/:runId/artifacts/:artifactId',
    async (request, reply) => {
      const artifact = dependencies.experiments.getArtifact(
        request.params.runId,
        request.params.artifactId,
      );
      if (artifact === null) return notFound(reply, 'Artifact');
      try {
        return reply.type(artifact.mimeType).send(artifactStore.read(artifact));
      } catch {
        return notFound(reply, 'Artifact');
      }
    },
  );
}

function handleExecutionError(reply: FastifyReply, error: unknown) {
  if (error instanceof MissingRuntimeVariablesError) {
    return reply.status(400).send({
      error: {
        code: 'MISSING_RUNTIME_VARIABLES',
        message: 'Required runtime variables are not configured.',
        missingVariables: error.missingVariables,
      },
    });
  }
  if (error instanceof InvalidTemplateError) {
    return invalid(reply, 'INVALID_TEMPLATE', error.message);
  }
  if (error instanceof BrowserOwnershipConflictError) {
    return conflict(reply, error.message);
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
  return invalid(reply, 'EXTERNAL_EXECUTION_INVALID', publicMessage(error));
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

function publicMessage(error: unknown): string {
  return error instanceof Error
    ? error.message
    : 'The operation could not be completed.';
}
