'use client';

import type { PersistedRunSummary } from '@formcrash/contracts';
import Link from 'next/link';

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
    <section className="panel history-panel" aria-labelledby="history-title">
      <div className="section-heading-row">
        <div>
          <p className="eyebrow">Durable evidence</p>
          <h2 id="history-title">Recent runs</h2>
        </div>
        <button
          className="button button-secondary button-compact"
          type="button"
          onClick={onRefresh}
          disabled={loading}
          aria-busy={loading}
        >
          {loading ? 'Refreshing…' : 'Refresh'}
        </button>
      </div>

      {loading && runs.length === 0 ? (
        <p className="state-message" role="status">
          Loading persisted run history…
        </p>
      ) : null}
      {error !== null ? (
        <p className="state-message state-message-error" role="alert">
          {error} Sample execution remains available.
        </p>
      ) : null}
      {!loading && error === null && runs.length === 0 ? (
        <div className="empty-state">
          <h3>No runs yet</h3>
          <p>
            Start the seeded experiment. Completed and interrupted runs will
            remain here after a restart.
          </p>
        </div>
      ) : null}
      {runs.length > 0 ? (
        <ol className="history-list">
          {runs.map((run) => (
            <li key={run.runId}>
              <Link className="history-card" href={`/runs/${run.runId}`}>
                <div className="history-card-heading">
                  <span className={`status-badge status-${run.status}`}>
                    {sentenceCase(run.status)}
                  </span>
                  <strong>{sentenceCase(run.mode)} mode</strong>
                </div>
                <dl className="history-metrics">
                  <div>
                    <dt>Started</dt>
                    <dd>{formatLocalDateTime(run.startedAt)}</dd>
                  </div>
                  <div>
                    <dt>Duration</dt>
                    <dd>{formatDuration(run.durationMs)}</dd>
                  </div>
                  <div>
                    <dt>Orders</dt>
                    <dd>{run.createdOrderCount ?? '—'}</dd>
                  </div>
                  <div>
                    <dt>Assertion</dt>
                    <dd>
                      {run.assertionStatus === null
                        ? 'Not evaluated'
                        : sentenceCase(run.assertionStatus)}
                    </dd>
                  </div>
                  <div>
                    <dt>Screenshots</dt>
                    <dd>{run.screenshotCount}</dd>
                  </div>
                </dl>
              </Link>
            </li>
          ))}
        </ol>
      ) : null}
    </section>
  );
}
