import { randomUUID } from 'node:crypto';

import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  externalExperimentVersionSchema,
  externalRunListSchema,
  projectSchema,
  requestDiscoveryResultSchema,
} from '@formcrash/contracts';

import { createApp } from '../src/app/create-app.js';
import { initializePersistence } from '../src/persistence/initialize.js';
import { ExternalExperimentRepository } from '../src/persistence/external-experiment-repository.js';
import { ProjectJourneyRepository } from '../src/persistence/project-journey-repository.js';
import { RequestDiscoveryService } from '../src/runner/external/request-discovery.js';
import { createTemporaryTestConfig } from './fixtures.js';

const apps: ReturnType<typeof createApp>[] = [];
const cleanups: Array<() => void> = [];

afterEach(async () => {
  vi.restoreAllMocks();
  await Promise.all(apps.splice(0).map(async (app) => app.close()));
  for (const cleanup of cleanups.splice(0)) cleanup();
});

describe('external lifecycle and safety routes', () => {
  it('lists and deletes persisted runs, versions, journeys, and projects', async () => {
    const temporary = createTemporaryTestConfig();
    cleanups.push(temporary.cleanup);
    const database = initializePersistence(temporary.config);
    const projects = new ProjectJourneyRepository(database.connection);
    const experiments = new ExternalExperimentRepository(database.connection);
    const project = projects.createProject({
      name: 'Lifecycle target',
      targetUrl: 'http://localhost:4300',
      environment: 'local',
      description: '',
    });
    const journey = createJourney(projects, project.id);
    const version = createVersion(experiments, journey);
    const runId = randomUUID();
    const startedAt = new Date().toISOString();
    experiments.createRun({
      runId,
      experiment: version,
      targetUrl: project.targetUrl,
      projectName: project.name,
      journeyName: journey.name,
      safeResolvedValues: {},
      startedAt,
    });
    experiments.finalizeRun({
      runId,
      status: 'passed',
      completedAt: startedAt,
      durationMs: 0,
      triggerAttempts: 2,
      networkObservations: [],
      runnerError: null,
      warnings: [],
      assertions: [
        {
          assertionResultId: randomUUID(),
          assertionId: 'visible',
          type: 'element_visible',
          status: 'passed',
          description: 'Visible',
          expectedDescription: 'Visible',
          observedDescription: 'Visible',
          evaluatedAt: startedAt,
        },
      ],
    });
    database.close();

    const app = createApp({ config: temporary.config, logger: false });
    apps.push(app);
    const listed = externalRunListSchema.parse(
      (
        await app.inject({
          method: 'GET',
          url: `/api/external-runs?projectId=${project.id}`,
        })
      ).json(),
    );
    expect(listed.items).toEqual([
      expect.objectContaining({ runId, assertionCount: 1 }),
    ]);

    expect(
      (
        await app.inject({
          method: 'DELETE',
          url: `/api/external-runs/${runId}`,
        })
      ).statusCode,
    ).toBe(200);
    expect(
      (
        await app.inject({
          method: 'DELETE',
          url: `/api/external-experiments/${version.id}`,
        })
      ).statusCode,
    ).toBe(200);
    expect(
      (
        await app.inject({
          method: 'DELETE',
          url: `/api/journeys/${journey.id}`,
        })
      ).statusCode,
    ).toBe(200);
    expect(
      (
        await app.inject({
          method: 'DELETE',
          url: `/api/projects/${project.id}?force=true`,
        })
      ).statusCode,
    ).toBe(200);
  });

  it('rejects production replay until confirmation is explicit', async () => {
    const temporary = createTemporaryTestConfig();
    cleanups.push(temporary.cleanup);
    const database = initializePersistence(temporary.config);
    const projects = new ProjectJourneyRepository(database.connection);
    const project = projects.createProject({
      name: 'Production target',
      targetUrl: 'https://example.test/portal',
      environment: 'production',
      description: '',
    });
    const journey = createJourney(projects, project.id);
    database.close();
    const app = createApp({ config: temporary.config, logger: false });
    apps.push(app);

    const response = await app.inject({
      method: 'POST',
      url: `/api/journeys/${journey.id}/replay`,
      payload: { variables: {}, confirmProduction: false },
    });
    expect(response.statusCode).toBe(409);
    expect(response.json()).toMatchObject({
      error: { code: 'PRODUCTION_CONFIRMATION_REQUIRED' },
    });
  });

  it('persists an explicit project environment through the API', async () => {
    const temporary = createTemporaryTestConfig();
    cleanups.push(temporary.cleanup);
    const app = createApp({ config: temporary.config, logger: false });
    apps.push(app);
    const response = await app.inject({
      method: 'POST',
      url: '/api/projects',
      payload: {
        name: 'Staging target',
        targetUrl: 'https://staging.example.test',
        environment: 'staging',
      },
    });
    expect(response.statusCode).toBe(201);
    expect(projectSchema.parse(response.json()).environment).toBe('staging');
  });

  it('returns ranked discovery evidence and persists its bounded selection provenance through routes', async () => {
    const temporary = createTemporaryTestConfig();
    cleanups.push(temporary.cleanup);
    const database = initializePersistence(temporary.config);
    const projects = new ProjectJourneyRepository(database.connection);
    const project = projects.createProject({
      name: 'Recommendation route target',
      targetUrl: 'https://example.test/form',
      environment: 'staging',
      description: '',
    });
    const journey = createJourney(projects, project.id);
    database.close();
    const discovery = requestDiscoveryResultSchema.parse({
      discoveryId: '11111111-2222-4333-8444-555555555555',
      discoveredAt: '2026-07-16T00:00:00.000Z',
      journeyId: journey.id,
      targetStepId: 'submit',
      candidates: [
        {
          candidateId: 'request-0123456789abcdef01234567',
          rank: 1,
          score: 108,
          classification: 'likely_business_mutation',
          confidence: 'high',
          recommended: true,
          reasons: [
            {
              code: 'mutation_method',
              label: 'POST can change server state.',
              scoreImpact: 50,
            },
          ],
          method: 'POST',
          pathname: '/api/tenants',
          origin: 'https://example.test',
          status: 201,
          failed: false,
          relativeTimestampMs: 4,
          occurrences: 1,
        },
      ],
      recommendation: {
        outcome: 'recommended',
        recommendedCandidateId: 'request-0123456789abcdef01234567',
        explanation: 'One clear mutation was identified.',
      },
      normalAction: {
        targetControlLocator: null,
        targetWasDisabledDuringPending: null,
        finalPathname: '/form',
        elements: [],
      },
      assertionRecommendationSets: [
        {
          recipeType: 'duplicate_action',
          selectedRequestCandidateId: 'request-0123456789abcdef01234567',
          recommendations: [],
          limitations: [],
        },
      ],
    });
    vi.spyOn(RequestDiscoveryService.prototype, 'discover').mockResolvedValue(
      discovery,
    );
    const app = createApp({ config: temporary.config, logger: false });
    apps.push(app);

    const discoveryResponse = await app.inject({
      method: 'POST',
      url: `/api/journeys/${journey.id}/request-discovery`,
      payload: {
        targetStepId: 'submit',
        recipe: {
          type: 'duplicate_action',
          triggerCount: 2,
          intervalMs: 0,
        },
        variables: {},
        confirmProduction: true,
      },
    });
    expect(discoveryResponse.statusCode).toBe(200);
    expect(
      requestDiscoveryResultSchema.parse(discoveryResponse.json()),
    ).toEqual(discovery);

    const matcher = {
      method: 'POST',
      pathname: '/api/tenants',
      host: 'example.test',
    };
    const experimentResponse = await app.inject({
      method: 'POST',
      url: `/api/journeys/${journey.id}/experiments`,
      payload: {
        name: 'Recommended tenant request',
        targetStepId: 'submit',
        triggerCount: 2,
        intervalMs: 0,
        networkMatcher: matcher,
        assertions: [
          {
            id: 'one-request',
            type: 'network_request_max',
            maximum: 1,
            description: 'At most one tenant request occurs.',
          },
        ],
        continueAfterTarget: false,
        requestSelectionProvenance: {
          selectionMode: 'confirmed_recommendation',
          discoveryId: discovery.discoveryId,
          discoveredAt: discovery.discoveredAt,
          discoveryOutcome: 'recommended',
          selectedCandidateId: 'request-0123456789abcdef01234567',
          selectedCandidateScore: 108,
          selectedCandidateConfidence: 'high',
          recommendationReasons: discovery.candidates[0]?.reasons ?? [],
          recommendedMatcher: matcher,
          selectedMatcher: matcher,
          userOverrodeRecommendation: false,
        },
      },
    });

    expect(experimentResponse.statusCode).toBe(201);
    expect(
      externalExperimentVersionSchema.parse(experimentResponse.json())
        .requestSelectionProvenance,
    ).toMatchObject({
      selectionMode: 'confirmed_recommendation',
      selectedCandidateScore: 108,
      selectedMatcher: matcher,
    });
  });
});

