import type {
  CriticalAction,
  ExternalExperimentVersion,
  ExternalRunSummary,
  OutcomeCheck,
  PersistedJourney,
  Project,
  ProjectExecutionSettings,
} from '@formcrash/contracts';

import {
  getProjectSettings,
  listExternalRuns,
  listProjectExternalExperiments,
} from '../api/external-experiments';
import {
  getCriticalAction,
  listJourneys,
  listOutcomeChecks,
} from '../api/projects';

export type DerivedValue<T> =
  | Readonly<{ status: 'available'; value: T }>
  | Readonly<{ status: 'unavailable'; reason: string }>;

export type ScenarioSetupState =
  | 'critical_action_needed'
  | 'outcome_checks_needed'
  | 'configuration_needed'
  | 'ready'
  | 'unavailable';

export interface ScenarioLineage {
  readonly name: string;
  readonly versions: readonly PersistedJourney[];
  readonly selectedJourney: PersistedJourney;
  readonly criticalAction: DerivedValue<CriticalAction | null>;
  readonly outcomeChecks: DerivedValue<readonly OutcomeCheck[]>;
  readonly configurations: readonly ExternalExperimentVersion[];
  readonly configurationDataAvailable: boolean;
  readonly configurationCount: number;
  readonly latestCompatibleRun: ExternalRunSummary | null;
  readonly runDataAvailable: boolean;
  readonly setupState: ScenarioSetupState;
  readonly updatedAt: string;
}

export interface ProjectCrmData {
  readonly project: Project;
  readonly settings: DerivedValue<ProjectExecutionSettings>;
  readonly journeys: DerivedValue<readonly PersistedJourney[]>;
  readonly experiments: DerivedValue<readonly ExternalExperimentVersion[]>;
  readonly runs: DerivedValue<readonly ExternalRunSummary[]>;
  readonly scenarios: DerivedValue<readonly ScenarioLineage[]>;
  readonly lastActivity: string;
}

interface ScenarioSources {
  readonly journeys: readonly PersistedJourney[];
  readonly experiments: readonly ExternalExperimentVersion[];
  readonly runs: readonly ExternalRunSummary[];
  readonly configurationDataAvailable?: boolean;
  readonly runDataAvailable?: boolean;
}

export async function loadProjectCrmData(
  project: Project,
  runLimit = 100,
): Promise<ProjectCrmData> {
  const [settingsResult, journeysResult, experimentsResult, runsResult] =
    await Promise.allSettled([
      getProjectSettings(project.id),
      listJourneys(project.id),
      listProjectExternalExperiments(project.id),
      listExternalRuns(project.id, runLimit),
    ]);

  const settings = settledValue(settingsResult);
  const journeys = settledValue(journeysResult);
  const experiments = settledValue(experimentsResult);
  const runs: DerivedValue<readonly ExternalRunSummary[]> =
    runsResult.status === 'fulfilled'
      ? available(runsResult.value.items)
      : unavailable<readonly ExternalRunSummary[]>(runsResult.reason);

  let scenarios: DerivedValue<readonly ScenarioLineage[]>;
  if (journeys.status === 'unavailable') {
    scenarios = journeys;
  } else {
    scenarios = available(
      await composeScenarioLineages({
        journeys: journeys.value,
        experiments:
          experiments.status === 'available' ? experiments.value : [],
        runs: runs.status === 'available' ? runs.value : [],
        configurationDataAvailable: experiments.status === 'available',
        runDataAvailable: runs.status === 'available',
      }),
    );
  }

  return {
    project,
    settings,
    journeys,
    experiments,
    runs,
    scenarios,
    lastActivity: latestTimestamp([
      project.updatedAt,
      ...(journeys.status === 'available'
        ? journeys.value.map((journey) => journey.createdAt)
        : []),
      ...(experiments.status === 'available'
        ? experiments.value.map((experiment) => experiment.createdAt)
        : []),
      ...(runs.status === 'available'
        ? runs.value.map((run) => run.startedAt)
        : []),
    ]),
  };
}

export async function loadScenarioLineages(
  projectId: string,
): Promise<readonly ScenarioLineage[]> {
  const [journeys, experimentsResult, runsResult] = await Promise.all([
    listJourneys(projectId),
    settle(listProjectExternalExperiments(projectId)),
    settle(listExternalRuns(projectId, 100).then((result) => result.items)),
  ]);
  return composeScenarioLineages({
    journeys,
    experiments:
      experimentsResult.status === 'available' ? experimentsResult.value : [],
    runs: runsResult.status === 'available' ? runsResult.value : [],
    configurationDataAvailable: experimentsResult.status === 'available',
    runDataAvailable: runsResult.status === 'available',
  });
}

