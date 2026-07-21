'use client';

import Link from 'next/link';
import { useEffect, useMemo, useState } from 'react';
import type {
  ExternalExperimentVersion,
  ExternalRunSummary,
} from '@formcrash/contracts';

import { StateMessage } from '../../../components/ui/state-message';
import {
  StatusBadge,
  type StatusTone,
} from '../../../components/ui/status-badge';
import { formatDuration, formatLocalDateTime } from '../../../lib/formatters';
import {
  compareExternalRuns,
  listExternalRuns,
  listProjectExternalExperiments,
} from '../api/external-experiments';
import { verdictLabel } from './crm-project-data';

type ComparisonState = 'available' | 'unavailable' | 'could_not_check';

export function ProjectRunsScreen({
  projectId,
}: {
  readonly projectId: string;
}) {
  const [runs, setRuns] = useState<readonly ExternalRunSummary[]>([]);
  const [experiments, setExperiments] = useState<
    readonly ExternalExperimentVersion[]
  >([]);
  const [comparisons, setComparisons] = useState<
    ReadonlyMap<string, ComparisonState>
  >(new Map());
  const [query, setQuery] = useState('');
  const [status, setStatus] = useState('all');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  async function refresh(): Promise<void> {
    setLoading(true);
    setError(null);
    try {
      const [runResult, experimentResult] = await Promise.all([
        listExternalRuns(projectId, 100),
        listProjectExternalExperiments(projectId),
      ]);
      const orderedRuns = [...runResult.items].sort(
        (left, right) =>
          Date.parse(right.startedAt) - Date.parse(left.startedAt),
      );
      setRuns(orderedRuns);
      setExperiments(experimentResult);
      setComparisons(await loadComparisonStates(orderedRuns));
    } catch (reason: unknown) {
      setError(messageOf(reason));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void refresh();
  }, [projectId]);

  const experimentByVersion = useMemo(
    () => new Map(experiments.map((experiment) => [experiment.id, experiment])),
    [experiments],
  );
  const visibleRuns = useMemo(() => {
    const normalized = query.trim().toLowerCase();
    return runs.filter(
      (run) =>
        (status === 'all' || run.canonicalVerdict === status) &&
        (normalized === '' ||
          `${run.experimentName} ${run.journeyName} ${run.runId}`
            .toLowerCase()
            .includes(normalized)),
    );
  }, [query, runs, status]);

  return (
    <main className="dashboard-shell crm-screen">
      <header className="crm-page-heading crm-compact-heading">
        <div>
          <p className="eyebrow">Persisted evidence</p>
          <h1>Runs</h1>
          <p>Recorded Scenario outcomes for this project, latest first.</p>
        </div>
        <button
          className="button button-secondary"
          disabled={loading}
          onClick={() => void refresh()}
          type="button"
        >
          Refresh
        </button>
      </header>
      {error !== null ? (
        <StateMessage variant="error">{error}</StateMessage>
      ) : null}
      <section
        className="panel crm-list-panel"
        aria-labelledby="run-history-title"
      >
        <div className="crm-list-toolbar">
          <div>
            <h2 id="run-history-title">Run history</h2>
            <span>{visibleRuns.length} visible Runs</span>
          </div>
          <div className="crm-list-filters">
            <label>
              <span className="visually-hidden">Search Runs</span>
              <input
                onChange={(event) => setQuery(event.target.value)}
                placeholder="Search Runs"
                type="search"
                value={query}
              />
            </label>
            <select
              aria-label="Filter Run status"
              onChange={(event) => setStatus(event.target.value)}
              value={status}
            >
              <option value="all">All outcomes</option>
              <option value="passed">Passed</option>
              <option value="failed">Failed</option>
              <option value="could_not_verify">Could not verify</option>
              <option value="runner_error">Runner error</option>
            </select>
          </div>
        </div>
        {loading ? (
          <StateMessage variant="loading">Loading Runs…</StateMessage>
        ) : visibleRuns.length === 0 ? (
          <div className="empty-state">
            <h3>
              {runs.length === 0 ? 'No Run evidence' : 'No matching Runs'}
            </h3>
            <p>
              {runs.length === 0
                ? 'Complete a configured Scenario to create durable evidence.'
                : 'Adjust the real search or status filter.'}
            </p>
            {runs.length === 0 ? (
              <Link
                className="button button-primary"
                href={`/projects/${projectId}/scenarios`}
              >
                Review Scenarios
              </Link>
            ) : null}
          </div>
        ) : (
          <div className="crm-table-wrap">
            <table className="crm-table crm-runs-table">
              <thead>
                <tr>
                  <th scope="col">Scenario</th>
                  <th scope="col">Verdict</th>
                  <th scope="col">Configuration</th>
                  <th scope="col">Recorded-flow version</th>
                  <th scope="col">Started</th>
                  <th scope="col">Duration</th>
                  <th scope="col">Outcome summary</th>
                  <th scope="col">Comparison</th>
                  <th scope="col">Evidence</th>
                  <th aria-label="Actions" scope="col" />
                </tr>
              </thead>
              <tbody>
                {visibleRuns.map((run) => {
                  const experiment = experimentByVersion.get(
                    run.experimentVersionId,
                  );
                  return (
                    <tr key={run.runId}>
                      <td data-label="Scenario">
                        <Link
                          className="crm-primary-link"
                          href={`/external-runs/${run.runId}`}
                        >
                          <strong>{run.journeyName}</strong>
                          <code>{run.runId.slice(0, 8)}</code>
                        </Link>
                      </td>
                      <td data-label="Verdict">
                        <StatusBadge tone={runTone(run)}>
                          {verdictLabel(run)}
                        </StatusBadge>
                      </td>
                      <td data-label="Configuration">
                        {experiment === undefined ? (
                          <span>Unavailable</span>
                        ) : (
                          <span>
                            <strong>{experiment.name}</strong>
                            <span className="crm-cell-detail">
                              Configuration v{experiment.version}
                            </span>
                          </span>
                        )}
                      </td>
                      <td data-label="Recorded-flow version">
                        {experiment === undefined
                          ? 'Unavailable'
                          : `Version ${experiment.journeySnapshot.version}`}
                      </td>
                      <td data-label="Started">
                        {formatLocalDateTime(run.startedAt)}
                      </td>
                      <td data-label="Duration">
                        {formatDuration(run.durationMs)}
                      </td>
                      <td data-label="Outcome summary">
                        {outcomeSummary(run)}
                      </td>
                      <td data-label="Comparison">
                        <ComparisonBadge state={comparisons.get(run.runId)} />
                      </td>
                      <td data-label="Evidence">
                        {run.screenshotCount} screenshots ·{' '}
                        {run.passedAssertionCount}/{run.assertionCount}{' '}
                        assertions
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
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </main>
  );
}

async function loadComparisonStates(
  runs: readonly ExternalRunSummary[],
): Promise<ReadonlyMap<string, ComparisonState>> {
  const entries = await Promise.all(
    runs.map(async (run, index) => {
      const previous = runs
        .slice(index + 1)
        .find(
          (candidate) =>
            candidate.experimentVersionId === run.experimentVersionId,
        );
      if (previous === undefined) return [run.runId, 'unavailable'] as const;
      try {
        const comparison = await compareExternalRuns(previous.runId, run.runId);
        return [
          run.runId,
          comparison.compatibility === 'compatible'
            ? 'available'
            : 'unavailable',
        ] as const;
      } catch {
        return [run.runId, 'could_not_check'] as const;
      }
    }),
  );
  return new Map(entries);
}

function ComparisonBadge({
  state,
}: {
  readonly state: ComparisonState | undefined;
}) {
  if (state === 'available')
    return <StatusBadge tone="pass">Available</StatusBadge>;
  if (state === 'could_not_check')
    return <StatusBadge tone="neutral">Could not check</StatusBadge>;
  return <StatusBadge tone="neutral">Not available</StatusBadge>;
}

function runTone(run: ExternalRunSummary): StatusTone {
  if (
    run.canonicalVerdict === 'runner_error' ||
    run.canonicalVerdict === 'failed'
  ) {
    return 'failure';
  }
  if (run.canonicalVerdict === 'passed') return 'pass';
  return 'warning';
}

function outcomeSummary(run: ExternalRunSummary): string {
  if (run.outcomeAggregate === 'not_configured')
    return 'Outcome Checks not configured';
  if (run.outcomeAggregate === 'could_not_verify')
    return 'Outcome could not be verified';
  return `${run.matchedRequestCount} matching requests · ${run.passedAssertionCount}/${run.assertionCount} assertions`;
}

function messageOf(reason: unknown): string {
  return reason instanceof Error ? reason.message : 'Runs could not be loaded.';
}