function createJourney(projects: ProjectJourneyRepository, projectId: string) {
  return projects.saveJourney({
    projectId,
    name: 'Lifecycle journey',
    steps: [
      {
        id: 'submit',
        name: 'Submit',
        type: 'submit',
        timestamp: 0,
        url: projects.getProject(projectId)?.targetUrl ?? '',
        locator: { strategy: 'id', value: 'form' },
        fingerprint: null,
        value: null,
        sensitive: false,
      },
    ],
    metadata: {
      recordingSessionId: null,
      recordedAt: new Date(0).toISOString(),
      warningCount: 0,
      normalizationRule: 'test',
    },
  });
}

function createVersion(
  experiments: ExternalExperimentRepository,
  journey: ReturnType<typeof createJourney>,
) {
  return experiments.createVersion({
    projectId: journey.projectId,
    journey,
    request: {
      name: 'Lifecycle experiment',
      targetStepId: 'submit',
      triggerCount: 2,
      intervalMs: 0,
      networkMatcher: null,
      assertions: [
        {
          id: 'visible',
          type: 'element_visible',
          locator: { strategy: 'id', value: 'complete' },
          targetDescription: 'Complete',
          description: 'Visible',
        },
      ],
      continueAfterTarget: false,
      requestSelectionProvenance: null,
    },
  });
}
