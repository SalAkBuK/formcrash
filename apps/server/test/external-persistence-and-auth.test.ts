import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import type { FormCrashDatabase } from '../src/persistence/database.js';
import { initializePersistence } from '../src/persistence/initialize.js';
import {
  ExternalExperimentRepository,
  ExternalTestNameExistsError,
} from '../src/persistence/external-experiment-repository.js';
import { OutcomeCheckRepository } from '../src/persistence/outcome-check-repository.js';
import { ProjectJourneyRepository } from '../src/persistence/project-journey-repository.js';
import { ProjectSettingsRepository } from '../src/persistence/project-settings-repository.js';
import { RunPersistenceError } from '../src/persistence/run-repository.js';
import { AuthStateStore } from '../src/runner/external/auth-session.js';
import { ProjectSettingsService } from '../src/runner/external/project-settings-service.js';
import {
  assertProductionConfirmed,
  ProductionConfirmationRequiredError,
} from '../src/runner/external/production-safety.js';
import {
  BrowserOwnership,
  BrowserOwnershipConflictError,
  type BrowserWorkload,
} from '../src/runner/infrastructure/browser-ownership.js';
import {
  createTemporaryTestConfig,
  type TemporaryTestConfig,
} from './fixtures.js';

let temporary: TemporaryTestConfig;
let database: FormCrashDatabase;
let projects: ProjectJourneyRepository;
let settings: ProjectSettingsRepository;
let experiments: ExternalExperimentRepository;

beforeEach(() => {
  temporary = createTemporaryTestConfig();
  database = initializePersistence(temporary.config);
  projects = new ProjectJourneyRepository(database.connection);
  settings = new ProjectSettingsRepository(database.connection);
  experiments = new ExternalExperimentRepository(database.connection);
});

afterEach(() => {
  database.close();
  temporary.cleanup();
});

describe('authentication state persistence', () => {
  it('returns metadata only and clearing removes usable local state', async () => {
    const project = projects.createProject({
      name: 'Authentication project',
      targetUrl: 'https://example.test',
      description: '',
    });
    const store = new AuthStateStore(temporary.config.artifactRoot, settings);
    await store.save(project.id, {
      saveStorageState: (destination) => {
        mkdirSync(path.dirname(destination), { recursive: true });
        writeFileSync(
          destination,
          JSON.stringify({
            cookies: [{ name: 'session', value: 'cookie-secret' }],
          }),
        );
        return Promise.resolve();
      },
      close: () => Promise.resolve(),
    });
    const usablePath = store.usablePath(project.id);
    const publicSettings = new ProjectSettingsService(
      projects,
      settings,
      store,
    ).get(project.id);

    expect(usablePath).not.toBeNull();
    expect(existsSync(usablePath ?? '')).toBe(true);
    expect(publicSettings.authentication).toMatchObject({
      configured: true,
      available: true,
    });
    expect(JSON.stringify(publicSettings)).not.toContain('cookie-secret');
    expect(JSON.stringify(publicSettings)).not.toContain('storage-state.json');
    expect(JSON.stringify(publicSettings)).not.toContain(temporary.root);

    new ProjectSettingsService(projects, settings, store).clearAuthentication(
      project.id,
    );
    expect(store.usablePath(project.id)).toBeNull();
    expect(existsSync(usablePath ?? '')).toBe(false);
  });
});

