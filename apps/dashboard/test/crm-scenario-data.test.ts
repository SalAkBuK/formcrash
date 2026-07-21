import type {
  CriticalAction,
  ExternalExperimentVersion,
  ExternalRunSummary,
  OutcomeCheck,
  PersistedJourney,
} from '@formcrash/contracts';
import { externalRunSummarySchema } from '@formcrash/contracts';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  composeScenarioLineages,
  verdictLabel,
  type ScenarioLineage,
} from '../src/features/projects/components/crm-project-data';
import { dominantAction } from '../src/features/projects/components/project-overview-screen';

const api = vi.hoisted(() => ({
  getCriticalAction: vi.fn(),
  listOutcomeChecks: vi.fn(),
}));

vi.mock('../src/features/projects/api/projects', async (importOriginal) => ({
  ...(await importOriginal()),
  getCriticalAction: api.getCriticalAction,
  listOutcomeChecks: api.listOutcomeChecks,
}));

beforeEach(() => {
  vi.clearAllMocks();
  api.getCriticalAction.mockImplementation((journeyId: string) =>
    Promise.resolve(criticalAction(journeyId)),
  );
  api.listOutcomeChecks.mockResolvedValue([outcomeCheck()]);
});

describe('CRM Scenario composition', () => {
  it('groups exact names, selects the highest immutable version, and counts distinct compatible Configurations', async () => {
    const first = journey('checkout-v1', 'Checkout', 1);
    const latest = journey('checkout-v2', 'Checkout', 2);
    const caseVariant = journey('checkout-case', 'checkout', 1);
    const experiments = [
      experiment('config-a-v1', 'config-a', latest, 1),
      experiment('config-a-v2', 'config-a', latest, 2),
      experiment('config-b-v1', 'config-b', latest, 1),
      experiment('old-config', 'old-config', first, 1),
    ];

    const result = await composeScenarioLineages({
      journeys: [first, latest, caseVariant],
      experiments,
      runs: [],
    });

    expect(result).toHaveLength(2);
    const checkout = result.find((item) => item.name === 'Checkout')!;
    expect(checkout.selectedJourney.id).toBe(latest.id);
    expect(checkout.versions.map((item) => item.version)).toEqual([2, 1]);
    expect(checkout.configurationCount).toBe(2);
    expect(checkout.configurations.map((item) => item.id)).not.toContain(
      'old-config',
    );
  });

  it('derives every setup blocker for the selected recorded-flow version', async () => {
    const selected = journey('journey-one', 'Register visitor', 1);
    api.getCriticalAction.mockResolvedValueOnce(null);
    let [lineage] = await composeScenarioLineages({
      journeys: [selected],
      experiments: [],
      runs: [],
    });
    expect(lineage!.setupState).toBe('critical_action_needed');

    api.getCriticalAction.mockResolvedValueOnce(criticalAction(selected.id));
    api.listOutcomeChecks.mockResolvedValueOnce([]);
    [lineage] = await composeScenarioLineages({
      journeys: [selected],
      experiments: [],
      runs: [],
    });
    expect(lineage!.setupState).toBe('outcome_checks_needed');

    [lineage] = await composeScenarioLineages({
      journeys: [selected],
      experiments: [],
      runs: [],
    });
    expect(lineage!.setupState).toBe('configuration_needed');

    [lineage] = await composeScenarioLineages({
      journeys: [selected],
      experiments: [experiment('config-one', 'config', selected, 1)],
      runs: [],
    });
    expect(lineage!.setupState).toBe('ready');
  });

  it('excludes Runs from another Journey version when deriving the compatible verdict', async () => {
    const oldJourney = journey('old', 'Checkout', 1);
    const selected = journey('new', 'Checkout', 2);
    const selectedExperiment = experiment(
      'selected-config',
      'stable-config',
      selected,
      1,
    );
    const oldExperiment = experiment(
      'old-config',
      'stable-config',
      oldJourney,
      1,
    );
    const [lineage] = await composeScenarioLineages({
      journeys: [oldJourney, selected],
      experiments: [oldExperiment, selectedExperiment],
      runs: [
        run('newer-wrong-version', oldExperiment, 'failed', 'failed', 5),
        run('selected-run', selectedExperiment, 'passed', 'passed', 4),
      ],
    });

    expect(lineage!.latestCompatibleRun?.runId).toBe('selected-run');
    expect(verdictLabel(lineage!.latestCompatibleRun)).toBe('Passed');
  });

  it('preserves truthful running and runner-error verdicts', () => {
    const selected = journey('selected', 'Checkout', 1);
    const configuration = experiment('configuration', 'config', selected, 1);
    expect(
      verdictLabel(
        run('running', configuration, 'running', 'not_configured', 1),
      ),
    ).toBe('Running');
    expect(
      verdictLabel(
        run('runner-error', configuration, 'runner_error', 'not_configured', 2),
      ),
    ).toBe('Runner error');
  });

  it('labels legacy technical-only passes without implying approved outcome coverage', () => {
    const selected = journey('selected', 'Checkout', 1);
    const configuration = experiment('configuration', 'config', selected, 1);
    const legacyRun = externalRunSummarySchema.parse({
      ...run('legacy', configuration, 'passed', 'passed', 3),
      outcomeAggregate: 'not_configured',
      assertionAggregate: 'passed',
    });

    expect(verdictLabel(legacyRun)).toBe('Passed — technical checks only');
  });

  it('preserves the lineage and marks derived setup unavailable when a secondary API fails', async () => {
    const selected = journey('selected', 'Checkout', 1);
    api.getCriticalAction.mockRejectedValueOnce(
      new Error('critical unavailable'),
    );
    const [lineage] = await composeScenarioLineages({
      journeys: [selected],
      experiments: [],
      runs: [],
      configurationDataAvailable: false,
      runDataAvailable: false,
    });

    expect(lineage?.selectedJourney.id).toBe(selected.id);
    expect(lineage?.criticalAction.status).toBe('unavailable');
    expect(lineage?.setupState).toBe('unavailable');
    expect(lineage?.runDataAvailable).toBe(false);
  });
});

