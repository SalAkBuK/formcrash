'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import type {
  ExternalExperimentVersion,
  ExternalRunSummary,
  PersistedJourney,
  Project,
  ProjectExecutionSettings,
} from '@formcrash/contracts';

import { StateMessage } from '../../../components/ui/state-message';
import { StatusBadge } from '../../../components/ui/status-badge';
import { formatCount, formatLocalDateTime } from '../../../lib/formatters';
import {
  getProjectSettings,
  listExternalRuns,
  listProjectExternalExperiments,
} from '../api/external-experiments';
import { getProject, listJourneys } from '../api/projects';

interface OverviewData {
  readonly experiments: readonly ExternalExperimentVersion[];
  readonly journeys: readonly PersistedJourney[];
  readonly project: Project;
  readonly runs: readonly ExternalRunSummary[];
  readonly settings: ProjectExecutionSettings;
}

export function ProjectOverviewScreen({
  projectId,
}: {
  readonly projectId: string;
}) {
  const [data, setData] = useState<OverviewData | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    void Promise.all([
      getProject(projectId),
      listJourneys(projectId),
      listProjectExternalExperiments(projectId),
      listExternalRuns(projectId, 5),
      getProjectSettings(projectId),
    ])
      .then(([project, journeys, experiments, runs, settings]) => {
        if (active) {
          setData({
            experiments,
            journeys,
            project,
            runs: runs.items,
            settings,
          });
        }
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

  const groupedTests = groupLatestTests(data.experiments);
  const latestJourney = data.journeys[0] ?? null;
  const latestRun = data.runs[0] ?? null;
  const nextAction = recommendedAction(
    projectId,
    latestJourney,
    groupedTests[0] ?? null,
    latestRun,
  );

  return (
    <main className="dashboard-shell crm-screen">
      <header className="crm-page-heading crm-compact-heading">
        <div>
          <p className="eyebrow">Project overview</p>
          <h2>Operational summary</h2>
          <p>
            {data.project.description ||
              'No project description has been saved.'}
          </p>
        </div>
        <Link className="button button-primary" href={nextAction.href}>
          {nextAction.label}
        </Link>
      </header>

      <section className="crm-metric-grid" aria-label="Project metrics">
        <Metric
          label="Journeys"
          value={formatCount(data.journeys.length, 'saved journey')}
        />
        <Metric
          label="Tests"
          value={formatCount(groupedTests.length, 'test')}
        />
        <Metric
          label="Runs"
          value={formatCount(data.runs.length, 'recent run')}
        />
        <Metric
          label="Authentication"
          value={
            data.settings.authentication.available
              ? 'Saved state available'
              : data.settings.authentication.configured
                ? 'Needs replacement'
                : 'Not configured'
          }
          tone={data.settings.authentication.available ? 'pass' : 'warning'}
        />
      </section>

      <div className="crm-overview-grid">
        <section className="panel crm-summary-panel">
          <div className="section-heading-row">
            <div>
              <p className="eyebrow">Readiness</p>
              <h3>Project setup</h3>
            </div>
          </div>
          <ul className="crm-readiness-list">
            <ReadinessItem complete label="Controlled target saved" />
            <ReadinessItem
              complete={data.journeys.length > 0}
              label="Journey recorded"
            />
            <ReadinessItem
              complete={groupedTests.length > 0}
              label="Test configured"
            />
            <ReadinessItem
              complete={latestRun !== null}
              label="Run evidence available"
            />
          </ul>
          <div className="crm-next-action">
            <span>Recommended next action</span>
            <strong>{nextAction.description}</strong>
            <Link href={nextAction.href}>{nextAction.label}</Link>
          </div>
        </section>

        <section className="panel crm-summary-panel">
          <div className="section-heading-row">
            <div>
              <p className="eyebrow">Recent activity</p>
              <h3>Latest durable records</h3>
            </div>
          </div>
          <dl className="crm-record-summary">
            <div>
              <dt>Latest journey</dt>
              <dd>
                {latestJourney === null ? (
                  <span>None recorded</span>
                ) : (
                  <Link
                    href={`/projects/${projectId}/journeys/${latestJourney.id}`}
                  >
                    {latestJourney.name} v{latestJourney.version}
                  </Link>
                )}
              </dd>
            </div>
            <div>
              <dt>Latest test</dt>
              <dd>
                {groupedTests[0] === undefined ? (
                  <span>None configured</span>
                ) : (
                  <Link
                    href={`/projects/${projectId}/tests/${groupedTests[0].id}`}
                  >
                    {groupedTests[0].name} v{groupedTests[0].version}
                  </Link>
                )}
              </dd>
            </div>
            <div>
              <dt>Latest run</dt>
              <dd>
                {latestRun === null ? (
                  <span>No run evidence</span>
                ) : (
                  <Link href={`/external-runs/${latestRun.runId}`}>
                    {latestRun.experimentName} ·{' '}
                    {formatLocalDateTime(latestRun.startedAt)}
                  </Link>
                )}
              </dd>
            </div>
          </dl>
        </section>
      </div>

      {latestRun !== null ? (
        <section className="panel crm-latest-run">
          <div>
            <p className="eyebrow">Latest result</p>
            <h3>{latestRun.experimentName}</h3>
            <p>
              {latestRun.journeyName} ·{' '}
              {formatLocalDateTime(latestRun.startedAt)}
            </p>
          </div>
          <StatusBadge tone={runTone(latestRun.status)}>
            {latestRun.status}
          </StatusBadge>
          <div>
            <strong>{latestRun.screenshotCount}</strong>
            <span>screenshots</span>
          </div>
          <div>
            <strong>
              {latestRun.passedAssertionCount}/{latestRun.assertionCount}
            </strong>
            <span>assertions passed</span>
          </div>
          <Link
            className="button button-secondary"
            href={`/external-runs/${latestRun.runId}`}
          >
            Inspect result
          </Link>
        </section>
      ) : null}
    </main>
  );
}

function Metric({
  label,
  tone = 'neutral',
  value,
}: {
  readonly label: string;
  readonly tone?: 'neutral' | 'pass' | 'warning';
  readonly value: string;
}) {
  return (
    <article className="panel crm-metric">
      <span>{label}</span>
      <strong>{value}</strong>
      <StatusBadge tone={tone}>
        {tone === 'pass' ? 'Ready' : tone === 'warning' ? 'Review' : 'Saved'}
      </StatusBadge>
    </article>
  );
}

function ReadinessItem({
  complete,
  label,
}: {
  readonly complete: boolean;
  readonly label: string;
}) {
  return (
    <li>
      <StatusBadge tone={complete ? 'pass' : 'warning'}>
        {complete ? 'Ready' : 'Needed'}
      </StatusBadge>
      <span>{label}</span>
    </li>
  );
}

function groupLatestTests(
  versions: readonly ExternalExperimentVersion[],
): readonly ExternalExperimentVersion[] {
  const seen = new Set<string>();
  return versions.filter((version) => {
    if (seen.has(version.experimentId)) return false;
    seen.add(version.experimentId);
    return true;
  });
}

function recommendedAction(
  projectId: string,
  journey: PersistedJourney | null,
  experiment: ExternalExperimentVersion | null,
  run: ExternalRunSummary | null,
): Readonly<{ href: string; label: string; description: string }> {
  if (journey === null) {
    return {
      href: `/projects/${projectId}/journeys/new`,
      label: 'Record journey',
      description: 'Capture the first successful browser path.',
    };
  }
  if (experiment === null) {
    return {
      href: `/projects/${projectId}/tests/new?journeyId=${journey.id}&step=outcome`,
      label: 'Configure test',
      description: 'Define an expected outcome and repeated-action test.',
    };
  }
  if (run === null) {
    return {
      href: `/projects/${projectId}/tests/${experiment.id}`,
      label: 'Open test',
      description: 'Review the saved test and run it with controlled data.',
    };
  }
  return {
    href: `/external-runs/${run.runId}`,
    label: 'Inspect latest result',
    description: 'Review the latest outcome and durable evidence.',
  };
}

function runTone(status: ExternalRunSummary['status']) {
  if (status === 'passed') return 'pass' as const;
  if (status === 'failed' || status === 'runner_error')
    return 'failure' as const;
  return 'warning' as const;
}

function messageOf(reason: unknown): string {
  return reason instanceof Error
    ? reason.message
    : 'The overview could not be loaded.';
}