describe('production replay acknowledgement persistence', () => {
  it('persists independently from execution settings and can be revoked', () => {
    const project = projects.createProject({
      name: 'Production replay project',
      targetUrl: 'https://example.test',
      environment: 'production',
      description: '',
    });
    const service = new ProjectSettingsService(
      projects,
      settings,
      new AuthStateStore(temporary.config.artifactRoot, settings),
    );

    expect(service.get(project.id)).toMatchObject({
      productionReplayAcknowledged: false,
      productionReplayAcknowledgedAt: null,
    });

    const acknowledged = service.setProductionReplayAcknowledgement(
      project.id,
      true,
    );
    expect(acknowledged.productionReplayAcknowledged).toBe(true);
    expect(acknowledged.productionReplayAcknowledgedAt).not.toBeNull();

    service.save(project.id, {
      variables: [],
      beforeRunHook: null,
      afterRunHook: null,
    });
    expect(service.get(project.id).productionReplayAcknowledged).toBe(true);

    expect(
      service.setProductionReplayAcknowledgement(project.id, false),
    ).toMatchObject({
      productionReplayAcknowledged: false,
      productionReplayAcknowledgedAt: null,
    });
  });
});

describe('external experiment version persistence', () => {
  it('creates all three sibling recipe Tests atomically', () => {
    const project = projects.createProject({
      name: 'Generated suite project',
      targetUrl: 'https://example.test',
      description: '',
    });
    const journey = projects.saveJourney({
      projectId: project.id,
      name: 'Create parking slot',
      steps: [step('submit-step', 'submit')],
      metadata: {
        recordingSessionId: null,
        recordedAt: new Date(0).toISOString(),
        warningCount: 0,
        normalizationRule: 'test',
      },
    });
    const suiteRequests = [
      request('submit-step', 'Double-click: Create slot'),
      {
        ...request('submit-step', 'Triple-click: Create slot'),
        triggerCount: 3 as const,
        intervalMs: 100 as const,
      },
      {
        ...request('submit-step', 'Delayed repeat: Create slot'),
        intervalMs: 300 as const,
      },
    ];

    const versions = experiments.createTestSuite({
      projectId: project.id,
      journey,
      requests: suiteRequests,
    });

    expect(versions).toHaveLength(3);
    expect(
      versions.map((version) => [
        version.name,
        version.version,
        version.triggerCount,
        version.intervalMs,
      ]),
    ).toEqual([
      ['Double-click: Create slot', 1, 2, 0],
      ['Triple-click: Create slot', 1, 3, 100],
      ['Delayed repeat: Create slot', 1, 2, 300],
    ]);
    const collision = experiments.createTest({
      projectId: project.id,
      journey,
      request: request('submit-step', 'Existing collision'),
    });
    const versionCountBeforeConflict = experiments.listVersions(
      journey.id,
    ).length;

    expect(() =>
      experiments.createTestSuite({
        projectId: project.id,
        journey,
        requests: [
          request('submit-step', 'Transient double-click'),
          {
            ...request('submit-step', collision.name),
            triggerCount: 3,
            intervalMs: 100,
          },
          {
            ...request('submit-step', 'Transient delayed repeat'),
            intervalMs: 300,
          },
        ],
      }),
    ).toThrow(ExternalTestNameExistsError);
    expect(experiments.listVersions(journey.id)).toHaveLength(
      versionCountBeforeConflict,
    );
    expect(
      experiments
        .listVersions(journey.id)
        .some((version) => version.name.startsWith('Transient')),
    ).toBe(false);
  });

  it('creates independent Version 1 tests and versions only the addressed stable test', () => {
    const project = projects.createProject({
      name: 'Independent tests project',
      targetUrl: 'https://example.test',
      description: '',
    });
    const journey = projects.saveJourney({
      projectId: project.id,
      name: 'Shared journey',
      steps: [step('submit-step', 'submit')],
      metadata: {
        recordingSessionId: null,
        recordedAt: new Date(0).toISOString(),
        warningCount: 0,
        normalizationRule: 'test',
      },
    });
    const firstRequest = request('submit-step', 'Double submit');
    const secondRequest = request('submit-step', 'Triple submit');
    const first = experiments.createTest({
      projectId: project.id,
      journey,
      request: firstRequest,
    });
    const second = experiments.createTest({
      projectId: project.id,
      journey,
      request: { ...secondRequest, triggerCount: 3 },
    });

    expect([first.version, second.version]).toEqual([1, 1]);
    expect(first.experimentId).not.toBe(second.experimentId);
    expect(() =>
      experiments.createTest({
        projectId: project.id,
        journey,
        request: firstRequest,
      }),
    ).toThrow(ExternalTestNameExistsError);

    const firstV2 = experiments.createVersion({
      testId: first.experimentId,
      request: {
        targetStepId: firstRequest.targetStepId,
        triggerCount: firstRequest.triggerCount,
        intervalMs: 300,
        networkMatcher: firstRequest.networkMatcher,
        assertions: firstRequest.assertions,
        continueAfterTarget: firstRequest.continueAfterTarget,
        requestSelectionProvenance: firstRequest.requestSelectionProvenance,
      },
    });
    expect(firstV2).toMatchObject({
      experimentId: first.experimentId,
      version: 2,
      intervalMs: 300,
    });
    expect(experiments.getLatestVersion(second.experimentId)).toMatchObject({
      id: second.id,
      version: 1,
    });

    const startedAt = new Date().toISOString();
    experiments.createRun({
      runId: 'first-test-run',
      experiment: firstV2,
      targetUrl: project.targetUrl,
      projectName: project.name,
      journeyName: journey.name,
      safeResolvedValues: {},
      startedAt,
    });
    experiments.createRun({
      runId: 'second-test-run',
      experiment: second,
      targetUrl: project.targetUrl,
      projectName: project.name,
      journeyName: journey.name,
      safeResolvedValues: {},
      startedAt,
    });
    expect(
      experiments.getRun('first-test-run')?.experimentSnapshot,
    ).toMatchObject({ experimentId: first.experimentId, version: 2 });
    expect(
      experiments.getRun('second-test-run')?.experimentSnapshot,
    ).toMatchObject({ experimentId: second.experimentId, version: 1 });
  });

  it('accepts only click and submit targets and keeps versions immutable', () => {
    const project = projects.createProject({
      name: 'Version project',
      targetUrl: 'https://example.test',
      description: '',
    });
    const journey = projects.saveJourney({
      projectId: project.id,
      name: 'Versioned journey',
      steps: [
        step('fill-step', 'fill'),
        step('click-step', 'click'),
        step('submit-step', 'submit'),
      ],
      metadata: {
        recordingSessionId: null,
        recordedAt: new Date(0).toISOString(),
        warningCount: 0,
        normalizationRule: 'test',
      },
    });

    expect(() =>
      experiments.createTest({
        projectId: project.id,
        journey,
        request: request('fill-step', 'Rejected fill'),
      }),
    ).toThrow(RunPersistenceError);
    const click = experiments.createTest({
      projectId: project.id,
      journey,
      request: request('click-step', 'Compatible click'),
    });
    const submit = experiments.createTest({
      projectId: project.id,
      journey,
      request: request('submit-step', 'Compatible submit'),
    });
    expect([click.targetStepId, submit.targetStepId]).toEqual([
      'click-step',
      'submit-step',
    ]);

    expect(() =>
      database.connection
        .prepare(
          'UPDATE external_experiment_versions SET version = 99 WHERE id = ?',
        )
        .run(click.id),
    ).toThrow(/immutable/u);
    expect(experiments.getVersion(click.id)?.version).toBe(1);

    expect(projects.deleteProject(project.id)).toBe('has_activity');
    expect(experiments.deleteVersion(click.id)).toEqual([]);
    expect(experiments.getVersion(click.id)).toBeNull();
    expect(projects.deleteProject(project.id, true)).toBe('deleted');
    expect(projects.getProject(project.id)).toBeNull();
    expect(experiments.getVersion(submit.id)).toBeNull();
  });

  it('stores a guided snapshot with generated values and normalized adjacent fills', () => {
    const project = projects.createProject({
      name: 'Guided version project',
      targetUrl: 'https://example.test',
      description: '',
    });
    const firstFill = step('fill-name-first', 'fill');
    const journey = projects.saveJourney({
      projectId: project.id,
      name: 'Guided journey',
      steps: [
        firstFill,
        {
          ...step('fill-name-final', 'fill'),
          locator: firstFill.locator,
          value: { kind: 'safe' as const, value: 'Ada Lovelace' },
        },
        step('submit-step', 'submit'),
      ],
      metadata: {
        recordingSessionId: null,
        recordedAt: new Date(0).toISOString(),
        warningCount: 0,
        normalizationRule: 'test',
      },
    });

    const version = experiments.createTest({
      projectId: project.id,
      journey,
      request: {
        ...request('submit-step', 'Guided submit'),
        guided: true,
        normalizeJourney: true,
        stepValueOverrides: {
          'fill-name-final': '{{unique.name}}',
        },
      },
    });

    expect(version.guided).toBe(true);
    expect(version.journeySnapshot.steps.map((item) => item.id)).toEqual([
      'fill-name-final',
      'submit-step',
    ]);
    expect(version.journeySnapshot.steps[0]?.value).toEqual({
      kind: 'safe',
      value: '{{unique.name}}',
    });
    expect(
      version.journeySnapshot.recordingMetadata.normalizationRule,
    ).toContain('Guided Test');
  });

  it('keeps a saved Test replay aligned with its generated Outcome identity', () => {
    const project = projects.createProject({
      name: 'Parking slot project',
      targetUrl: 'https://example.test',
      description: '',
    });
    const journey = projects.saveJourney({
      projectId: project.id,
      name: 'Add Parking Slot',
      steps: [
        {
          ...step('fill-slot-code', 'fill'),
          name: 'Fill Slot Code *',
          locator: { strategy: 'name' as const, value: 'slotCode' },
          fingerprint: {
            tagName: 'input',
            inputType: 'text',
            dataFormcrash: null,
            dataTestId: null,
            id: 'slot-code',
            role: 'textbox',
            accessibleName: 'Slot Code *',
            name: 'slotCode',
            label: 'Slot Code *',
            text: null,
            cssPath: 'input[name="slotCode"]',
          },
          value: { kind: 'safe' as const, value: 'test-233' },
        },
        step('submit-step', 'submit'),
      ],
      metadata: {
        recordingSessionId: null,
        recordedAt: new Date(0).toISOString(),
        warningCount: 0,
        normalizationRule: 'test',
      },
    });
    const legacyVersion = experiments.createTest({
      projectId: project.id,
      journey,
      request: request('submit-step', 'Legacy recorded parking slot'),
    });
    const outcomes = new OutcomeCheckRepository(database.connection);
    const action = outcomes.approveCriticalAction(journey, {
      stepId: 'submit-step',
      label: 'Add Parking Slot',
    });
    const binding = {
      expression: 'unique.text' as const,
      template: '{{unique.text}}' as const,
      label: 'Generated unique identifier',
    };
    const target = {
      locator: { strategy: 'text' as const, value: '{{unique.text}}' },
      fingerprint: {
        tagName: 'td',
        inputType: null,
        dataFormcrash: null,
        dataTestId: null,
        id: null,
        role: 'cell',
        accessibleName: '{{unique.text}}',
        name: null,
        label: null,
        text: '{{unique.text}}',
        cssPath: 'td',
      },
      preview: '{{unique.text}}',
      reliability: 'high' as const,
      warnings: [],
      generatedBindings: [binding],
    };
    outcomes.saveOutcomeCheck({
      journeyId: journey.id,
      criticalActionId: action.id,
      type: 'matching_item_appears_exactly_once',
      description: 'Exactly one generated parking slot appears.',
      target,
      binding,
    });

    const version = experiments.createTest({
      projectId: project.id,
      journey,
      request: request('submit-step', 'Generated parking slot'),
    });

    expect(
      version.journeySnapshot.steps.find((item) => item.id === 'fill-slot-code')
        ?.value,
    ).toEqual({ kind: 'safe', value: '{{unique.text}}' });

    const repairedVersion = experiments.createVersion({
      testId: legacyVersion.experimentId,
      request: {
        targetStepId: 'submit-step',
        triggerCount: 2,
        intervalMs: 0,
        networkMatcher: null,
        assertions: request('submit-step', 'ignored').assertions,
        continueAfterTarget: false,
        requestSelectionProvenance: null,
      },
    });
    expect(legacyVersion.journeySnapshot.steps[0]?.value).toEqual({
      kind: 'safe',
      value: 'test-233',
    });
    expect(repairedVersion.version).toBe(2);
    expect(repairedVersion.journeySnapshot.steps[0]?.value).toEqual({
      kind: 'safe',
      value: '{{unique.text}}',
    });
  });

  it('persists automatic, confirmed, and manual request-selection provenance with backward-compatible defaults', () => {
    const project = projects.createProject({
      name: 'Recommendation provenance project',
      targetUrl: 'https://example.test',
      description: '',
    });
    const journey = projects.saveJourney({
      projectId: project.id,
      name: 'Create tenant',
      steps: [step('submit-step', 'submit')],
      metadata: {
        recordingSessionId: null,
        recordedAt: new Date(0).toISOString(),
        warningCount: 0,
        normalizationRule: 'test',
      },
    });
    const legacy = experiments.createTest({
      projectId: project.id,
      journey,
      request: request('submit-step', 'Legacy version'),
    });
    const recommendedMatcher = {
      method: 'POST',
      pathname: '/api/tenants',
      host: 'example.test',
    };
    const selectedMatcher = {
      method: 'POST',
      pathname: '/api/invitations',
      host: 'example.test',
    };
    const automatic = experiments.createTest({
      projectId: project.id,
      journey,
      request: {
        ...request('submit-step', 'Automatic selection'),
        networkMatcher: recommendedMatcher,
        requestSelectionProvenance: provenance(
          'automatic',
          recommendedMatcher,
          recommendedMatcher,
          false,
        ),
      },
    });
    const confirmed = experiments.createTest({
      projectId: project.id,
      journey,
      request: {
        ...request('submit-step', 'Confirmed selection'),
        networkMatcher: recommendedMatcher,
        requestSelectionProvenance: provenance(
          'confirmed_recommendation',
          recommendedMatcher,
          recommendedMatcher,
          false,
        ),
      },
    });
    const overridden = experiments.createTest({
      projectId: project.id,
      journey,
      request: {
        ...request('submit-step', 'Manual override'),
        networkMatcher: selectedMatcher,
        requestSelectionProvenance: provenance(
          'manual_override',
          recommendedMatcher,
          selectedMatcher,
          true,
        ),
      },
    });
    const reloaded = new ExternalExperimentRepository(database.connection);

    expect(
      reloaded.getVersion(legacy.id)?.requestSelectionProvenance,
    ).toBeNull();
    expect(
      reloaded.getVersion(automatic.id)?.requestSelectionProvenance,
    ).toMatchObject({
      selectionMode: 'automatic',
      userOverrodeRecommendation: false,
    });
    expect(
      reloaded.getVersion(confirmed.id)?.requestSelectionProvenance,
    ).toMatchObject({
      selectionMode: 'confirmed_recommendation',
      userOverrodeRecommendation: false,
    });
    expect(
      reloaded.getVersion(overridden.id)?.requestSelectionProvenance,
    ).toMatchObject({
      selectionMode: 'manual_override',
      recommendedMatcher,
      selectedMatcher,
      userOverrodeRecommendation: true,
    });
    const persisted = database.connection
      .prepare(
        `SELECT request_selection_provenance_json AS provenance
           FROM external_experiment_versions WHERE id = ?`,
      )
      .get(overridden.id) as { readonly provenance: string };
    expect(persisted.provenance).not.toContain('body');
    expect(persisted.provenance).not.toContain('authorization');
    expect(persisted.provenance).not.toContain('secret-value');
  });

  it('persists generated, modified, disabled and manual assertion provenance without unsafe evidence', () => {
    const project = projects.createProject({
      name: 'Assertion provenance project',
      targetUrl: 'https://example.test',
      description: '',
    });
    const journey = projects.saveJourney({
      projectId: project.id,
      name: 'Create profile',
      steps: [step('submit-step', 'submit')],
      metadata: {
        recordingSessionId: null,
        recordedAt: new Date(0).toISOString(),
        warningCount: 0,
        normalizationRule: 'test',
      },
    });
    const legacy = experiments.createTest({
      projectId: project.id,
      journey,
      request: request('submit-step', 'Legacy assertion provenance'),
    });
    const assertions = [
      {
        id: 'generated',
        type: 'network_request_max' as const,
        maximum: 1,
        description: 'At most one request.',
      },
      {
        id: 'modified',
        type: 'network_success_max' as const,
        maximum: 2,
        description: 'Edited success maximum.',
      },
      {
        id: 'manual',
        type: 'network_no_server_errors' as const,
        description: 'Manual no-5xx.',
      },
    ];
    const version = experiments.createTest({
      projectId: project.id,
      journey,
      request: {
        ...request('submit-step', 'Assertion provenance'),
        networkMatcher: {
          method: 'POST',
          pathname: '/api/profiles',
          host: 'example.test',
        },
        requestSelectionProvenance: provenance(
          'confirmed_recommendation',
          {
            method: 'POST',
            pathname: '/api/profiles',
            host: 'example.test',
          },
          {
            method: 'POST',
            pathname: '/api/profiles',
            host: 'example.test',
          },
          false,
        ),
        networkEvidenceProvenance: {
          source: 'recording',
          sourceRunId: null,
          actionStepId: 'submit-step',
          candidateId: 'request-1234567890abcdef12345678',
          candidateScore: 108,
          candidateConfidence: 'high',
          recommendationReasons: [
            {
              code: 'mutation_method',
              label: 'POST can change server state.',
              scoreImpact: 50,
            },
          ],
          matcher: {
            method: 'POST',
            pathname: '/api/profiles',
            host: 'example.test',
          },
          observedStatus: 201,
          observedFailed: false,
          relativeTimestampMs: 12,
          observedAt: '2026-07-20T20:00:00.000Z',
          approvedAt: '2026-07-20T20:01:00.000Z',
        },
        assertions,
        assertionSelectionProvenance: [
          assertionProvenance('generated', 'generated', 'accepted'),
          assertionProvenance('modified', 'generated_modified', 'modified'),
          {
            ...assertionProvenance(null, 'generated', 'disabled'),
            defaultEnabled: false,
          },
          {
            assertionId: 'manual',
            recommendationId: null,
            origin: 'manual',
            confidence: null,
            reasonCode: null,
            explanation: null,
            defaultEnabled: null,
            action: 'manual',
            evidenceIds: [],
          },
        ],
      },
    });
    const reloaded = new ExternalExperimentRepository(database.connection);

    expect(
      reloaded.getVersion(legacy.id)?.assertionSelectionProvenance,
    ).toEqual([]);
    expect(
      reloaded.getVersion(version.id)?.assertionSelectionProvenance,
    ).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          assertionId: 'generated',
          origin: 'generated',
        }),
        expect.objectContaining({
          assertionId: 'modified',
          origin: 'generated_modified',
        }),
        expect.objectContaining({
          assertionId: null,
          action: 'disabled',
        }),
        expect.objectContaining({
          assertionId: 'manual',
          origin: 'manual',
        }),
      ]),
    );
    expect(
      reloaded.getVersion(version.id)?.networkEvidenceProvenance,
    ).toMatchObject({
      source: 'recording',
      candidateId: 'request-1234567890abcdef12345678',
      matcher: {
        method: 'POST',
        pathname: '/api/profiles',
        host: 'example.test',
      },
    });
    const serialized = JSON.stringify(
      reloaded.getVersion(version.id)?.assertionSelectionProvenance,
    );
    expect(serialized).not.toContain('SyntheticSecret');
    expect(serialized).not.toContain('authorization');
    expect(serialized).not.toContain('query=');
  });
});

