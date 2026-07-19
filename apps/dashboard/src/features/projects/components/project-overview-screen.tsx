'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import type { ExternalRunSummary } from '@formcrash/contracts';

import { StateMessage } from '../../../components/ui/state-message';
import {
  StatusBadge,
  type StatusTone,
} from '../../../components/ui/status-badge';
import { formatDuration, formatLocalDateTime } from '../../../lib/formatters';
import { getProject } from '../api/projects';
import {
  loadProjectCrmData,
  scenarioSetupLabel,
  verdictLabel,
  type ProjectCrmData,
  type ScenarioLineage,
} from './crm-project-data';

export function ProjectOverviewScreen({
  projectId,
}: {
  readonly projectId: string;
}) {
  const [data, setData] = useState<ProjectCrmData | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    setError(null);
    void getProject(projectId)
      .then((project) => loadProjectCrmData(project, 20))
      .then((next) => {
        if (active) setData(next);
      })
      .catch((reason: unknown) => {
        if (active) setError(messageOf(reason));
      });
    return () => {
      active = false;
    };
  }, [projectId]);

  if (error !== null)
    return <StateMessage variant="error">{error}</StateMessage>;
  if (data === null)
    return (
      <StateMessage variant="loading">Loading project overview…</StateMessage>
    );

  const scenarios =
    data.scenarios.status === 'available' ? data.scenarios.value : [];
  const runs = data.runs.status === 'available' ? data.runs.value : [];
  const primaryScenario = scenarios[0] ?? null;
  const action = dominantAction(projectId, primaryScenario);
  const latestRun = primaryScenario?.latestCompatibleRun ?? runs[0] ?? null;
  const settings =
    data.settings.status === 'available' ? data.settings.value : null;
  const variableCount = settings?.variables.length ?? null;
  const missingVariables =
    settings?.variables.filter((variable) => !variable.configured) ?? [];

  return (
    <main className="dashboard-shell crm-screen crm-overview-screen">
      <header className="crm-page-heading crm-record-heading">
        <div>
          <p className="eyebrow">Project record</p>
          <h1>Overview</h1>
          <p>
            {data.project.description ||
              `Operational workspace for ${safeOrigin(data.project.targetUrl)}.`}
          </p>
        </div>
        <Link className="button button-primary" href={action.href}>
          {action.label}
        </Link>
      </header>

      <section className="crm-status-strip" aria-label="Project status">
        <StatusFact
          label="Environment"
          tone={
            data.project.environment === 'production' ? 'warning' : 'neutral'
          }
          value={sentenceCase(data.project.environment)}
        />
        <StatusFact
          label="Authentication"
          tone={
            settings === null
              ? 'neutral'
              : settings.authentication.available
                ? 'pass'
                : 'warning'
          }
          value={
            settings === null
              ? 'Unavailable'
              : settings.authentication.available
                ? 'Saved and available'
                : 'No saved authentication'
          }
        />
        <StatusFact
          label="Runtime variables"
          tone={
            variableCount === null
              ? 'neutral'
              : missingVariables.length === 0
                ? 'pass'
                : 'warning'
          }
          value={
            variableCount === null
              ? 'Unavailable'
              : missingVariables.length > 0
                ? `${missingVariables.length} missing`
                : `${variableCount} ready`
          }
        />
        <StatusFact
          label="Scenario setup"
          tone={setupTone(primaryScenario)}
          value={
            primaryScenario === null
              ? data.scenarios.status === 'unavailable'
                ? 'Unavailable'
                : 'Not recorded'
              : scenarioSetupLabel(primaryScenario.setupState)
          }
        />
        <StatusFact
          label="Latest compatible verdict"
          tone={runTone(latestRun)}
          value={verdictLabel(latestRun)}
        />
      </section>

      <div className="crm-overview-layout">
        <div className="crm-overview-primary">
          <OverviewScenarios projectId={projectId} scenarios={scenarios} />
          <OverviewRuns runs={runs} />
        </div>
        <aside className="crm-readiness-rail" aria-labelledby="readiness-title">
          <div className="crm-rail-heading">
            <p className="eyebrow">Readiness</p>
            <h2 id="readiness-title">Project controls</h2>
          </div>
          <dl className="crm-rail-facts">
            <RailFact
              label="Target origin"
              value={safeOrigin(data.project.targetUrl)}
            />
            <RailFact
              label="Environment"
              value={sentenceCase(data.project.environment)}
            />
            <RailFact
              label="Authentication"
              value={
                settings === null
                  ? 'Unavailable'
                  : settings.authentication.available
                    ? 'Saved authentication available'
                    : 'No saved authentication'
              }
            />
            <RailFact
              label="Runtime declarations"
              value={
                variableCount === null
                  ? 'Unavailable'
                  : `${variableCount} declared · ${missingVariables.length} missing`
              }
            />
            <RailFact
              label="Preparation hook"
              value={
                settings === null
                  ? 'Unavailable'
                  : settings.beforeRunHook === null
                    ? 'Not configured'
                    : 'Configured'
              }
            />
            <RailFact
              label="Cleanup hook"
              value={
                settings === null
                  ? 'Unavailable'
                  : settings.afterRunHook === null
                    ? 'Not configured'
                    : 'Configured'
              }
            />
            <RailFact
              label="Production boundary"
              value={
                data.project.environment === 'production'
                  ? 'Confirmation required for every execution'
                  : 'No production confirmation required'
              }
            />
            <RailFact
              label="Browser ownership"
              value="Exclusive · one browser workload at a time"
            />
          </dl>
          <Blockers
            data={data}
            missingVariables={missingVariables.map((variable) => variable.name)}
            scenario={primaryScenario}
          />
          <Link href={`/projects/${projectId}/settings`}>Review settings</Link>
        </aside>
      </div>
    </main>
  );
}

