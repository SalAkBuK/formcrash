'use client';

import {
  isTerminalRunStatus,
  type PersistedRunDetail,
  type RunStatus,
} from '@formcrash/contracts';
import Link from 'next/link';
import { useEffect, useRef, useState } from 'react';

import {
  formatDuration,
  formatLocalDateTime,
  sentenceCase,
} from '../../../lib/formatters';
import { AssertionAndEvidence } from './assertion-and-evidence';
import { EventTimeline } from './event-timeline';
import { ScreenshotGallery } from './screenshot-gallery';
import { useLiveRun } from '../hooks/use-live-run';
import {
  countEvents,
  currentJourneyStep,
  deriveRunStatus,
} from '../models/event-presentation';

export function RunDetailView({
  initialRun,
}: {
  readonly initialRun: PersistedRunDetail;
}) {
  const { connectionStatus, detail, events, liveError, reload } =
    useLiveRun(initialRun);
  const status = deriveRunStatus(events, detail.status);
  const terminal = isTerminalRunStatus(status);
  const resultHeading = useRef<HTMLHeadingElement>(null);
  const elapsedMs = useElapsedTime(
    detail.startedAt,
    terminal,
    detail.durationMs,
  );
  const step = currentJourneyStep(events);
  const triggers = countEvents(events, 'experiment.triggered');
  const requests = countEvents(events, 'request.started');

  useEffect(() => {
    if (terminal) resultHeading.current?.focus();
  }, [terminal]);

  return (
    <main className="dashboard-shell run-detail-shell">
      <nav className="top-nav" aria-label="Run navigation">
        <Link href="/" className="brand-link">
          FormCrash Lab
        </Link>
        <Link href="/">← Back to run history</Link>
      </nav>

      <header className={`result-hero result-${status}`}>
        <div>
          <p className="eyebrow">Sample Checkout · Impatient User</p>
          <h1 ref={resultHeading} tabIndex={-1}>
            {resultTitle(status)}
          </h1>
          <p>{resultSummary(status)}</p>
        </div>
        <span className={`result-seal status-${status}`} aria-live="polite">
          {sentenceCase(status)}
        </span>
        <dl className="result-metadata">
          <div>
            <dt>Mode</dt>
            <dd>{sentenceCase(detail.mode)}</dd>
          </div>
          <div>
            <dt>Started</dt>
            <dd>{formatLocalDateTime(detail.startedAt)}</dd>
          </div>
          <div>
            <dt>Completed</dt>
            <dd>{formatLocalDateTime(detail.completedAt)}</dd>
          </div>
          <div>
            <dt>Duration</dt>
            <dd>{formatDuration(terminal ? detail.durationMs : elapsedMs)}</dd>
          </div>
        </dl>
        <div className="run-identity">
          <span>Run ID</span>
          <code>{detail.runId}</code>
          <button
            className="copy-button"
            type="button"
            onClick={() => void navigator.clipboard.writeText(detail.runId)}
          >
            Copy
          </button>
        </div>
      </header>

      {!terminal ? (
        <section
          className="panel live-progress"
          aria-labelledby="progress-title"
        >
          <div className="section-heading-row">
            <div>
              <p className="eyebrow">Controlled Chromium</p>
              <h2 id="progress-title">Live execution progress</h2>
            </div>
            <span
              className={`connection-badge connection-${connectionStatus}`}
              aria-live="polite"
            >
              {sentenceCase(connectionStatus)}
            </span>
          </div>
          <dl className="live-metrics">
            <div>
              <dt>Current status</dt>
              <dd>{sentenceCase(status)}</dd>
            </div>
            <div>
              <dt>Journey step</dt>
              <dd>{step ?? 'Preparing saved journey'}</dd>
            </div>
            <div className={triggers > 0 ? 'metric-disruption' : undefined}>
              <dt>Impatient User</dt>
              <dd>{triggers}/2 triggers issued</dd>
            </div>
            <div>
              <dt>Order requests</dt>
              <dd>{requests} observed</dd>
            </div>
            <div>
              <dt>Assertion</dt>
              <dd>
                {countEvents(events, 'assertion.evaluating') > 0
                  ? 'Evaluating'
                  : 'Pending'}
              </dd>
            </div>
            <div>
              <dt>Elapsed</dt>
              <dd>{formatDuration(elapsedMs)}</dd>
            </div>
          </dl>
        </section>
      ) : null}

      {liveError !== null || connectionStatus === 'disconnected' ? (
        <div
          className="state-message state-message-error reconnect-message"
          role="alert"
        >
          <p>
            {liveError ??
              'Live progress disconnected. Persisted events remain authoritative.'}
          </p>
          <button
            className="button button-secondary button-compact"
            type="button"
            onClick={() => void reload()}
          >
            Reload persisted state
          </button>
        </div>
      ) : null}

      {terminal && status === 'runner_error' ? (
        <RunnerProblem run={detail} />
      ) : terminal ? (
        <AssertionAndEvidence run={detail} />
      ) : null}
      {terminal ? <ScreenshotGallery run={detail} /> : null}

      {detail.evidenceWarnings.length > 0 ? (
        <section
          className="panel warnings-panel"
          aria-labelledby="warnings-title"
        >
          <h2 id="warnings-title">Evidence warnings</h2>
          <ul>
            {detail.evidenceWarnings.map((warning) => (
              <li key={`${warning.code}-${warning.label}`}>
                <strong>{sentenceCase(warning.label)}</strong>:{' '}
                {warning.message}
              </li>
            ))}
          </ul>
        </section>
      ) : null}
      <EventTimeline events={events} collapsible={terminal} />
    </main>
  );
}

