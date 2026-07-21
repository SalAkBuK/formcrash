'use client';

import Link from 'next/link';
import { useEffect, useMemo, useState } from 'react';

import { StateMessage } from '../../../components/ui/state-message';
import {
  StatusBadge,
  type StatusTone,
} from '../../../components/ui/status-badge';
import { formatLocalDateTime } from '../../../lib/formatters';
import {
  loadScenarioLineages,
  scenarioSetupLabel,
  verdictLabel,
  type ScenarioLineage,
} from './crm-project-data';

export function ProjectScenariosScreen({
  projectId,
}: {
  readonly projectId: string;
}) {
  const [scenarios, setScenarios] = useState<readonly ScenarioLineage[]>([]);
  const [query, setQuery] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    setLoading(true);
    setError(null);
    void loadScenarioLineages(projectId)
      .then((items) => {
        if (active) setScenarios(items);
      })
      .catch((reason: unknown) => {
        if (active) setError(messageOf(reason));
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [projectId]);

  const visibleScenarios = useMemo(() => {
    const normalized = query.trim().toLowerCase();
    return normalized === ''
      ? scenarios
      : scenarios.filter((scenario) =>
          scenario.name.toLowerCase().includes(normalized),
        );
  }, [query, scenarios]);

  const partial = scenarios.some(
    (scenario) =>
      scenario.criticalAction.status === 'unavailable' ||
      scenario.outcomeChecks.status === 'unavailable' ||
      !scenario.configurationDataAvailable ||
      !scenario.runDataAvailable,
  );

  return (
    <main className="dashboard-shell crm-screen">
      <header className="crm-page-heading crm-compact-heading">
        <div>
          <p className="eyebrow">Scenario library</p>
          <h1>Scenarios</h1>
          <p>
            Recorded-flow lineages with setup, Configuration, and compatible Run
            state.
          </p>
        </div>
        <Link
          className="button button-primary"
          href={`/projects/${projectId}/journeys/new`}
        >
          Record Scenario
        </Link>
      </header>

      {error !== null ? (
        <StateMessage variant="error">{error}</StateMessage>
      ) : null}
      {partial ? (
        <StateMessage variant="warning">
          Some derived Scenario fields are unavailable. Available records are
          shown without inferred fallback values.
        </StateMessage>
      ) : null}

      <section
        className="panel crm-list-panel"
        aria-labelledby="scenarios-title"
      >
        <div className="crm-list-toolbar">
          <div>
            <h2 id="scenarios-title">Recorded Scenarios</h2>
            <span>{visibleScenarios.length} visible lineages</span>
          </div>
          <label>
            <span className="visually-hidden">Search Scenarios</span>
            <input
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Search Scenarios"
              type="search"
              value={query}
            />
          </label>
        </div>

        {loading ? (
          <StateMessage variant="loading">Loading Scenarios…</StateMessage>
        ) : visibleScenarios.length === 0 ? (
          <div className="empty-state">
            <h3>
              {scenarios.length === 0
                ? 'No Scenarios recorded'
                : 'No matching Scenarios'}
            </h3>
            <p>
              {scenarios.length === 0
                ? 'Record a successful browser flow to create the first immutable version.'
                : 'Try a different search.'}
            </p>
            {scenarios.length === 0 ? (
              <Link
                className="button button-primary"
                href={`/projects/${projectId}/journeys/new`}
              >
                Record Scenario
              </Link>
            ) : null}
          </div>
        ) : (
          <div className="crm-table-wrap">
            <table className="crm-table crm-scenario-table">
              <thead>
                <tr>
                  <th scope="col">Scenario</th>
                  <th scope="col">Recorded-flow version</th>
                  <th scope="col">Setup</th>
                  <th scope="col">Critical Action</th>
                  <th scope="col">Outcome Checks</th>
                  <th scope="col">Latest verdict</th>
                  <th scope="col">Last Run</th>
                  <th scope="col">Configurations</th>
                  <th aria-label="Actions" scope="col" />
                </tr>
              </thead>
              <tbody>
                {visibleScenarios.map((scenario) => (
                  <ScenarioRow
                    key={scenario.selectedJourney.id}
                    projectId={projectId}
                    scenario={scenario}
                  />
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </main>
  );
}

function ScenarioRow({
  projectId,
  scenario,
}: {
  readonly projectId: string;
  readonly scenario: ScenarioLineage;
}) {
  const run = scenario.latestCompatibleRun;
  return (
    <tr>
      <td data-label="Scenario">
        <Link
          className="crm-primary-link"
          href={`/projects/${projectId}/journeys/${scenario.selectedJourney.id}`}
        >
          <strong>{scenario.name}</strong>
          <span>
            {scenario.versions.length} recorded-flow version
            {scenario.versions.length === 1 ? '' : 's'}
          </span>
        </Link>
      </td>
      <td data-label="Recorded-flow version">
        <strong>Version {scenario.selectedJourney.version}</strong>
        <span className="crm-cell-detail">
          {scenario.selectedJourney.steps.length} recorded steps
        </span>
      </td>
      <td data-label="Setup">
        <StatusBadge tone={setupTone(scenario.setupState)}>
          {scenarioSetupLabel(scenario.setupState)}
        </StatusBadge>
      </td>
      <td data-label="Critical Action">
        {scenario.criticalAction.status === 'unavailable' ? (
          <StatusBadge tone="neutral">Unavailable</StatusBadge>
        ) : (
          <StatusBadge
            tone={scenario.criticalAction.value === null ? 'warning' : 'pass'}
          >
            {scenario.criticalAction.value === null ? 'Needed' : 'Ready'}
          </StatusBadge>
        )}
      </td>
      <td data-label="Outcome Checks">
        {scenario.outcomeChecks.status === 'available'
          ? scenario.outcomeChecks.value.length
          : 'Unavailable'}
      </td>
      <td data-label="Latest verdict">
        {scenario.runDataAvailable ? (
          <StatusBadge tone={verdictTone(run)}>{verdictLabel(run)}</StatusBadge>
        ) : (
          <StatusBadge tone="neutral">Unavailable</StatusBadge>
        )}
      </td>
      <td data-label="Last Run">
        {scenario.runDataAvailable && run !== null
          ? formatLocalDateTime(run.startedAt)
          : scenario.runDataAvailable
            ? 'Never'
            : 'Unavailable'}
      </td>
      <td data-label="Configurations">
        {scenario.configurationDataAvailable
          ? scenario.configurationCount
          : 'Unavailable'}
      </td>
      <td data-label="Actions">
        <Link
          className="button button-secondary button-compact"
          href={`/projects/${projectId}/journeys/${scenario.selectedJourney.id}`}
        >
          Open
        </Link>
      </td>
    </tr>
  );
}

function setupTone(state: ScenarioLineage['setupState']): StatusTone {
  if (state === 'ready') return 'pass';
  if (state === 'unavailable') return 'neutral';
  return 'warning';
}

function verdictTone(run: ScenarioLineage['latestCompatibleRun']): StatusTone {
  if (run === null) return 'neutral';
  if (
    run.canonicalVerdict === 'runner_error' ||
    run.canonicalVerdict === 'failed'
  ) {
    return 'failure';
  }
  if (run.canonicalVerdict === 'passed') return 'pass';
  return 'warning';
}

function messageOf(reason: unknown): string {
  return reason instanceof Error
    ? reason.message
    : 'Scenarios could not be loaded.';
}