function OverviewScenarios({
  projectId,
  scenarios,
}: {
  readonly projectId: string;
  readonly scenarios: readonly ScenarioLineage[];
}) {
  return (
    <section
      className="panel crm-record-panel"
      aria-labelledby="recent-scenarios"
    >
      <div className="section-heading-row">
        <div>
          <p className="eyebrow">Recent records</p>
          <h2 id="recent-scenarios">Scenarios</h2>
        </div>
        <Link href={`/projects/${projectId}/scenarios`}>View all</Link>
      </div>
      {scenarios.length === 0 ? (
        <div className="empty-state crm-compact-empty">
          <h3>No Scenarios recorded</h3>
          <p>Record a successful browser flow to begin setup.</p>
        </div>
      ) : (
        <div className="crm-table-wrap">
          <table className="crm-table crm-overview-table">
            <thead>
              <tr>
                <th scope="col">Scenario</th>
                <th scope="col">Version</th>
                <th scope="col">Setup</th>
                <th scope="col">Latest verdict</th>
                <th aria-label="Actions" scope="col" />
              </tr>
            </thead>
            <tbody>
              {scenarios.slice(0, 5).map((scenario) => (
                <tr key={scenario.selectedJourney.id}>
                  <td data-label="Scenario">
                    <Link
                      className="crm-primary-link"
                      href={`/projects/${projectId}/journeys/${scenario.selectedJourney.id}`}
                    >
                      <strong>{scenario.name}</strong>
                      <span>{formatLocalDateTime(scenario.updatedAt)}</span>
                    </Link>
                  </td>
                  <td data-label="Version">
                    v{scenario.selectedJourney.version}
                  </td>
                  <td data-label="Setup">
                    <StatusBadge tone={setupTone(scenario)}>
                      {scenarioSetupLabel(scenario.setupState)}
                    </StatusBadge>
                  </td>
                  <td data-label="Latest verdict">
                    <StatusBadge tone={runTone(scenario.latestCompatibleRun)}>
                      {scenario.runDataAvailable
                        ? verdictLabel(scenario.latestCompatibleRun)
                        : 'Unavailable'}
                    </StatusBadge>
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
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

function OverviewRuns({
  runs,
}: {
  readonly runs: readonly ExternalRunSummary[];
}) {
  return (
    <section className="panel crm-record-panel" aria-labelledby="recent-runs">
      <div className="section-heading-row">
        <div>
          <p className="eyebrow">Persisted evidence</p>
          <h2 id="recent-runs">Recent Runs</h2>
        </div>
      </div>
      {runs.length === 0 ? (
        <div className="empty-state crm-compact-empty">
          <h3>No Run evidence</h3>
          <p>A completed Scenario Run will appear here.</p>
        </div>
      ) : (
        <div className="crm-table-wrap">
          <table className="crm-table crm-overview-table">
            <thead>
              <tr>
                <th scope="col">Scenario</th>
                <th scope="col">Verdict</th>
                <th scope="col">Started</th>
                <th scope="col">Duration</th>
                <th aria-label="Actions" scope="col" />
              </tr>
            </thead>
            <tbody>
              {runs.slice(0, 5).map((run) => (
                <tr key={run.runId}>
                  <td data-label="Scenario">
                    <strong>{run.journeyName}</strong>
                    <span className="crm-cell-detail">
                      {run.experimentName}
                    </span>
                  </td>
                  <td data-label="Verdict">
                    <StatusBadge tone={runTone(run)}>
                      {verdictLabel(run)}
                    </StatusBadge>
                  </td>
                  <td data-label="Started">
                    {formatLocalDateTime(run.startedAt)}
                  </td>
                  <td data-label="Duration">
                    {formatDuration(run.durationMs)}
                  </td>
                  <td data-label="Actions">
                    <Link
                      className="button button-secondary button-compact"
                      href={`/external-runs/${run.runId}`}
                    >
                      Inspect
                    </Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

function StatusFact({
  label,
  tone,
  value,
}: {
  readonly label: string;
  readonly tone: StatusTone;
  readonly value: string;
}) {
  return (
    <div>
      <span>{label}</span>
      <StatusBadge tone={tone}>{value}</StatusBadge>
    </div>
  );
}

function RailFact({
  label,
  value,
}: {
  readonly label: string;
  readonly value: string;
}) {
  return (
    <div>
      <dt>{label}</dt>
      <dd>{value}</dd>
    </div>
  );
}

function Blockers({
  data,
  missingVariables,
  scenario,
}: {
  readonly data: ProjectCrmData;
  readonly missingVariables: readonly string[];
  readonly scenario: ScenarioLineage | null;
}) {
  const blockers: string[] = [];
  if (data.scenarios.status === 'unavailable') {
    blockers.push('Scenario readiness is unavailable.');
  } else if (scenario === null) {
    blockers.push('Record the first Scenario.');
  } else if (scenario.setupState !== 'ready') {
    blockers.push(scenarioSetupLabel(scenario.setupState));
  }
  if (missingVariables.length > 0) {
    blockers.push(`Missing runtime variables: ${missingVariables.join(', ')}`);
  }
  if (
    data.project.environment === 'production' &&
    data.settings.status === 'available' &&
    data.settings.value.afterRunHook === null
  ) {
    blockers.push('No cleanup hook is configured for this production target.');
  }

  return (
    <section className="crm-rail-blockers" aria-labelledby="blockers-title">
      <h3 id="blockers-title">Relevant blockers</h3>
      {blockers.length === 0 ? (
        <p>No known project-level blockers.</p>
      ) : (
        <ul>
          {blockers.map((blocker) => (
            <li key={blocker}>{blocker}</li>
          ))}
        </ul>
      )}
    </section>
  );
}

export function dominantAction(
  projectId: string,
  scenario: ScenarioLineage | null,
): Readonly<{ href: string; label: string }> {
  if (scenario === null) {
    return {
      href: `/projects/${projectId}/journeys/new`,
      label: 'Record Scenario',
    };
  }
  if (
    scenario.setupState === 'critical_action_needed' ||
    scenario.setupState === 'outcome_checks_needed' ||
    scenario.setupState === 'unavailable'
  ) {
    return {
      href: `/projects/${projectId}/journeys/${scenario.selectedJourney.id}/outcomes`,
      label: 'Complete Setup',
    };
  }
  if (scenario.setupState === 'configuration_needed') {
    return {
      href: `/projects/${projectId}/tests/new?journeyId=${scenario.selectedJourney.id}&step=outcome`,
      label: 'Configure Test',
    };
  }
  const configuration = scenario.configurations[0];
  return configuration === undefined
    ? {
        href: `/projects/${projectId}/tests/new?journeyId=${scenario.selectedJourney.id}&step=outcome`,
        label: 'Configure Test',
      }
    : {
        href: `/projects/${projectId}/tests/${configuration.id}`,
        label: 'Run Scenario Again',
      };
}

function setupTone(scenario: ScenarioLineage | null): StatusTone {
  if (scenario === null || scenario.setupState === 'unavailable')
    return 'neutral';
  return scenario.setupState === 'ready' ? 'pass' : 'warning';
}

function runTone(run: ExternalRunSummary | null): StatusTone {
  if (run === null) return 'neutral';
  if (run.status === 'runner_error' || run.outcomeAggregate === 'failed')
    return 'failure';
  if (run.outcomeAggregate === 'passed') return 'pass';
  if (run.outcomeAggregate === 'could_not_verify') return 'warning';
  return 'neutral';
}

function safeOrigin(value: string): string {
  try {
    return new URL(value).origin;
  } catch {
    return value;
  }
}

function sentenceCase(value: string): string {
  return `${value.slice(0, 1).toUpperCase()}${value.slice(1)}`;
}

function messageOf(reason: unknown): string {
  return reason instanceof Error
    ? reason.message
    : 'The overview could not be loaded.';
}
