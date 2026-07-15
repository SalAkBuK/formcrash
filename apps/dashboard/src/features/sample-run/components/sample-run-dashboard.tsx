'use client';

import type { PersistedRunSummary, SampleRunMode } from '@formcrash/contracts';
import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useRef, useState } from 'react';

import { FormCrashApiError } from '../../../lib/api-client';
import { getRecentRuns } from '../../run-history/api/get-runs';
import { RunHistoryList } from '../../run-history/components/run-history-list';
import { startSampleRun } from '../api/start-sample-run';

const modeDescriptions: Record<SampleRunMode, string> = {
  vulnerable:
    'The checkout intentionally accepts both rapid submissions and should fail the recovery assertion.',
  fixed:
    'The checkout applies UI and server idempotency protection and should create one order.',
};

export function SampleRunDashboard() {
  const router = useRouter();
  const [mode, setMode] = useState<SampleRunMode>('vulnerable');
  const [starting, setStarting] = useState(false);
  const [startError, setStartError] = useState<string | null>(null);
  const [runs, setRuns] = useState<readonly PersistedRunSummary[]>([]);
  const [historyLoading, setHistoryLoading] = useState(true);
  const [historyError, setHistoryError] = useState<string | null>(null);
  const mounted = useRef(true);

  const loadHistory = useCallback(async () => {
    setHistoryLoading(true);
    try {
      const history = await getRecentRuns();
      if (!mounted.current) return;
      setRuns(history.items);
      setHistoryError(null);
    } catch (error: unknown) {
      if (!mounted.current) return;
      setHistoryError(
        error instanceof Error
          ? error.message
          : 'Persisted run history is unavailable.',
      );
    } finally {
      if (mounted.current) setHistoryLoading(false);
    }
  }, []);

  useEffect(() => {
    mounted.current = true;
    void loadHistory();
    return () => {
      mounted.current = false;
    };
  }, [loadHistory]);

  const handleStart = async (): Promise<void> => {
    setStarting(true);
    setStartError(null);
    try {
      const accepted = await startSampleRun(mode);
      if (!mounted.current) return;
      router.push(`/runs/${accepted.runId}`);
    } catch (error: unknown) {
      if (!mounted.current) return;
      if (error instanceof FormCrashApiError && error.status === 409) {
        setStartError(
          'Another browser run is active. Open the recent run or wait for it to finish, then try again.',
        );
      } else {
        setStartError(
          error instanceof Error
            ? error.message
            : 'The sample run could not be started.',
        );
      }
    } finally {
      if (mounted.current) setStarting(false);
    }
  };

  return (
    <main className="dashboard-shell">
      <header className="hero">
        <p className="eyebrow">Pre-release resilience workbench</p>
        <h1>FormCrash Lab</h1>
        <p className="hero-statement">
          FormCrash Lab breaks critical web journeys on purpose and proves
          whether they recover safely.
        </p>
        <div className="safety-notice" role="note">
          <strong>Controlled environments only.</strong> This bundled checkout
          uses fictional products, customer details, and local test records. Do
          not run destructive experiments against production or real user data.
        </div>
      </header>

      <section className="run-grid" aria-labelledby="run-sample-title">
        <div className="panel run-control-panel">
          <p className="eyebrow">Guaranteed sample path</p>
          <h2 id="run-sample-title">Run Sample Experiment</h2>
          <p>
            Replay the saved checkout journey and inject an Impatient User at
            the final Submit Order step.
          </p>

          <fieldset className="mode-selector">
            <legend>Checkout mode</legend>
            {(['vulnerable', 'fixed'] as const).map((value) => (
              <label
                className={`mode-card ${mode === value ? 'mode-card-selected' : ''}`}
                key={value}
              >
                <input
                  type="radio"
                  name="checkout-mode"
                  value={value}
                  checked={mode === value}
                  onChange={() => setMode(value)}
                />
                <span>
                  <strong>
                    {value === 'vulnerable' ? 'Vulnerable' : 'Fixed'}
                  </strong>
                  <small>{modeDescriptions[value]}</small>
                </span>
              </label>
            ))}
          </fieldset>

          <div className="selected-mode-explanation" aria-live="polite">
            <strong>Selected behavior:</strong> {modeDescriptions[mode]}
          </div>

          {startError !== null ? (
            <p className="state-message state-message-error" role="alert">
              {startError}
            </p>
          ) : null}
          <button
            className="button button-primary start-button"
            type="button"
            disabled={starting}
            aria-busy={starting}
            onClick={() => void handleStart()}
          >
            {starting ? 'Creating durable run…' : `Start ${mode} run`}
          </button>
          <p className="button-supporting-copy">
            FormCrash waits for a persisted run ID before opening live progress.
          </p>
        </div>

        <aside
          className="panel experiment-panel"
          aria-label="Experiment summary"
        >
          <p className="eyebrow">Saved experiment · version 1</p>
          <h2>Impatient User</h2>
          <dl className="experiment-spec">
            <div>
              <dt>Target</dt>
              <dd>Submit Order</dd>
            </div>
            <div>
              <dt>Triggers</dt>
              <dd>2 attempts</dd>
            </div>
            <div>
              <dt>Interval</dt>
              <dd>100 ms</dd>
            </div>
          </dl>
          <div className="assertion-preview">
            <span>Recovery assertion</span>
            <strong>No more than one order should be created.</strong>
          </div>
          <p className="technical-note">
            Request attempts and resulting business records are collected
            separately so repeated network activity is not confused with
            duplicate orders.
          </p>
        </aside>
      </section>

      <RunHistoryList
        runs={runs}
        loading={historyLoading}
        error={historyError}
        onRefresh={() => void loadHistory()}
      />
    </main>
  );
}
