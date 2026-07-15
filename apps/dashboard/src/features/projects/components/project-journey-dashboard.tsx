'use client';

import { useEffect, useState, type FormEvent } from 'react';
import type {
  PersistedJourney,
  Project,
  RecordedJourneyStep,
  RecordingSession,
  ReplayLocator,
  ReplayResult,
} from '@formcrash/contracts';

import {
  createProject,
  getRecording,
  listJourneys,
  listProjects,
  replayJourney,
  saveJourney,
  startRecording,
  stopRecording,
} from '../api/projects';
import { ExternalExperimentPanel } from './external-experiment-panel';

export function ProjectJourneyDashboard() {
  const [projects, setProjects] = useState<readonly Project[]>([]);
  const [selected, setSelected] = useState<Project | null>(null);
  const [journeys, setJourneys] = useState<readonly PersistedJourney[]>([]);
  const [recording, setRecording] = useState<RecordingSession | null>(null);
  const [reviewSteps, setReviewSteps] = useState<
    readonly RecordedJourneyStep[]
  >([]);
  const [journeyName, setJourneyName] = useState('');
  const [replayResult, setReplayResult] = useState<ReplayResult | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void refreshProjects();
  }, []);

  useEffect(() => {
    if (selected === null) return;
    void listJourneys(selected.id)
      .then(setJourneys)
      .catch((reason: unknown) => setError(messageOf(reason)));
  }, [selected]);

  useEffect(() => {
    if (recording?.status !== 'recording' || selected === null) return;
    const timer = window.setInterval(() => {
      void getRecording(selected.id, recording.id)
        .then((next) => {
          setRecording(next);
          setReviewSteps(next.steps);
        })
        .catch((reason: unknown) => setError(messageOf(reason)));
    }, 750);
    return () => window.clearInterval(timer);
  }, [recording?.id, recording?.status, selected]);

  async function refreshProjects(): Promise<void> {
    try {
      const items = await listProjects();
      setProjects(items);
      setSelected((current) =>
        current === null
          ? (items[0] ?? null)
          : (items.find((item) => item.id === current.id) ?? items[0] ?? null),
      );
    } catch (reason: unknown) {
      setError(messageOf(reason));
    }
  }

  async function submitProject(
    event: FormEvent<HTMLFormElement>,
  ): Promise<void> {
    event.preventDefault();
    setBusy('project');
    setError(null);
    const form = new FormData(event.currentTarget);
    try {
      const created = await createProject({
        name: formValue(form, 'name'),
        targetUrl: formValue(form, 'targetUrl'),
        description: formValue(form, 'description'),
      });
      event.currentTarget.reset();
      await refreshProjects();
      setSelected(created);
      setRecording(null);
      setReviewSteps([]);
    } catch (reason: unknown) {
      setError(messageOf(reason));
    } finally {
      setBusy(null);
    }
  }

  async function beginRecording(): Promise<void> {
    if (selected === null) return;
    setBusy('recording');
    setError(null);
    setReplayResult(null);
    try {
      const session = await startRecording(selected.id);
      setRecording(session);
      setReviewSteps(session.steps);
      if (session.status === 'runner_error') setError(session.errorMessage);
    } catch (reason: unknown) {
      setError(messageOf(reason));
    } finally {
      setBusy(null);
    }
  }

  async function endRecording(): Promise<void> {
    if (selected === null || recording === null) return;
    setBusy('stopping');
    setError(null);
    try {
      const session = await stopRecording(selected.id, recording.id);
      setRecording(session);
      setReviewSteps(session.steps);
      if (journeyName === '') setJourneyName(`${selected.name} journey`);
      if (session.status === 'runner_error') setError(session.errorMessage);
    } catch (reason: unknown) {
      setError(messageOf(reason));
    } finally {
      setBusy(null);
    }
  }

  async function persistJourney(): Promise<void> {
    if (selected === null || recording === null) return;
    setBusy('saving');
    setError(null);
    try {
      const saved = await saveJourney(
        selected.id,
        recording.id,
        journeyName,
        reviewSteps,
      );
      setJourneys(await listJourneys(selected.id));
      setJourneyName(saved.name);
    } catch (reason: unknown) {
      setError(messageOf(reason));
    } finally {
      setBusy(null);
    }
  }

  async function runReplay(journey: PersistedJourney): Promise<void> {
    setBusy(`replay-${journey.id}`);
    setError(null);
    setReplayResult(null);
    try {
      setReplayResult(await replayJourney(journey.id));
    } catch (reason: unknown) {
      setError(messageOf(reason));
    } finally {
      setBusy(null);
    }
  }

  function updateStep(
    index: number,
    patch: Partial<RecordedJourneyStep>,
  ): void {
    setReviewSteps((current) =>
      current.map((step, stepIndex) =>
        stepIndex === index ? { ...step, ...patch } : step,
      ),
    );
  }

  return (
    <main className="dashboard-shell project-workbench">
      <header className="hero project-hero">
        <p className="eyebrow">Chunk 6 · External impatient-user experiments</p>
        <h1>Crash-test your own controlled app.</h1>
        <p className="hero-statement">
          Capture an authenticated normal journey, inject runtime data safely,
          then repeat one real click or submit and preserve the evidence.
        </p>
        <p className="safety-notice">
          <strong>Controlled environments only.</strong> Test only applications
          you own or are explicitly authorized to test. Localhost and controlled
          HTTP/HTTPS targets are permitted.
        </p>
      </header>

      {error !== null ? (
        <div className="state-message state-message-error" role="alert">
          {error}
        </div>
      ) : null}

      <section className="project-grid" aria-label="Projects">
        <form
          className="panel project-form"
          onSubmit={(event) => void submitProject(event)}
        >
          <p className="eyebrow">New project</p>
          <h2>Connect a target</h2>
          <label>
            Project name
            <input
              name="name"
              required
              maxLength={120}
              placeholder="Account settings"
            />
          </label>
          <label>
            Target URL
            <input
              name="targetUrl"
              required
              type="url"
              placeholder="http://localhost:4300"
            />
          </label>
          <label>
            Description <span>(optional)</span>
            <textarea name="description" maxLength={1000} rows={3} />
          </label>
          <button
            className="button button-primary"
            disabled={busy !== null}
            type="submit"
          >
            {busy === 'project' ? 'Creating…' : 'Create project'}
          </button>
        </form>

        <div className="panel">
          <div className="section-heading-row">
            <div>
              <p className="eyebrow">Projects</p>
              <h2>Saved targets</h2>
            </div>
          </div>
          {projects.length === 0 ? (
            <p className="empty-state">No projects yet.</p>
          ) : (
            <div className="project-list">
              {projects.map((project) => (
                <button
                  className={`project-card ${selected?.id === project.id ? 'project-card-selected' : ''}`}
                  key={project.id}
                  onClick={() => {
                    setSelected(project);
                    setRecording(null);
                    setReviewSteps([]);
                    setReplayResult(null);
                  }}
                  type="button"
                >
                  <strong>{project.name}</strong>
                  <span>{project.targetUrl}</span>
                </button>
              ))}
            </div>
          )}
        </div>
      </section>

      {selected !== null ? (
        <>
          <section className="panel recording-panel">
            <div className="section-heading-row">
              <div>
                <p className="eyebrow">Recording</p>
                <h2>{selected.name}</h2>
                <p>{selected.targetUrl}</p>
              </div>
              <span
                className={`status-badge status-${recording?.status ?? 'created'}`}
              >
                {recording?.status ?? 'ready'}
              </span>
            </div>
            <div className="recording-actions">
              <button
                className="button button-primary"
                disabled={busy !== null || recording?.status === 'recording'}
                onClick={() => void beginRecording()}
                type="button"
              >
                {busy === 'recording'
                  ? 'Launching Chromium…'
                  : 'Start recording'}
              </button>
              <button
                className="button button-secondary"
                disabled={busy !== null || recording?.status !== 'recording'}
                onClick={() => void endRecording()}
                type="button"
              >
                {busy === 'stopping' ? 'Stopping…' : 'Stop recording'}
              </button>
              <span>{recording?.steps.length ?? 0} captured steps</span>
            </div>
            <p className="technical-note">
              A fresh visible Chromium context opens the target. FormCrash
              captures only same-tab, top-frame actions; the dashboard never
              records browser events itself.
            </p>
            <details className="unsupported-list">
              <summary>Unsupported actions</summary>
              <p>
                New tabs, iframes, file uploads, CAPTCHA, third-party payment
                pages, drag and drop, contenteditable editors, and unsupported
                Shadow DOM targets are reported as warnings and not recorded.
              </p>
            </details>
            {recording?.warnings.map((warning) => (
              <div
                className="recording-warning"
                key={`${warning.code}-${warning.timestamp}`}
              >
                <strong>{warning.code.replaceAll('_', ' ')}</strong> —{' '}
                {warning.message}
              </div>
            ))}
          </section>

          {recording?.status === 'completed' ? (
            <section className="panel journey-review">
              <div className="section-heading-row">
                <div>
                  <p className="eyebrow">Journey review</p>
                  <h2>Inspect before saving</h2>
                </div>
                <span className="event-count">{reviewSteps.length} steps</span>
              </div>
              <label className="journey-name">
                Journey name
                <input
                  value={journeyName}
                  onChange={(event) => setJourneyName(event.target.value)}
                  maxLength={160}
                />
              </label>
              <ol className="step-review-list">
                {reviewSteps.map((step, index) => (
                  <li className="step-review-card" key={step.id}>
                    <div className="step-review-heading">
                      <span className="step-number">{index + 1}</span>
                      <strong>{step.type}</strong>
                      <button
                        className="copy-button"
                        onClick={() =>
                          setReviewSteps((current) =>
                            current.filter(
                              (_, itemIndex) => itemIndex !== index,
                            ),
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
                        value={step.name}
                        onChange={(event) =>
                          updateStep(index, { name: event.target.value })
                        }
                      />
                    </label>
                    <dl>
                      <div>
                        <dt>Target</dt>
                        <dd>{describeTarget(step)}</dd>
                      </div>
                      <div>
                        <dt>URL</dt>
                        <dd>
                          <code>{step.url}</code>
                        </dd>
                      </div>
                      <div>
                        <dt>Replay locator</dt>
                        <dd>
                          <code>{formatLocator(step.locator)}</code>
                        </dd>
                      </div>
                    </dl>
                    {step.value?.kind === 'safe' ? (
                      <label>
                        Test value
                        <input
                          value={step.value.value}
                          onChange={(event) =>
                            updateStep(index, {
                              value: {
                                kind: 'safe',
                                value: event.target.value,
                              },
                            })
                          }
                        />
                      </label>
                    ) : null}
                    {step.value !== null ? (
                      <label className="sensitive-toggle">
                        <input
                          checked={step.sensitive}
                          onChange={(event) =>
                            updateStep(
                              index,
                              event.target.checked
                                ? {
                                    sensitive: true,
                                    value: {
                                      kind: 'sensitive',
                                      variableName: `FORMCRASH_SECRET_STEP_${index + 1}`,
                                    },
                                  }
                                : step.value?.kind === 'safe'
                                  ? { sensitive: false }
                                  : {},
                            )
                          }
                          type="checkbox"
                        />{' '}
                        Treat value as sensitive
                      </label>
                    ) : null}
                    {step.value?.kind === 'sensitive' ? (
                      <p className="masked-value">
                        Masked · runtime variable{' '}
                        <code>{step.value.variableName}</code>
                      </p>
                    ) : null}
                  </li>
                ))}
              </ol>
              <button
                className="button button-primary"
                disabled={
                  busy !== null ||
                  journeyName.trim() === '' ||
                  reviewSteps.length === 0
                }
                onClick={() => void persistJourney()}
                type="button"
              >
                {busy === 'saving' ? 'Saving…' : 'Save journey'}
              </button>
            </section>
          ) : null}

          <ExternalExperimentPanel project={selected} journeys={journeys} />

          <section className="panel saved-journeys">
            <div className="section-heading-row">
              <div>
                <p className="eyebrow">Saved journeys</p>
                <h2>Reproducible normal paths</h2>
              </div>
            </div>
            {replayResult !== null ? (
              <div
                className={`replay-result replay-${replayResult.status}`}
                role="status"
              >
                <strong>Replay {replayResult.status}</strong>
                {replayResult.failedStep === null
                  ? ' — every persisted step completed.'
                  : ` — step ${replayResult.failedStep.stepNumber}, “${replayResult.failedStep.stepName}”, failed.`}
              </div>
            ) : null}
            {journeys.length === 0 ? (
              <p className="empty-state">
                No recorded journeys saved for this project.
              </p>
            ) : (
              <div className="journey-list">
                {journeys.map((journey) => (
                  <article className="journey-card" key={journey.id}>
                    <div>
                      <strong>{journey.name}</strong>
                      <span>
                        Version {journey.version} · {journey.steps.length} steps
                      </span>
                    </div>
                    <button
                      className="button button-secondary button-compact"
                      disabled={busy !== null}
                      onClick={() => void runReplay(journey)}
                      type="button"
                    >
                      {busy === `replay-${journey.id}`
                        ? 'Replaying…'
                        : 'Replay'}
                    </button>
                  </article>
                ))}
              </div>
            )}
          </section>
        </>
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

function messageOf(reason: unknown): string {
  return reason instanceof Error
    ? reason.message
    : 'The operation could not be completed.';
}

function formValue(form: FormData, name: string): string {
  const value = form.get(name);
  return typeof value === 'string' ? value : '';
}
