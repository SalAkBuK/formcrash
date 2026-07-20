'use client';

import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import type {
  Project,
  RecordedJourneyStep,
  RecordingSession,
  ReplayLocator,
} from '@formcrash/contracts';

import { StateMessage } from '../../../components/ui/state-message';
import { StatusBadge } from '../../../components/ui/status-badge';
import { FormCrashApiError } from '../../../lib/api-client';
import {
  getProject,
  getRecording,
  saveJourney,
  startRecording,
  stopRecording,
} from '../api/projects';
import {
  AuthenticationRecoveryPanel,
  useAuthenticationGate,
} from './authentication-gate';

export function JourneyRecordingScreen({
  projectId,
}: {
  readonly projectId: string;
}) {
  const router = useRouter();
  const [project, setProject] = useState<Project | null>(null);
  const [recording, setRecording] = useState<RecordingSession | null>(null);
  const [steps, setSteps] = useState<readonly RecordedJourneyStep[]>([]);
  const [journeyName, setJourneyName] = useState('');
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const authentication = useAuthenticationGate({ projectId });

  useEffect(() => {
    let active = true;
    void getProject(projectId)
      .then((item) => {
        if (active) setProject(item);
      })
      .catch((reason: unknown) => {
        if (active) setError(messageOf(reason));
      });
    return () => {
      active = false;
    };
  }, [projectId]);

  useEffect(() => {
    if (recording?.status !== 'recording') return;
    const timer = window.setInterval(() => {
      void getRecording(projectId, recording.id)
        .then((next) => {
          setRecording(next);
          setSteps(next.steps);
        })
        .catch((reason: unknown) => setError(messageOf(reason)));
    }, 750);
    return () => window.clearInterval(timer);
  }, [projectId, recording?.id, recording?.status]);

  async function begin(preflightComplete = false): Promise<boolean> {
    const operation = { kind: 'startRecording', projectId } as const;
    if (!preflightComplete && !(await authentication.ensure(operation)))
      return false;
    setBusy('start');
    setError(null);
    try {
      const session = await startRecording(projectId);
      setRecording(session);
      setSteps(session.steps);
      if (session.status === 'runner_error') {
        setError(session.errorMessage);
        return false;
      }
      return true;
    } catch (reason: unknown) {
      if (
        reason instanceof FormCrashApiError &&
        reason.code === 'AUTHENTICATION_REQUIRED'
      ) {
        authentication.requireRecovery(operation, 'expired');
      } else setError(messageOf(reason));
      return false;
    } finally {
      setBusy(null);
    }
  }
  async function end(): Promise<void> {
    if (recording === null) return;
    setBusy('stop');
    setError(null);
    try {
      const session = await stopRecording(projectId, recording.id);
      setRecording(session);
      setSteps(session.steps);
      if (journeyName === '')
        setJourneyName(`${project?.name ?? 'Recorded'} journey`);
      if (session.status === 'runner_error') setError(session.errorMessage);
    } catch (reason: unknown) {
      setError(messageOf(reason));
    } finally {
      setBusy(null);
    }
  }
  async function save(): Promise<void> {
    if (recording === null) return;
    setBusy('save');
    setError(null);
    try {
      const journey = await saveJourney(
        projectId,
        recording.id,
        journeyName,
        steps,
      );
      router.push(`/projects/${projectId}/journeys/${journey.id}`);
    } catch (reason: unknown) {
      setError(messageOf(reason));
      setBusy(null);
    }
  }
  function updateStep(
    index: number,
    patch: Partial<RecordedJourneyStep>,
  ): void {
    setSteps((current) =>
      current.map((step, itemIndex) =>
        itemIndex === index ? { ...step, ...patch } : step,
      ),
    );
  }

  if (project === null && error === null)
    return (
      <StateMessage variant="loading">
        Loading recording workspace…
      </StateMessage>
    );
  if (project === null)
    return <StateMessage variant="error">{error}</StateMessage>;
  const risks = journeyQualityWarnings(steps);

  return (
    <main className="dashboard-shell crm-screen">
      <header className="crm-page-heading crm-compact-heading">
        <div>
          <p className="eyebrow">New journey</p>
          <h2>Record a successful path</h2>
          <p>
            Use the visible controlled browser, then inspect every captured step
            before saving an immutable version.
          </p>
        </div>
        <StatusBadge
          live
          tone={
            recording?.status === 'recording'
              ? 'browser'
              : recording?.status === 'runner_error'
                ? 'failure'
                : 'neutral'
          }
        >
          {recording?.status ?? 'Ready'}
        </StatusBadge>
      </header>
      {project.environment === 'production' ? (
        <StateMessage variant="warning">
          Recording targets production and can create or modify real data.
          Prefer a controlled non-production environment.
        </StateMessage>
      ) : null}
      {error !== null ? (
        <StateMessage variant="error">{error}</StateMessage>
      ) : null}
      <AuthenticationRecoveryPanel
        gate={authentication}
        onRetry={(operation) => {
          if (operation.kind !== 'startRecording') return;
          void begin(true).then((started) => {
            if (started) authentication.complete();
          });
        }}
      />
      <section className="panel crm-recording-control">
        <div>
          <p className="eyebrow">Browser recorder</p>
          <h3>{project.name}</h3>
          <code>{project.targetUrl}</code>
        </div>
        <div className="crm-form-actions">
          <button
            className="button button-primary"
            disabled={
              busy !== null ||
              recording?.status === 'recording' ||
              authentication.pending !== null
            }
            onClick={() => void begin()}
            type="button"
          >
            {busy === 'start' ? 'Launching browser…' : 'Start recording'}
          </button>
          <button
            className="button button-secondary"
            disabled={busy !== null || recording?.status !== 'recording'}
            onClick={() => void end()}
            type="button"
          >
            {busy === 'stop' ? 'Stopping…' : 'Stop recording'}
          </button>
          <span>{recording?.steps.length ?? 0} captured steps</span>
        </div>
        <p className="technical-note">
          FormCrash records semantic steps and a redacted hybrid trace. Complete
          the normal successful journey in the opened browser before stopping.
        </p>
        <details>
          <summary>Unsupported actions and boundaries</summary>
          <p>
            Live CAPTCHA, third-party payment authorization, browser or OS
            dialogs, closed Shadow DOM, unsupported file uploads, and
            unallowlisted cross-origin frames are not replayed.
          </p>
        </details>
      </section>
      {recording?.warnings.map((warning) => (
        <StateMessage
          key={`${warning.code}-${warning.timestamp}`}
          variant="warning"
        >
          <strong>{warning.code.replaceAll('_', ' ')}</strong> —{' '}
          {warning.message}
        </StateMessage>
      ))}
      {recording?.status === 'completed' ? (
        <section className="panel crm-journey-review">
          <div className="section-heading-row">
            <div>
              <p className="eyebrow">Journey review</p>
              <h3>Inspect before saving</h3>
              <p>
                Readable names and stable locators make later failures easier to
                diagnose.
              </p>
            </div>
            <StatusBadge tone="neutral">{steps.length} steps</StatusBadge>
          </div>
          <label className="crm-journey-name">
            Journey name
            <input
              maxLength={160}
              onChange={(event) => setJourneyName(event.target.value)}
              value={journeyName}
            />
          </label>
          {risks.length > 0 ? (
            <StateMessage variant="warning">
              <strong>Review before saving:</strong>
              <ul>
                {risks.map((risk) => (
                  <li key={risk}>{risk}</li>
                ))}
              </ul>
            </StateMessage>
          ) : null}
          <ol className="crm-step-review-list">
            {steps.map((step, index) => (
              <li className="crm-step-review" key={step.id}>
                <div className="crm-step-review-heading">
                  <span>{String(index + 1).padStart(2, '0')}</span>
                  <StatusBadge tone="neutral">{step.type}</StatusBadge>
                  <button
                    className="button button-destructive button-compact"
                    onClick={() =>
                      setSteps((current) =>
                        current.filter((_, itemIndex) => itemIndex !== index),
                      )
                    }
                    type="button"
                  >
                    Remove
                  </button>
                </div>
                <label>
                  Step name
                  <input
                    onChange={(event) =>
                      updateStep(index, { name: event.target.value })
                    }
                    value={step.name}
                  />
                </label>
                <dl>
                  <div>
                    <dt>Target</dt>
                    <dd>{describeTarget(step)}</dd>
                  </div>
                  <div>
                    <dt>Page</dt>
                    <dd>
                      <code>{safePathname(step.url)}</code>
                    </dd>
                  </div>
                  <div>
                    <dt>Replay locator</dt>
                    <dd>
                      <code>{formatLocator(step.locator)}</code>
                    </dd>
                  </div>
                </dl>
                {step.locator?.strategy === 'css' ? (
                  <StateMessage variant="warning">
                    This CSS locator may become brittle when the target UI
                    changes.
                  </StateMessage>
                ) : null}
                {step.value?.kind === 'safe' ? (
                  <label>
                    Test value
                    <input
                      onChange={(event) =>
                        updateStep(index, {
                          value: { kind: 'safe', value: event.target.value },
                        })
                      }
                      value={step.value.value}
                    />
                  </label>
                ) : null}
                {step.value !== null ? (
                  <label className="inline-check">
                    <input
                      checked={step.sensitive}
                      disabled={step.value.kind === 'sensitive'}
                      onChange={(event) => {
                        if (event.target.checked)
                          updateStep(index, {
                            sensitive: true,
                            value: {
                              kind: 'sensitive',
                              variableName: `FORMCRASH_SECRET_STEP_${index + 1}`,
                            },
                          });
                      }}
                      type="checkbox"
                    />{' '}
                    Treat value as sensitive
                  </label>
                ) : null}
                {step.value?.kind === 'sensitive' ? (
                  <label>
                    Runtime variable name
                    <input
                      onChange={(event) =>
                        updateStep(index, {
                          value: {
                            kind: 'sensitive',
                            variableName: normalizeVariableName(
                              event.target.value,
                            ),
                          },
                        })
                      }
                      pattern="[A-Z][A-Z0-9_]*"
                      required
                      value={step.value.variableName}
                    />
                    <small>
                      The captured value was discarded and must be supplied
                      ephemerally.
                    </small>
                  </label>
                ) : null}
              </li>
            ))}
          </ol>
          <div className="crm-sticky-footer">
            <button
              className="button button-secondary"
              onClick={() => router.push(`/projects/${projectId}/journeys`)}
              type="button"
            >
              Cancel
            </button>
            <button
              className="button button-primary"
              disabled={
                busy !== null ||
                journeyName.trim() === '' ||
                steps.length === 0 ||
                steps.some(
                  (step) =>
                    step.value?.kind === 'sensitive' &&
                    !/^[A-Z][A-Z0-9_]*$/u.test(step.value.variableName),
                )
              }
              onClick={() => void save()}
              type="button"
            >
              {busy === 'save' ? 'Saving…' : 'Save journey'}
            </button>
          </div>
        </section>
      ) : null}
    </main>
  );
}

