'use client';

import type { PersistedRunSummary } from '@formcrash/contracts';
import Link from 'next/link';

import { Button } from '../../../components/ui/button';
import {
  StatusBadge,
  type StatusTone,
} from '../../../components/ui/status-badge';
import { StateMessage } from '../../../components/ui/state-message';
import {
  formatDuration,
  formatLocalDateTime,
  sentenceCase,
} from '../../../lib/formatters';

export interface RunHistoryListProps {
  readonly runs: readonly PersistedRunSummary[];
  readonly loading: boolean;
  readonly error: string | null;
  readonly onRefresh: () => void;
}

export function RunHistoryList({
  runs,
  loading,
  error,
  onRefresh,
}: RunHistoryListProps) {
  return (
    <section className="run-history-panel" aria-labelledby="history-title">
      <div className="run-history-header">
        <div>
          <h2 id="history-title">Runs</h2>
          <nav aria-label="Run views" className="run-history-tabs">
            <span aria-current="page">All runs</span>
            <span>Persisted evidence</span>
          </nav>
        </div>
        <div className="run-history-actions">
          <Button
            compact
            onClick={onRefresh}
            disabled={loading}
            aria-busy={loading}
          >
            {loading ? 'Refreshing…' : 'Refresh'}
          </Button>
          <Link className="button button-primary button-compact" href="/">
            Trigger run
          </Link>
        </div>
      </div>

      {runs.length > 0 ? (
        <div
          className="run-history-filters"
          aria-label="Available run statuses"
        >
          <span>STATUS</span>
          {availableStatuses(runs).map(([status, count]) => (
            <span className={`run-filter run-filter-${status}`} key={status}>
              {sentenceCase(status)} <strong>{count}</strong>
            </span>
          ))}
        </div>
      ) : null}

      {loading && runs.length === 0 ? (
        <StateMessage variant="loading">
          Loading persisted run history…
        </StateMessage>
      ) : null}
      {error !== null ? (
        <StateMessage variant="error">
          {error} Sample execution remains available.
        </StateMessage>
      ) : null}
      {!loading && error === null && runs.length === 0 ? (
        <div className="empty-state run-history-empty-state">
          <h3>No runs yet</h3>
          <p>
            Start the seeded experiment. Completed and interrupted runs will
            remain here after a restart.
          </p>
        </div>
      ) : null}
      {runs.length > 0 ? (
        <div className="run-history-table-wrap">
          <table className="run-history-table">
            <caption className="sr-only">
              Most recent persisted bundled sample runs
            </caption>
            <thead>
              <tr>
                <th scope="col">Result</th>
                <th scope="col">Test</th>
                <th scope="col">Started</th>
                <th scope="col">Duration</th>
                <th scope="col">Observed outcome</th>
                <th scope="col">Evidence</th>
              </tr>
            </thead>
            <tbody>
              {runs.map((run) => (
                <tr key={run.runId}>
                  <td data-label="Result">
                    <StatusBadge
                      className={`status-${run.status}`}
                      tone={runStatusTone(run.status)}
                    >
                      {sentenceCase(run.status)}
                    </StatusBadge>
                  </td>
                  <td data-label="Test">
                    <Link
                      className="run-history-primary-link"
                      href={`/runs/${run.runId}`}
                    >
                      <strong>{sentenceCase(run.mode)} mode</strong>
                      <code>{run.runId}</code>
                    </Link>
                  </td>
                  <td data-label="Started">
                    <span>{formatLocalDateTime(run.startedAt)}</span>
                  </td>
                  <td data-label="Duration">
                    <span>{formatDuration(run.durationMs)}</span>
                  </td>
                  <td data-label="Observed outcome">
                    <strong>{runOutcomeSummary(run)}</strong>
                    <span>{assertionSummary(run)}</span>
                  </td>
                  <td data-label="Evidence">
                    <strong>
                      {run.screenshotCount}{' '}
                      {run.screenshotCount === 1 ? 'screenshot' : 'screenshots'}
                    </strong>
                    <span>Browser and assertion record</span>
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

function runOutcomeSummary(run: PersistedRunSummary): string {
  if (run.createdOrderCount === null) return 'Order count unavailable';
  return `${run.createdOrderCount} ${run.createdOrderCount === 1 ? 'order' : 'orders'} created`;
}

function assertionSummary(run: PersistedRunSummary): string {
  if (run.assertionStatus === null || run.assertionStatus === 'not_evaluated') {
    return 'Outcome was not evaluated';
  }
  if (run.assertionStatus === 'passed') {
    return 'No duplicate order was observed';
  }
  if (run.assertionStatus === 'failed') {
    return 'Expected no more than one order';
  }
  return 'Outcome evaluation errored';
}

function runStatusTone(status: PersistedRunSummary['status']): StatusTone {
  if (status === 'passed') return 'pass';
  if (status === 'failed' || status === 'runner_error') return 'failure';
  if (status === 'incomplete') return 'warning';
  return 'neutral';
}

function availableStatuses(
  runs: readonly PersistedRunSummary[],
): readonly [PersistedRunSummary['status'], number][] {
  const counts = new Map<PersistedRunSummary['status'], number>();
  for (const run of runs) {
    counts.set(run.status, (counts.get(run.status) ?? 0) + 1);
  }
  return [...counts.entries()];
}