describe('browser workload exclusion', () => {
  it('makes recording, normal replay and experiment execution mutually exclusive', () => {
    const workloads: readonly BrowserWorkload[] = [
      'recording',
      'replay',
      'external_experiment',
    ];
    for (const held of workloads) {
      const ownership = new BrowserOwnership();
      const release = ownership.acquire(held);
      for (const contender of workloads) {
        expect(() => ownership.acquire(contender)).toThrow(
          BrowserOwnershipConflictError,
        );
      }
      release();
      expect(ownership.activeWorkload).toBeNull();
    }
  });
});

describe('production safety', () => {
  it('requires explicit confirmation before a mutating production action', () => {
    const project = projects.createProject({
      name: 'Production target',
      targetUrl: 'https://example.test',
      environment: 'production',
      description: '',
    });
    expect(() =>
      assertProductionConfirmed(project, false, 'Request discovery'),
    ).toThrow(ProductionConfirmationRequiredError);
    expect(() =>
      assertProductionConfirmed(project, true, 'Request discovery'),
    ).not.toThrow();
  });
});

function step(id: string, type: 'fill' | 'click' | 'submit') {
  return {
    id,
    name: id,
    type,
    timestamp: 0,
    url: 'https://example.test',
    locator: { strategy: 'id' as const, value: id },
    fingerprint: null,
    value: type === 'fill' ? { kind: 'safe' as const, value: 'value' } : null,
    sensitive: false,
  };
}

