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
    <section className="panel history-panel" aria-labelledby="history-title">
      <div className="section-heading-row">
        <div>
          <p className="eyebrow">Durable evidence</p>
          <h2 id="history-title">Recent runs</h2>
        </div>
        <Button
          compact
          onClick={onRefresh}
          disabled={loading}
          aria-busy={loading}
        >
          {loading ? 'Refreshing…' : 'Refresh'}
        </Button>
      </div>

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
                  <StatusBadge
                    className={`status-${run.status}`}
                    tone={runStatusTone(run.status)}
                  >
                    {sentenceCase(run.status)}
                  </StatusBadge>
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

function runStatusTone(status: PersistedRunSummary['status']): StatusTone {
  if (status === 'passed') return 'pass';
  if (status === 'failed' || status === 'runner_error') return 'failure';
  if (status === 'incomplete') return 'warning';
  return 'neutral';
}