describe('Project Overview dominant action', () => {
  it('uses the four locked state-driven actions', () => {
    expect(dominantAction('project-one', null).label).toBe('Record Scenario');
    expect(
      dominantAction('project-one', lineageWithState('critical_action_needed'))
        .label,
    ).toBe('Complete Setup');
    expect(
      dominantAction('project-one', lineageWithState('configuration_needed'))
        .label,
    ).toBe('Configure Test');
    expect(dominantAction('project-one', lineageWithState('ready')).label).toBe(
      'Record Scenario',
    );
  });
});

function lineageWithState(
  setupState: ScenarioLineage['setupState'],
): ScenarioLineage {
  const selected = journey('selected', 'Scenario', 1);
  const configuration = experiment('configuration', 'config', selected, 1);
  return {
    name: selected.name,
    versions: [selected],
    selectedJourney: selected,
    criticalAction: { status: 'available', value: criticalAction(selected.id) },
    outcomeChecks: { status: 'available', value: [outcomeCheck()] },
    configurations: setupState === 'ready' ? [configuration] : [],
    configurationDataAvailable: true,
    configurationCount: setupState === 'ready' ? 1 : 0,
    latestCompatibleRun: null,
    runDataAvailable: true,
    setupState,
    updatedAt: selected.createdAt,
  };
}

function journey(id: string, name: string, version: number): PersistedJourney {
  return {
    id,
    projectId: 'project-one',
    name,
    version,
    steps: [],
    recordingMetadata: {
      recordingSessionId: null,
      recordedAt: `2026-07-${String(version).padStart(2, '0')}T00:00:00.000Z`,
      warningCount: 0,
      normalizationRule: 'test',
    },
    createdAt: `2026-07-${String(version).padStart(2, '0')}T00:00:00.000Z`,
  };
}

function criticalAction(journeyId: string): CriticalAction {
  return {
    id: `critical-${journeyId}`,
    journeyId,
    stepId: 'submit',
    label: 'Submit form',
    createdAt: '2026-07-01T00:00:00.000Z',
    updatedAt: '2026-07-01T00:00:00.000Z',
  };
}

function outcomeCheck(): OutcomeCheck {
  return {
    id: 'outcome-one',
    journeyId: 'journey-one',
    criticalActionId: 'critical-journey-one',
    type: 'final_pathname_matches',
    expectedPathname: '/success',
    description: 'The success page is shown.',
    createdAt: '2026-07-01T00:00:00.000Z',
  };
}

function experiment(
  id: string,
  experimentId: string,
  selectedJourney: PersistedJourney,
  version: number,
): ExternalExperimentVersion {
  return {
    id,
    experimentId,
    projectId: selectedJourney.projectId,
    journeyId: selectedJourney.id,
    name: `Configuration ${experimentId}`,
    experimentType: 'impatient_user',
    version,
    targetStepId: 'submit',
    triggerCount: 2,
    intervalMs: 100,
    networkMatcher: null,
    assertions: [],
    continueAfterTarget: false,
    guided: true,
    requestSelectionProvenance: null,
    assertionSelectionProvenance: [],
    outcomeCheckSnapshot: { criticalAction: null, checks: [] },
    journeySnapshot: selectedJourney,
    createdAt: `2026-07-${String(version + 10).padStart(2, '0')}T00:00:00.000Z`,
  };
}

function run(
  runId: string,
  configuration: ExternalExperimentVersion,
  status: ExternalRunSummary['status'],
  outcomeAggregate: ExternalRunSummary['outcomeAggregate'],
  day: number,
): ExternalRunSummary {
  const terminal = status === 'passed' || status === 'failed';
  return externalRunSummarySchema.parse({
    runId,
    experimentVersionId: configuration.id,
    projectId: configuration.projectId,
    journeyId: configuration.journeyId,
    status,
    lifecycleStatus:
      status === 'runner_error'
        ? 'runner_error'
        : terminal
          ? 'completed'
          : status,
    outcomeAggregate,
    assertionAggregate: outcomeAggregate,
    startedAt: `2026-07-${String(day).padStart(2, '0')}T00:00:00.000Z`,
    completedAt: terminal
      ? `2026-07-${String(day).padStart(2, '0')}T00:00:01.000Z`
      : null,
    durationMs: terminal ? 1000 : null,
    projectName: 'Project One',
    journeyName: configuration.journeySnapshot.name,
    experimentName: configuration.name,
    triggerAttempts: 2,
    matchedRequestCount: 1,
    passedAssertionCount: outcomeAggregate === 'passed' ? 1 : 0,
    assertionCount: 1,
    screenshotCount: 1,
    createdAt: `2026-07-${String(day).padStart(2, '0')}T00:00:00.000Z`,
  });
}