function request(targetStepId: string, name: string) {
  return {
    name,
    targetStepId,
    triggerCount: 2 as const,
    intervalMs: 0 as const,
    networkMatcher: null,
    assertions: [
      {
        id: 'visible',
        type: 'element_visible' as const,
        locator: { strategy: 'id' as const, value: 'complete' },
        targetDescription: 'Completion',
        description: 'Completion is visible.',
      },
    ],
    continueAfterTarget: false,
    requestSelectionProvenance: null,
  };
}

function provenance(
  selectionMode: 'automatic' | 'confirmed_recommendation' | 'manual_override',
  recommendedMatcher: {
    readonly method: string;
    readonly pathname: string;
    readonly host: string | null;
  },
  selectedMatcher: {
    readonly method: string;
    readonly pathname: string;
    readonly host: string | null;
  },
  userOverrodeRecommendation: boolean,
) {
  return {
    selectionMode,
    discoveryId: '11111111-2222-4333-8444-555555555555',
    discoveredAt: '2026-07-16T00:00:00.000Z',
    discoveryOutcome: 'recommended' as const,
    selectedCandidateId: 'request-1234567890abcdef12345678',
    selectedCandidateScore: 108,
    selectedCandidateConfidence: 'high' as const,
    recommendationReasons: [
      {
        code: 'mutation_method' as const,
        label: 'POST can change server state.',
        scoreImpact: 50,
      },
    ],
    recommendedMatcher,
    selectedMatcher,
    userOverrodeRecommendation,
  };
}

function assertionProvenance(
  assertionId: string | null,
  origin: 'generated' | 'generated_modified',
  action: 'accepted' | 'modified' | 'disabled',
) {
  return {
    assertionId,
    recommendationId: `assertion-rec-${origin === 'generated' ? 'a' : 'b'.repeat(24)}`,
    origin,
    confidence: 'high' as const,
    reasonCode: 'test_recommendation',
    explanation: 'Bounded deterministic explanation.',
    defaultEnabled: true,
    action,
    evidenceIds: ['request-1234567890abcdef12345678'],
  };
}
