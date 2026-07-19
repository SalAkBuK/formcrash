'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import type { PersistedRunSummary } from '@formcrash/contracts';
import type { ExternalRunSummary } from '@formcrash/contracts';
import Link from 'next/link';

import { StateMessage } from '../../../components/ui/state-message';
import {
  StatusBadge,
  type StatusTone,
} from '../../../components/ui/status-badge';
import { formatDuration, formatLocalDateTime } from '../../../lib/formatters';
import { listExternalRuns } from '../../projects/api/external-experiments';
import { getRecentRuns } from '../api/get-runs';
import { RunHistoryList } from './run-history-list';

export function RunHistoryDashboard() {
  const [runs, setRuns] = useState<readonly PersistedRunSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [externalRuns, setExternalRuns] = useState<
    readonly ExternalRunSummary[]
  >([]);
  const [externalError, setExternalError] = useState<string | null>(null);
  const mounted = useRef(true);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const [history, externalHistory] = await Promise.allSettled([
        getRecentRuns(),
        listExternalRuns(undefined, 100),
      ]);
      if (!mounted.current) return;
      if (history.status === 'fulfilled') {
        setRuns(history.value.items);
        setError(null);
      } else {
        setError(messageOf(history.reason));
      }
      if (externalHistory.status === 'fulfilled') {
        setExternalRuns(externalHistory.value.items);
        setExternalError(null);
      } else {
        setExternalError(messageOf(externalHistory.reason));
      }
    } finally {
      if (mounted.current) setLoading(false);
    }
  }, []);

  useEffect(() => {
    mounted.current = true;
    void refresh();
    return () => {
      mounted.current = false;
    };
  }, [refresh]);

  return (
    <main className="dashboard-shell runs-screen">
      <RunHistoryList
        error={error}
        loading={loading}
        onRefresh={() => void refresh()}
        runs={runs}
      />
      <ExternalRunHistory
        error={externalError}
        loading={loading}
        runs={externalRuns}
      />
    </main>
  );
}

function messageOf(reason: unknown): string {
  return reason instanceof Error
    ? reason.message
    : 'Persisted run history is unavailable.';
}

function ExternalRunHistory({
  error,
  loading,
  runs,
}: {
  readonly error: string | null;
  readonly loading: boolean;
  readonly runs: readonly ExternalRunSummary[];
}) {
  return (
    <section
      className="panel crm-list-panel"
      aria-labelledby="external-run-history-title"
    >
      <div className="crm-list-toolbar">
        <div>
          <p className="eyebrow">External projects</p>
          <h2 id="external-run-history-title">External run evidence</h2>
          <span>{runs.length} recent runs across all projects</span>
        </div>
        <Link
          className="button button-secondary button-compact"
          href="/projects"
        >
          Open projects
        </Link>
      </div>
      {loading && runs.length === 0 ? (
        <StateMessage variant="loading">
          Loading external run history…
        </StateMessage>
      ) : null}
      {error !== null ? (
        <StateMessage variant="error">{error}</StateMessage>
      ) : null}
      {!loading && error === null && runs.length === 0 ? (
        <div className="empty-state">
          <h3>No external runs yet</h3>
          <p>Configure a project test to create cross-project evidence.</p>
        </div>
      ) : null}
      {runs.length > 0 ? (
        <div className="crm-table-wrap">
          <table className="crm-table">
            <thead>
              <tr>
                <th>Result</th>
                <th>Test</th>
                <th>Project</th>
                <th>Journey</th>
                <th>Started</th>
                <th>Duration</th>
                <th>Evidence</th>
              </tr>
            </thead>
            <tbody>
              {runs.map((run) => (
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
                  <td data-label="Project">
                    <Link href={`/projects/${run.projectId}`}>
                      {run.projectName}
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
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}
    </section>
  );
}

function runTone(status: ExternalRunSummary['status']): StatusTone {
  if (status === 'passed') return 'pass';
  if (status === 'failed' || status === 'runner_error') return 'failure';
  return 'warning';
}
