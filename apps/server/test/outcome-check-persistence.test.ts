import { afterEach, describe, expect, it } from 'vitest';

import type { FormCrashDatabase } from '../src/persistence/database.js';
import { initializePersistence } from '../src/persistence/initialize.js';
import {
  CriticalActionLockedError,
  OutcomeCheckRepository,
} from '../src/persistence/outcome-check-repository.js';
import { ProjectJourneyRepository } from '../src/persistence/project-journey-repository.js';
import {
  createTemporaryTestConfig,
  type TemporaryTestConfig,
} from './fixtures.js';

let database: FormCrashDatabase | undefined;
let temporary: TemporaryTestConfig | undefined;

afterEach(() => {
  database?.close();
  temporary?.cleanup();
  database = undefined;
  temporary = undefined;
});

describe('Critical Action and Outcome Check persistence', () => {
  it('persists one supported Critical Action for its exact journey version', () => {
    const setup = createSetup();
    const action = setup.outcomes.approveCriticalAction(setup.journey, {
      stepId: 'submit-tenant',
      label: 'Submit Tenant',
    });

    expect(action).toMatchObject({
      journeyId: setup.journey.id,
      stepId: 'submit-tenant',
      label: 'Submit Tenant',
    });
    expect(setup.outcomes.getCriticalAction(setup.journey.id)).toEqual(action);

    const otherJourney = setup.projects.saveJourney({
      projectId: setup.journey.projectId,
      name: 'Other journey',
      steps: setup.journey.steps.map((step) => ({
        ...step,
        id: `other-${step.id}`,
      })),
      metadata: setup.journey.recordingMetadata,
    });
    expect(() =>
      setup.outcomes.approveCriticalAction(otherJourney, {
        stepId: 'submit-tenant',
        label: 'Wrong journey step',
      }),
    ).toThrow(/owned by this journey version/u);
  });

  it('does not inherit definitions into a newly saved version and rejects cross-version actions', () => {
    const setup = createSetup();
    const action = setup.outcomes.approveCriticalAction(setup.journey, {
      stepId: 'submit-tenant',
      label: 'Submit Tenant',
    });
    const target = capturedTarget();
    setup.outcomes.saveOutcomeCheck({
      journeyId: setup.journey.id,
      criticalActionId: action.id,
      type: 'visible_element_exists',
      description: 'A tenant row appears.',
      target,
    });
    const nextVersion = setup.projects.saveJourney({
      projectId: setup.journey.projectId,
      name: setup.journey.name,
      steps: setup.journey.steps,
      metadata: setup.journey.recordingMetadata,
    });

    expect(nextVersion.version).toBe(setup.journey.version + 1);
    expect(setup.outcomes.getCriticalAction(nextVersion.id)).toBeNull();
    expect(setup.outcomes.listOutcomeChecks(nextVersion.id)).toEqual([]);
    expect(() =>
      setup.outcomes.saveOutcomeCheck({
        journeyId: nextVersion.id,
        criticalActionId: action.id,
        type: 'visible_element_exists',
        description: 'Wrong version.',
        target,
      }),
    ).toThrow(/this journey version/u);
  });

  it('enforces immutable journey versions and matching action ownership in SQLite', () => {
    const setup = createSetup();
    const action = setup.outcomes.approveCriticalAction(setup.journey, {
      stepId: 'submit-tenant',
      label: 'Submit Tenant',
    });
    const nextVersion = setup.projects.saveJourney({
      projectId: setup.journey.projectId,
      name: setup.journey.name,
      steps: setup.journey.steps,
      metadata: setup.journey.recordingMetadata,
    });

    expect(() =>
      database!.connection
        .prepare('UPDATE journeys SET name = ? WHERE id = ?')
        .run('Changed later', setup.journey.id),
    ).toThrow(/journey versions are immutable/u);
    expect(() =>
      database!.connection
        .prepare(
          `INSERT INTO outcome_checks
            (id, journey_id, critical_action_id, outcome_type,
             definition_json, created_at)
           VALUES (?, ?, ?, ?, ?, ?)`,
        )
        .run(
          'cross-version-check',
          nextVersion.id,
          action.id,
          'final_pathname_matches',
          JSON.stringify({
            description: 'Wrong version.',
            expectedPathname: '/tenants',
          }),
          new Date().toISOString(),
        ),
    ).toThrow(/belongs to another journey version/u);
  });

  it('rejects non-click and non-submit Critical Actions', () => {
    const setup = createSetup();
    expect(() =>
      setup.outcomes.approveCriticalAction(setup.journey, {
        stepId: 'fill-email',
        label: 'Tenant email',
      }),
    ).toThrow(/click or submit/u);
  });

  it('persists and retrieves all three Outcome Check types', () => {
    const setup = createSetup();
    const action = setup.outcomes.approveCriticalAction(setup.journey, {
      stepId: 'submit-tenant',
      label: 'Submit Tenant',
    });
    const target = capturedTarget();
    setup.outcomes.saveOutcomeCheck({
      journeyId: setup.journey.id,
      criticalActionId: action.id,
      type: 'visible_element_exists',
      description: 'A tenant row appears.',
      target,
    });
    setup.outcomes.saveOutcomeCheck({
      journeyId: setup.journey.id,
      criticalActionId: action.id,
      type: 'matching_item_appears_exactly_once',
      description: 'Exactly one matching tenant row appears.',
      target,
      binding: target.generatedBindings[0]!,
    });
    setup.outcomes.saveOutcomeCheck({
      journeyId: setup.journey.id,
      criticalActionId: action.id,
      type: 'final_pathname_matches',
      description: 'The journey ends on tenants.',
      expectedPathname: '/tenants',
    });

    expect(
      new Set(
        setup.outcomes
          .listOutcomeChecks(setup.journey.id)
          .map((check) => check.type),
      ),
    ).toEqual(
      new Set([
        'visible_element_exists',
        'matching_item_appears_exactly_once',
        'final_pathname_matches',
      ]),
    );

    database?.close();
    database = initializePersistence(temporary!.config);
    const reloaded = new OutcomeCheckRepository(database.connection);
    expect(reloaded.listOutcomeChecks(setup.journey.id)).toHaveLength(3);
  });

  it('locks the Critical Action step after an Outcome Check exists', () => {
    const setup = createSetup();
    const action = setup.outcomes.approveCriticalAction(setup.journey, {
      stepId: 'submit-tenant',
      label: 'Submit Tenant',
    });
    setup.outcomes.saveOutcomeCheck({
      journeyId: setup.journey.id,
      criticalActionId: action.id,
      type: 'final_pathname_matches',
      description: 'The final pathname remains stable.',
      expectedPathname: '/tenants',
    });

    expect(() =>
      setup.outcomes.approveCriticalAction(setup.journey, {
        stepId: 'open-tenants',
        label: 'Open tenants',
      }),
    ).toThrow(CriticalActionLockedError);
  });

  it('deletes a current check before allowing Critical Action replacement', () => {
    const setup = createSetup();
    const action = setup.outcomes.approveCriticalAction(setup.journey, {
      stepId: 'submit-tenant',
      label: 'Submit Tenant',
    });
    const check = setup.outcomes.saveOutcomeCheck({
      journeyId: setup.journey.id,
      criticalActionId: action.id,
      type: 'final_pathname_matches',
      description: 'The final pathname remains stable.',
      expectedPathname: '/tenants',
    });

    expect(setup.outcomes.deleteOutcomeCheck(setup.journey.id, check.id)).toBe(
      'deleted',
    );
    expect(
      setup.outcomes.approveCriticalAction(setup.journey, {
        stepId: 'open-tenants',
        label: 'Open tenants',
      }),
    ).toMatchObject({ stepId: 'open-tenants', journeyId: setup.journey.id });
    expect(setup.outcomes.deleteOutcomeCheck(setup.journey.id, check.id)).toBe(
      'not_found',
    );
  });
});

