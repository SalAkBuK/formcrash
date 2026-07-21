import { randomUUID } from 'node:crypto';

import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  externalExperimentListSchema,
  externalExperimentVersionSchema,
  externalRunDetailSchema,
  externalRunListSchema,
  externalTestDetailSchema,
  externalTestSummaryListSchema,
  networkEvidenceCandidateListSchema,
  projectSchema,
  requestDiscoveryResultSchema,
} from '@formcrash/contracts';

import { createApp } from '../src/app/create-app.js';
import { initializePersistence } from '../src/persistence/initialize.js';
import { ExternalExperimentRepository } from '../src/persistence/external-experiment-repository.js';
import { ProjectJourneyRepository } from '../src/persistence/project-journey-repository.js';
import { SavedAuthenticationExpiredError } from '../src/runner/external/authentication-redirect.js';
import { RequestDiscoveryService } from '../src/runner/external/request-discovery.js';
import { JourneyReplayService } from '../src/runner/recording/journey-replay.js';
import { createTemporaryTestConfig } from './fixtures.js';

const apps: ReturnType<typeof createApp>[] = [];
const cleanups: Array<() => void> = [];

afterEach(async () => {
  vi.restoreAllMocks();
  await Promise.all(apps.splice(0).map(async (app) => app.close()));
  for (const cleanup of cleanups.splice(0)) cleanup();
});

