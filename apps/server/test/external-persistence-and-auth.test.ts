import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import type { FormCrashDatabase } from '../src/persistence/database.js';
import { initializePersistence } from '../src/persistence/initialize.js';
import { ExternalExperimentRepository } from '../src/persistence/external-experiment-repository.js';
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

describe('external experiment version persistence', () => {
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
      experiments.createVersion({
        projectId: project.id,
        journey,
        request: request('fill-step', 'Rejected fill'),
      }),
    ).toThrow(RunPersistenceError);
    const click = experiments.createVersion({
      projectId: project.id,
      journey,
      request: request('click-step', 'Compatible click'),
    });
    const submit = experiments.createVersion({
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
  };
}