function createSetup() {
  temporary = createTemporaryTestConfig();
  database = initializePersistence(temporary.config);
  const projects = new ProjectJourneyRepository(database.connection);
  const outcomes = new OutcomeCheckRepository(database.connection);
  const project = projects.createProject({
    name: 'Tenant fixture',
    targetUrl: 'http://localhost:4300/tenants',
    description: '',
  });
  const journey = projects.saveJourney({
    projectId: project.id,
    name: 'Add Tenant',
    steps: [
      {
        id: 'open-tenants',
        name: 'Open tenants',
        type: 'click',
        timestamp: 1,
        url: project.targetUrl,
        locator: { strategy: 'data-testid', value: 'open-tenants' },
        fingerprint: fingerprint('button', 'open-tenants'),
        value: null,
        sensitive: false,
      },
      {
        id: 'fill-email',
        name: 'Fill tenant email',
        type: 'fill',
        timestamp: 2,
        url: project.targetUrl,
        locator: { strategy: 'name', value: 'email' },
        fingerprint: fingerprint('input', 'email'),
        value: { kind: 'safe', value: 'tenant@example.test' },
        sensitive: false,
      },
      {
        id: 'submit-tenant',
        name: 'Submit Tenant',
        type: 'submit',
        timestamp: 3,
        url: project.targetUrl,
        locator: { strategy: 'data-testid', value: 'tenant-form' },
        fingerprint: fingerprint('form', 'tenant-form'),
        value: null,
        sensitive: false,
      },
    ],
    metadata: {
      recordingSessionId: null,
      recordedAt: '2026-07-17T00:00:00.000Z',
      warningCount: 0,
      normalizationRule: 'Test journey.',
    },
  });
  return { projects, outcomes, journey };
}

function fingerprint(tagName: string, id: string) {
  return {
    tagName,
    inputType: tagName === 'input' ? 'email' : null,
    dataFormcrash: null,
    dataTestId: id,
    id,
    role: tagName === 'form' ? 'form' : null,
    accessibleName: id,
    name: id,
    label: id,
    text: null,
    cssPath: `#${id}`,
  };
}

function capturedTarget() {
  return {
    locator: {
      strategy: 'data-formcrash' as const,
      value: 'tenant-row',
    },
    fingerprint: {
      tagName: 'li',
      dataFormcrash: 'tenant-row',
      dataTestId: null,
      id: null,
      role: 'listitem',
      accessibleName: 'Tenant {{unique.email}}',
      name: null,
      cssPath: 'li',
    },
    preview: 'Tenant {{unique.email}}',
    reliability: 'high' as const,
    warnings: [],
    generatedBindings: [
      {
        expression: 'unique.email' as const,
        template: '{{unique.email}}' as const,
        label: 'Generated unique email',
      },
    ],
  };
}