export async function composeScenarioLineages(
  sources: ScenarioSources,
): Promise<readonly ScenarioLineage[]> {
  const grouped = new Map<string, PersistedJourney[]>();
  for (const journey of sources.journeys) {
    const versions = grouped.get(journey.name) ?? [];
    versions.push(journey);
    grouped.set(journey.name, versions);
  }

  const lineages = await Promise.all(
    [...grouped.entries()].map(async ([name, versions]) => {
      const orderedVersions = [...versions].sort(compareJourneyVersions);
      const selectedJourney = orderedVersions[0]!;
      const [criticalActionResult, outcomeChecksResult] =
        await Promise.allSettled([
          getCriticalAction(selectedJourney.id),
          listOutcomeChecks(selectedJourney.id),
        ]);
      const criticalAction = settledValue(criticalActionResult);
      const outcomeChecks = settledValue(outcomeChecksResult);
      const configurations = sources.experiments.filter(
        (experiment) => experiment.journeyId === selectedJourney.id,
      );
      const configurationIds = new Set(
        configurations.map((configuration) => configuration.id),
      );
      const compatibleRuns = sources.runs
        .filter(
          (run) =>
            run.journeyId === selectedJourney.id &&
            configurationIds.has(run.experimentVersionId),
        )
        .sort(compareRuns);
      const latestCompatibleRun = compatibleRuns[0] ?? null;
      const configurationCount = new Set(
        configurations.map((configuration) => configuration.experimentId),
      ).size;
      const setupState = deriveSetupState(
        criticalAction,
        outcomeChecks,
        configurationCount,
        sources.configurationDataAvailable ?? true,
      );

      return {
        name,
        versions: orderedVersions,
        selectedJourney,
        criticalAction,
        outcomeChecks,
        configurations,
        configurationDataAvailable: sources.configurationDataAvailable ?? true,
        configurationCount,
        latestCompatibleRun,
        runDataAvailable: sources.runDataAvailable ?? true,
        setupState,
        updatedAt: latestTimestamp([
          selectedJourney.createdAt,
          ...configurations.map((configuration) => configuration.createdAt),
          ...compatibleRuns.map((run) => run.startedAt),
        ]),
      } satisfies ScenarioLineage;
    }),
  );

  return lineages.sort(
    (left, right) =>
      Date.parse(right.updatedAt) - Date.parse(left.updatedAt) ||
      left.name.localeCompare(right.name),
  );
}

export function scenarioSetupLabel(state: ScenarioSetupState): string {
  if (state === 'critical_action_needed') return 'Critical Action needed';
  if (state === 'outcome_checks_needed') return 'Outcome Checks needed';
  if (state === 'configuration_needed') return 'Configuration needed';
  if (state === 'ready') return 'Ready';
  return 'Unavailable';
}

export function verdictLabel(run: ExternalRunSummary | null): string {
  if (run === null) return 'No compatible run';
  if (
    run.lifecycleStatus === 'created' ||
    run.lifecycleStatus === 'starting' ||
    run.lifecycleStatus === 'running' ||
    run.lifecycleStatus === 'evaluating'
  ) {
    return sentenceCase(run.lifecycleStatus);
  }
  if (run.canonicalVerdict === 'runner_error') return 'Runner error';
  if (
    run.canonicalVerdict === 'passed' &&
    run.verdictBasis === 'technical_checks_only'
  ) {
    return 'Passed — technical checks only';
  }
  if (run.canonicalVerdict === 'could_not_verify') return 'Could not verify';
  return sentenceCase(run.canonicalVerdict);
}

export function isScenarioReady(lineage: ScenarioLineage): boolean {
  return lineage.setupState === 'ready';
}

function deriveSetupState(
  criticalAction: DerivedValue<CriticalAction | null>,
  outcomeChecks: DerivedValue<readonly OutcomeCheck[]>,
  configurationCount: number,
  configurationDataAvailable: boolean,
): ScenarioSetupState {
  if (
    criticalAction.status === 'unavailable' ||
    outcomeChecks.status === 'unavailable' ||
    !configurationDataAvailable
  ) {
    return 'unavailable';
  }
  if (criticalAction.value === null) return 'critical_action_needed';
  if (outcomeChecks.value.length === 0) return 'outcome_checks_needed';
  if (configurationCount === 0) return 'configuration_needed';
  return 'ready';
}

async function settle<T>(promise: Promise<T>): Promise<DerivedValue<T>> {
  try {
    return available(await promise);
  } catch (reason: unknown) {
    return unavailable(reason);
  }
}

function settledValue<T>(result: PromiseSettledResult<T>): DerivedValue<T> {
  return result.status === 'fulfilled'
    ? available(result.value)
    : unavailable(result.reason);
}

function available<T>(value: T): DerivedValue<T> {
  return { status: 'available', value };
}

function unavailable<T>(reason: unknown): DerivedValue<T> {
  return {
    status: 'unavailable',
    reason: reason instanceof Error ? reason.message : 'Data is unavailable.',
  };
}

function compareJourneyVersions(
  left: PersistedJourney,
  right: PersistedJourney,
): number {
  return (
    right.version - left.version ||
    Date.parse(right.createdAt) - Date.parse(left.createdAt)
  );
}

function compareRuns(
  left: ExternalRunSummary,
  right: ExternalRunSummary,
): number {
  return Date.parse(right.startedAt) - Date.parse(left.startedAt);
}

function latestTimestamp(values: readonly string[]): string {
  return values.reduce((latest, value) =>
    Date.parse(value) > Date.parse(latest) ? value : latest,
  );
}

function sentenceCase(value: string): string {
  const normalized = value.replaceAll('_', ' ');
  return `${normalized.slice(0, 1).toUpperCase()}${normalized.slice(1)}`;
}
