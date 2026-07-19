'use client';

import Link from 'next/link';
import { useEffect, useMemo, useState } from 'react';
import type { ExternalRunSummary } from '@formcrash/contracts';

import { StateMessage } from '../../../components/ui/state-message';
import {
  StatusBadge,
  type StatusTone,
} from '../../../components/ui/status-badge';
import { formatDuration, formatLocalDateTime } from '../../../lib/formatters';
import { listExternalRuns } from '../api/external-experiments';

export function ProjectRunsScreen({
  projectId,
}: {
  readonly projectId: string;
}) {
  const [runs, setRuns] = useState<readonly ExternalRunSummary[]>([]);
  const [query, setQuery] = useState('');
  const [status, setStatus] = useState('all');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  async function refresh(): Promise<void> {
    setLoading(true);
    setError(null);
    try {
      setRuns((await listExternalRuns(projectId, 100)).items);
    } catch (reason: unknown) {
      setError(messageOf(reason));
    } finally {
      setLoading(false);
    }
  }
  useEffect(() => {
    void refresh();
  }, [projectId]);

  const visibleRuns = useMemo(() => {
    const normalized = query.trim().toLowerCase();
    return runs.filter(
      (run) =>
        (status === 'all' || run.status === status) &&
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
          <p className="eyebrow">Durable evidence</p>
          <h2>Project runs</h2>
          <p>Persisted external test outcomes for this project.</p>
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
      <section className="panel crm-list-panel">
        <div className="crm-list-toolbar">
          <div>
            <h3>Run history</h3>
            <span>{visibleRuns.length} visible runs</span>
          </div>
          <div className="crm-list-filters">
            <label>
              <span className="visually-hidden">Search runs</span>
              <input
                onChange={(event) => setQuery(event.target.value)}
                placeholder="Search runs"
                type="search"
                value={query}
              />
            </label>
            <select
              aria-label="Filter run status"
              onChange={(event) => setStatus(event.target.value)}
              value={status}
            >
              <option value="all">All outcomes</option>
              <option value="passed">Passed</option>
              <option value="failed">Failed</option>
              <option value="runner_error">Runner error</option>
              <option value="incomplete">Incomplete</option>
            </select>
          </div>
        </div>
        {loading ? (
          <StateMessage variant="loading">Loading runs…</StateMessage>
        ) : visibleRuns.length === 0 ? (
          <div className="empty-state">
            <h3>
              {runs.length === 0 ? 'No run evidence' : 'No matching runs'}
            </h3>
            <p>
              {runs.length === 0
                ? 'Configure and run a test to create durable evidence.'
                : 'Adjust the filters to see more results.'}
            </p>
            {runs.length === 0 ? (
              <Link
                className="button button-primary"
                href={`/projects/${projectId}/tests/new?step=outcome`}
              >
                Configure test
              </Link>
            ) : null}
          </div>
        ) : (
          <div className="crm-table-wrap">
            <table className="crm-table">
              <thead>
                <tr>
                  <th>Result</th>
                  <th>Test</th>
                  <th>Journey</th>
                  <th>Started</th>
                  <th>Duration</th>
                  <th>Evidence</th>
                  <th aria-label="Actions" />
                </tr>
              </thead>
              <tbody>
                {visibleRuns.map((run) => (
                  <tr key={run.runId}>
                    <td data-label="Result">
                      <StatusBadge tone={runTone(run.status)}>
                        {run.status}
                      </StatusBadge>
                    </td>
                    <td data-label="Test">
                      <Link
                        className="crm-primary-link"
                        href={`/external-runs/${run.runId}`}
                      >
                        <strong>{run.experimentName}</strong>
                        <code>{run.runId.slice(0, 8)}</code>
                      </Link>
                    </td>
                    <td data-label="Journey">{run.journeyName}</td>
                    <td data-label="Started">
                      {formatLocalDateTime(run.startedAt)}
                    </td>
                    <td data-label="Duration">
                      {formatDuration(run.durationMs)}
                    </td>
                    <td data-label="Evidence">
                      {run.screenshotCount} screenshots ·{' '}
                      {run.passedAssertionCount}/{run.assertionCount} assertions
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
    </main>
  );
}

function runTone(status: ExternalRunSummary['status']): StatusTone {
  if (status === 'passed') return 'pass';
  if (status === 'failed' || status === 'runner_error') return 'failure';
  return 'warning';
}
function messageOf(reason: unknown): string {
  return reason instanceof Error ? reason.message : 'Runs could not be loaded.';
}