function formatLocator(locator: ReplayLocator | null): string {
  if (locator === null) return 'Direct navigation';
  if (locator.strategy === 'role')
    return `role=${locator.role}, name=${JSON.stringify(locator.name)}`;
  return `${locator.strategy}=${JSON.stringify(locator.value)}`;
}
function describeTarget(step: RecordedJourneyStep): string {
  return (
    step.fingerprint?.label ??
    step.fingerprint?.accessibleName ??
    step.fingerprint?.name ??
    step.fingerprint?.tagName ??
    'Page'
  );
}
function safePathname(value: string): string {
  try {
    const url = new URL(value);
    return `${url.pathname}${url.search}`;
  } catch {
    return value;
  }
}
function normalizeVariableName(value: string): string {
  return value
    .toUpperCase()
    .replaceAll(/[^A-Z0-9_]/gu, '')
    .replace(/^[^A-Z]+/u, '');
}
function journeyQualityWarnings(
  steps: readonly RecordedJourneyStep[],
): readonly string[] {
  const warnings: string[] = [];
  if (steps.length === 0) warnings.push('The journey has no replayable steps.');
  if (steps.some((step) => step.locator?.strategy === 'css'))
    warnings.push('One or more steps rely on brittle CSS locators.');
  if (!steps.some((step) => step.type === 'click' || step.type === 'submit'))
    warnings.push(
      'No click or submit step can be selected as a Critical Action.',
    );
  return warnings;
}
function messageOf(reason: unknown): string {
  return reason instanceof Error
    ? reason.message
    : 'The recording operation could not be completed.';
}