function useElapsedTime(
  startedAt: string,
  terminal: boolean,
  persistedDuration: number | null,
): number {
  const [elapsed, setElapsed] = useState(
    persistedDuration ?? Math.max(0, Date.now() - Date.parse(startedAt)),
  );
  useEffect(() => {
    if (terminal) {
      if (persistedDuration !== null) setElapsed(persistedDuration);
      return;
    }
    const update = () =>
      setElapsed(Math.max(0, Date.now() - Date.parse(startedAt)));
    update();
    const timer = setInterval(update, 250);
    return () => clearInterval(timer);
  }, [persistedDuration, startedAt, terminal]);
  return elapsed;
}

function resultTitle(status: RunStatus): string {
  switch (status) {
    case 'passed':
      return 'Duplicate protection held';
    case 'failed':
      return 'Duplicate order protection failed';
    case 'incomplete':
      return 'Run incomplete';
    case 'runner_error':
      return 'Runner stopped with an error';
    default:
      return 'Experiment running';
  }
}

function resultSummary(status: RunStatus): string {
  switch (status) {
    case 'passed':
      return 'Repeated action produced one order. The saved recovery rule held.';
    case 'failed':
      return 'Two rapid submissions created two orders. The application accepted both.';
    case 'incomplete':
      return 'The run ended before every recovery assertion could be evaluated.';
    case 'runner_error':
      return 'FormCrash could not finish browser execution. This is not an application assertion failure.';
    default:
      return 'The saved journey is executing with live persisted evidence.';
  }
}

function RunnerProblem({ run }: { readonly run: PersistedRunDetail }) {
  const error = run.runnerError;
  return (
    <section
      className="panel runner-problem"
      aria-labelledby="runner-problem-title"
    >
      <p className="eyebrow">Execution problem</p>
      <h2 id="runner-problem-title">The browser run could not finish</h2>
      <p>
        {error?.message ??
          'FormCrash stopped before it could evaluate application recovery.'}
      </p>
      {error?.failedStep === null || error?.failedStep === undefined ? null : (
        <p>
          <strong>Stopped at:</strong> {error.failedStep.stepName}
        </p>
      )}
      <p className="technical-note">
        This is a runner problem, not a failed duplicate-protection assertion.
      </p>
    </section>
  );
}