describe('external lifecycle and safety routes', () => {
  it('returns recording-time candidates without executing another replay', async () => {
    const temporary = createTemporaryTestConfig();
    cleanups.push(temporary.cleanup);
    const database = initializePersistence(temporary.config);
    const projects = new ProjectJourneyRepository(database.connection);
    const project = projects.createProject({
      name: 'Recorded evidence target',
      targetUrl: 'https://example.test/form',
      environment: 'staging',
      description: '',
    });
    const session = projects.createRecordingSession(project.id);
    projects.updateRecordingSession({
      id: session.id,
      status: 'completed',
      completedAt: '2026-07-20T20:00:02.000Z',
      requestEvidence: [
        {
          actionStepId: 'submit',
          method: 'POST',
          origin: 'https://api.example.test',
          host: 'api.example.test',
          pathname: '/v1/tenants',
          status: 201,
          failed: false,
          relativeTimestampMs: 20,
          occurrences: 1,
          observedAt: '2026-07-20T20:00:01.000Z',
        },
      ],
    });
    const journey = projects.saveJourney({
      projectId: project.id,
      name: 'Recorded evidence journey',
      steps: [
        {
          id: 'submit',
          name: 'Submit tenant',
          type: 'submit',
          timestamp: 0,
          url: project.targetUrl,
          locator: { strategy: 'id', value: 'form' },
          fingerprint: null,
          value: null,
          sensitive: false,
        },
      ],
      metadata: {
        recordingSessionId: session.id,
        recordedAt: '2026-07-20T20:00:00.000Z',
        warningCount: 0,
        normalizationRule: 'test',
      },
    });
    database.close();
    const app = createApp({ config: temporary.config, logger: false });
    apps.push(app);

    const response = await app.inject({
      method: 'GET',
      url: `/api/journeys/${journey.id}/network-evidence-candidates?targetStepId=submit`,
    });
    const result = networkEvidenceCandidateListSchema.parse(response.json());

    expect(response.statusCode).toBe(200);
    expect(result.source).toBe('recording');
    expect(result.items[0]).toMatchObject({
      source: 'recording',
      sourceRunId: null,
      method: 'POST',
      host: 'api.example.test',
      pathname: '/v1/tenants',
    });
    expect(JSON.stringify(result)).not.toContain('headers');
    expect(JSON.stringify(result)).not.toContain('query');
  });

  it('offers legacy prior-run evidence only as an explicit approval candidate', async () => {
    const temporary = createTemporaryTestConfig();
    cleanups.push(temporary.cleanup);
    const database = initializePersistence(temporary.config);
    const projects = new ProjectJourneyRepository(database.connection);
    const experiments = new ExternalExperimentRepository(database.connection);
    const project = projects.createProject({
      name: 'Legacy evidence target',
      targetUrl: 'https://example.test/form',
      environment: 'staging',
      description: '',
    });
    const journey = createJourney(projects, project.id);
    const version = createVersion(experiments, journey);
    const runId = randomUUID();
    const startedAt = '2026-07-20T20:00:00.000Z';
    experiments.createRun({
      runId,
      experiment: version,
      targetUrl: project.targetUrl,
      projectName: project.name,
      journeyName: journey.name,
      safeResolvedValues: {},
      startedAt,
    });
    experiments.appendEvent({
      eventId: randomUUID(),
      runId,
      eventType: 'experiment.triggered',
      sequence: 1,
      relativeTimestampMs: 100,
      recordedAt: startedAt,
      schemaVersion: 1,
      payload: { targetStepId: 'submit', triggerNumber: 1 },
    });
    experiments.finalizeRun({
      runId,
      status: 'passed',
      completedAt: '2026-07-20T20:00:02.000Z',
      durationMs: 2_000,
      triggerAttempts: 2,
      networkObservations: [
        {
          requestId: 'request-1',
          method: 'POST',
          pathname: '/api/tenants',
          origin: 'https://example.test',
          startedAtMs: 120,
          completedAtMs: 180,
          status: 201,
          failed: false,
          matched: false,
        },
      ],
      runnerError: null,
      warnings: [],
      assertions: [],
    });
    database.close();
    const app = createApp({ config: temporary.config, logger: false });
    apps.push(app);

    const result = networkEvidenceCandidateListSchema.parse(
      (
        await app.inject({
          method: 'GET',
          url: `/api/journeys/${journey.id}/network-evidence-candidates?targetStepId=submit`,
        })
      ).json(),
    );

    expect(result.source).toBe('prior_run');
    expect(result.items[0]).toMatchObject({
      source: 'prior_run',
      sourceRunId: runId,
      relativeTimestampMs: 20,
    });
    expect(result.explanation).toContain('explicit approval');
  });

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
      expect.objectContaining({
        runId,
        assertionCount: 1,
        canonicalVerdict: 'passed',
        verdictBasis: 'technical_checks_only',
      }),
    ]);

    const detail = externalRunDetailSchema.parse(
      (
        await app.inject({
          method: 'GET',
          url: `/api/external-runs/${runId}`,
        })
      ).json(),
    );
    expect(detail).toEqual(
      expect.objectContaining({
        runId,
        canonicalVerdict: 'passed',
        verdictBasis: 'technical_checks_only',
      }),
    );

    const duplicate = await app.inject({
      method: 'POST',
      url: `/api/journeys/${journey.id}/experiments`,
      payload: {
        name: version.name,
        ...versionConfiguration(version),
      },
    });
    expect(duplicate.statusCode).toBe(409);
    expect(duplicate.json()).toMatchObject({
      error: { code: 'TEST_NAME_EXISTS' },
    });

    const second = externalExperimentVersionSchema.parse(
      (
        await app.inject({
          method: 'POST',
          url: `/api/journeys/${journey.id}/experiments`,
          payload: {
            name: 'Independent lifecycle test',
            ...versionConfiguration(version),
          },
        })
      ).json(),
    );
    expect(second).toMatchObject({ version: 1, journeyId: journey.id });
    expect(second.experimentId).not.toBe(version.experimentId);

    const suite = externalExperimentListSchema.parse(
      (
        await app.inject({
          method: 'POST',
          url: `/api/journeys/${journey.id}/experiment-suite`,
          payload: {
            tests: [
              {
                name: 'Suite double-click',
                ...versionConfiguration(version),
                triggerCount: 2,
                intervalMs: 0,
              },
              {
                name: 'Suite triple-click',
                ...versionConfiguration(version),
                triggerCount: 3,
                intervalMs: 100,
              },
              {
                name: 'Suite delayed repeat',
                ...versionConfiguration(version),
                triggerCount: 2,
                intervalMs: 300,
              },
            ],
          },
        })
      ).json(),
    );
    expect(suite.items).toHaveLength(3);
    expect(
      suite.items.map((item) => [item.triggerCount, item.intervalMs]),
    ).toEqual([
      [2, 0],
      [3, 100],
      [2, 300],
    ]);

    const versionTwoResponse = await app.inject({
      method: 'POST',
      url: `/api/external-experiments/${version.experimentId}/versions`,
      payload: {
        ...versionConfiguration(version),
        intervalMs: 300,
      },
    });
    expect(versionTwoResponse.statusCode).toBe(201);
    const versionTwo = externalExperimentVersionSchema.parse(
      versionTwoResponse.json(),
    );
    expect(versionTwo).toMatchObject({
      experimentId: version.experimentId,
      version: 2,
      intervalMs: 300,
    });

    const stableTests = externalTestSummaryListSchema.parse(
      (
        await app.inject({
          method: 'GET',
          url: `/api/journeys/${journey.id}/tests`,
        })
      ).json(),
    );
    expect(stableTests.items).toHaveLength(5);
    expect(
      stableTests.items.find((test) => test.testId === version.experimentId),
    ).toMatchObject({
      versionCount: 2,
      runCount: 1,
      latestVersion: { id: versionTwo.id, version: 2 },
      latestRun: { runId },
    });
    expect(
      stableTests.items.find((test) => test.testId === second.experimentId),
    ).toMatchObject({
      versionCount: 1,
      runCount: 0,
      latestVersion: { id: second.id, version: 1 },
      latestRun: null,
    });

    const stableTestDetail = externalTestDetailSchema.parse(
      (
        await app.inject({
          method: 'GET',
          url: `/api/external-tests/${version.id}`,
        })
      ).json(),
    );
    expect(stableTestDetail).toMatchObject({
      testId: version.experimentId,
      versionCount: 2,
      runCount: 1,
    });
    expect(stableTestDetail.versions.map((item) => item.id)).toEqual([
      versionTwo.id,
      version.id,
    ]);
    expect(stableTestDetail.runs.map((item) => item.runId)).toEqual([runId]);

    const stableDetail = externalExperimentVersionSchema.parse(
      (
        await app.inject({
          method: 'GET',
          url: `/api/external-experiments/${version.experimentId}`,
        })
      ).json(),
    );
    expect(stableDetail.id).toBe(versionTwo.id);

    const projectVersions = externalExperimentListSchema.parse(
      (
        await app.inject({
          method: 'GET',
          url: `/api/projects/${project.id}/experiments`,
        })
      ).json(),
    );
    expect(projectVersions.items).toHaveLength(6);
    expect(projectVersions.items).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: version.id, projectId: project.id }),
        expect.objectContaining({ id: versionTwo.id, version: 2 }),
        expect.objectContaining({ id: second.id, version: 1 }),
        ...suite.items.map((item) =>
          expect.objectContaining({ id: item.id, version: 1 }),
        ),
      ]),
    );

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

  it('deletes a stable test with every version, run, and artifact record', async () => {
    const temporary = createTemporaryTestConfig();
    cleanups.push(temporary.cleanup);
    const database = initializePersistence(temporary.config);
    const projects = new ProjectJourneyRepository(database.connection);
    const experiments = new ExternalExperimentRepository(database.connection);
    const project = projects.createProject({
      name: 'Test deletion target',
      targetUrl: 'http://localhost:4300',
      environment: 'local',
      description: '',
    });
    const journey = createJourney(projects, project.id);
    const versionOne = createVersion(experiments, journey);
    const versionTwo = experiments.createVersion({
      testId: versionOne.experimentId,
      request: {
        ...versionConfiguration(versionOne),
        intervalMs: 100,
      },
    });
    const runId = randomUUID();
    const startedAt = new Date().toISOString();
    experiments.createRun({
      runId,
      experiment: versionOne,
      targetUrl: project.targetUrl,
      projectName: project.name,
      journeyName: journey.name,
      safeResolvedValues: {},
      startedAt,
    });
    experiments.createArtifact({
      runId,
      label: 'before-disruption',
      relativePath: `screenshots/${runId}/001-before-disruption.png`,
      sizeBytes: 10,
      checksumSha256: '0'.repeat(64),
      captureSequence: 1,
      createdAt: startedAt,
      metadata: { fullPage: true },
    });
    database.close();

    const app = createApp({ config: temporary.config, logger: false });
    apps.push(app);
    const deleted = await app.inject({
      method: 'DELETE',
      url: `/api/external-tests/${versionOne.experimentId}`,
    });

    expect(deleted.statusCode).toBe(200);
    expect(deleted.json()).toEqual({ deletedId: versionOne.experimentId });
    expect(
      (
        await app.inject({
          method: 'GET',
          url: `/api/external-tests/${versionOne.experimentId}`,
        })
      ).statusCode,
    ).toBe(404);
    expect(
      (
        await app.inject({
          method: 'GET',
          url: `/api/external-experiments/${versionOne.id}`,
        })
      ).statusCode,
    ).toBe(404);
    expect(
      (
        await app.inject({
          method: 'GET',
          url: `/api/external-experiments/${versionTwo.id}`,
        })
      ).statusCode,
    ).toBe(404);
    expect(
      (
        await app.inject({
          method: 'GET',
          url: `/api/external-runs/${runId}`,
        })
      ).statusCode,
    ).toBe(404);
    const remaining = externalTestSummaryListSchema.parse(
      (
        await app.inject({
          method: 'GET',
          url: `/api/journeys/${journey.id}/tests`,
        })
      ).json(),
    );
    expect(remaining.items).toEqual([]);
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

  it('returns a recoverable authentication error when replay detects an expired session', async () => {
    const temporary = createTemporaryTestConfig();
    cleanups.push(temporary.cleanup);
    const database = initializePersistence(temporary.config);
    const projects = new ProjectJourneyRepository(database.connection);
    const project = projects.createProject({
      name: 'Expired session target',
      targetUrl: 'http://localhost:4300/portal',
      environment: 'local',
      description: '',
    });
    const journey = createJourney(projects, project.id);
    database.close();
    vi.spyOn(JourneyReplayService.prototype, 'replay').mockRejectedValue(
      new SavedAuthenticationExpiredError(),
    );
    const app = createApp({ config: temporary.config, logger: false });
    apps.push(app);

    const response = await app.inject({
      method: 'POST',
      url: `/api/journeys/${journey.id}/replay`,
      payload: { variables: {}, confirmProduction: true },
    });

    expect(response.statusCode).toBe(409);
    expect(response.json()).toMatchObject({
      error: {
        code: 'AUTHENTICATION_REQUIRED',
        message:
          'The saved authentication session appears to have expired. Sign in again and recapture authentication before retrying.',
      },
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
  return experiments.createTest({
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

function versionConfiguration(version: ReturnType<typeof createVersion>) {
  return {
    targetStepId: version.targetStepId,
    triggerCount: version.triggerCount,
    intervalMs: version.intervalMs,
    networkMatcher: version.networkMatcher,
    assertions: version.assertions,
    continueAfterTarget: version.continueAfterTarget,
    guided: version.guided,
    requestSelectionProvenance: version.requestSelectionProvenance,
    networkEvidenceProvenance: version.networkEvidenceProvenance,
    assertionSelectionProvenance: version.assertionSelectionProvenance,
  };
}
