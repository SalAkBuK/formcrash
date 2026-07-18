'use client';

import Link from 'next/link';
import { useEffect, useState, type FormEvent } from 'react';
import type {
  AuthCaptureSession,
  PersistedJourney,
  Project,
  ProjectExecutionSettings,
  RecordedJourneyStep,
  RecordingSession,
  ReplayLocator,
  ReplayMode,
  ReplayPacing,
  ReplayResult,
} from '@formcrash/contracts';

import { StatusBadge } from '../../../components/ui/status-badge';
import { FormCrashApiError } from '../../../lib/api-client';
import { formatLocalDateTime, formatCount } from '../../../lib/formatters';
import {
  confirmAuthenticationCapture,
  getProjectSettings,
  startAuthenticationCapture,
} from '../api/external-experiments';
import {
  createProject,
  deleteJourney,
  deleteProject,
  getRecording,
  listJourneys,
  listProjects,
  replayJourney,
  saveJourney,
  startRecording,
  stopRecording,
} from '../api/projects';
import { ExternalExperimentPanel } from './external-experiment-panel';
import { JourneyDetail } from './journey-detail';

export function ProjectJourneyDashboard() {
  const [projects, setProjects] = useState<readonly Project[]>([]);
  const [selected, setSelected] = useState<Project | null>(null);
  const [journeys, setJourneys] = useState<readonly PersistedJourney[]>([]);
  const [selectedJourneyId, setSelectedJourneyId] = useState<string | null>(
    null,
  );
  const [projectDetailsLoading, setProjectDetailsLoading] = useState(false);
  const [recording, setRecording] = useState<RecordingSession | null>(null);
  const [reviewSteps, setReviewSteps] = useState<
    readonly RecordedJourneyStep[]
  >([]);
  const [journeyName, setJourneyName] = useState('');
  const [replayResult, setReplayResult] = useState<ReplayResult | null>(null);
  const [replayMode, setReplayMode] = useState<ReplayMode>('adaptive');
  const [replayPacing, setReplayPacing] = useState<ReplayPacing>('recorded');
  const [executionSettings, setExecutionSettings] =
    useState<ProjectExecutionSettings | null>(null);
  const [replayValues, setReplayValues] = useState<
    Readonly<Record<string, Readonly<Record<string, string>>>>
  >({});
  const [productionReplayConfirmed, setProductionReplayConfirmed] =
    useState(false);
  const [replayAuthenticationRequired, setReplayAuthenticationRequired] =
    useState(false);
  const [replayAuthCapture, setReplayAuthCapture] =
    useState<AuthCaptureSession | null>(null);
  const [replayAuthMessage, setReplayAuthMessage] = useState<string | null>(
    null,
  );
  const [selectedProjectIds, setSelectedProjectIds] = useState<
    ReadonlySet<string>
  >(new Set());
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void refreshProjects();
  }, []);

  useEffect(() => {
    if (selected === null) return;
    setProjectDetailsLoading(true);
    setJourneys([]);
    setSelectedJourneyId(null);
    setExecutionSettings(null);
    setProductionReplayConfirmed(false);
    setReplayAuthenticationRequired(false);
    setReplayAuthCapture(null);
    setReplayAuthMessage(null);
    let active = true;
    void Promise.all([
      listJourneys(selected.id),
      getProjectSettings(selected.id),
    ])
      .then(([nextJourneys, nextSettings]) => {
        if (!active) return;
        setJourneys(nextJourneys);
        setSelectedJourneyId(nextJourneys[0]?.id ?? null);
        setExecutionSettings(nextSettings);
        setReplayValues({});
      })
      .catch((reason: unknown) => {
        if (active) setError(messageOf(reason));
      })
      .finally(() => {
        if (active) setProjectDetailsLoading(false);
      });
    return () => {
      active = false;
    };
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
      setSelectedProjectIds(
        (current) =>
          new Set(
            [...current].filter((id) => items.some((item) => item.id === id)),
          ),
      );
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
    const formElement = event.currentTarget;
    const form = new FormData(formElement);
    try {
      const created = await createProject({
        name: formValue(form, 'name'),
        targetUrl: formValue(form, 'targetUrl'),
        environment: formValue(form, 'environment') as Project['environment'],
        description: formValue(form, 'description'),
      });
      formElement.reset();
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

  async function removeProject(project: Project): Promise<void> {
    if (
      !window.confirm(
        `Delete "${project.name}" and all of its recordings, journeys, experiments, runs, screenshots, and saved authentication? This cannot be undone.`,
      )
    ) {
      return;
    }
    setBusy(`delete-project-${project.id}`);
    setError(null);
    try {
      await deleteProject(project.id, true);
      const remaining = await listProjects();
      setProjects(remaining);
      setSelectedProjectIds((current) => {
        const next = new Set(current);
        next.delete(project.id);
        return next;
      });
      if (selected?.id === project.id) {
        setSelected(remaining[0] ?? null);
        setJourneys([]);
        setRecording(null);
        setReviewSteps([]);
        setReplayResult(null);
        setExecutionSettings(null);
        setReplayValues({});
      }
    } catch (reason: unknown) {
      setError(messageOf(reason));
    } finally {
      setBusy(null);
    }
  }

  async function removeSelectedProjects(): Promise<void> {
    const selectedProjects = projects.filter(
      (project) =>
        project.id !== 'project-sample-checkout' &&
        selectedProjectIds.has(project.id),
    );
    if (selectedProjects.length === 0) return;
    if (
      !window.confirm(
        `Delete ${selectedProjects.length} selected projects and all associated recordings, journeys, experiments, runs, screenshots, and saved authentication? This cannot be undone.`,
      )
    ) {
      return;
    }

    setBusy('delete-projects');
    setError(null);
    const deletedIds = new Set<string>();
    const failures: string[] = [];
    for (const project of selectedProjects) {
      try {
        await deleteProject(project.id, true);
        deletedIds.add(project.id);
      } catch (reason: unknown) {
        failures.push(
          `${project.name} (${project.id.slice(0, 8)}): ${messageOf(reason)}`,
        );
      }
    }

    try {
      const remaining = await listProjects();
      setProjects(remaining);
      setSelectedProjectIds(
        new Set(
          selectedProjects
            .filter((project) => !deletedIds.has(project.id))
            .map((project) => project.id),
        ),
      );
      if (selected !== null && deletedIds.has(selected.id)) {
        setSelected(remaining[0] ?? null);
        setJourneys([]);
        setRecording(null);
        setReviewSteps([]);
        setReplayResult(null);
        setExecutionSettings(null);
        setReplayValues({});
      }
      if (failures.length > 0) {
        setError(
          `${deletedIds.size} deleted. ${failures.length} could not be deleted: ${failures.join('; ')}`,
        );
      }
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
      setSelectedJourneyId(saved.id);
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
    setReplayAuthenticationRequired(false);
    setReplayAuthMessage(null);
    try {
      setReplayResult(
        await replayJourney(
          journey.id,
          nonEmptyValues(replayValues[journey.id] ?? {}),
          selected?.environment !== 'production' || productionReplayConfirmed,
          replayMode,
          replayPacing,
        ),
      );
    } catch (reason: unknown) {
      if (
        reason instanceof FormCrashApiError &&
        reason.code === 'AUTHENTICATION_REQUIRED'
      ) {
        setReplayAuthenticationRequired(true);
        setReplayAuthCapture(null);
        setReplayAuthMessage(reason.message);
      } else {
        setError(messageOf(reason));
      }
    } finally {
      setBusy(null);
    }
  }

  async function beginReplayAuthenticationCapture(): Promise<void> {
    if (selected === null) return;
    setBusy('replay-auth-start');
    setError(null);
    setReplayAuthMessage(null);
    try {
      setReplayAuthCapture(await startAuthenticationCapture(selected.id));
    } catch (reason: unknown) {
      setError(messageOf(reason));
    } finally {
      setBusy(null);
    }
  }

  async function confirmReplayAuthenticationCapture(): Promise<void> {
    if (selected === null || replayAuthCapture === null) return;
    setBusy('replay-auth-confirm');
    setError(null);
    try {
      const completed = await confirmAuthenticationCapture(
        selected.id,
        replayAuthCapture.id,
      );
      setReplayAuthCapture(completed);
      setExecutionSettings(await getProjectSettings(selected.id));
      setReplayAuthenticationRequired(false);
      setReplayAuthMessage(
        'Authentication was recaptured. Replay the journey again when you are ready.',
      );
    } catch (reason: unknown) {
      setError(messageOf(reason));
    } finally {
      setBusy(null);
    }
  }

  async function removeJourney(journey: PersistedJourney): Promise<void> {
    if (
      !window.confirm(
        `Delete "${journey.name}" v${journey.version} and all associated experiment versions, runs, and screenshots? This cannot be undone.`,
      )
    ) {
      return;
    }
    setBusy(`delete-journey-${journey.id}`);
    setError(null);
    try {
      await deleteJourney(journey.id);
      if (selected !== null) {
        const remaining = await listJourneys(selected.id);
        setJourneys(remaining);
        setSelectedJourneyId((current) =>
          current === journey.id
            ? (remaining[0]?.id ?? null)
            : current !== null && remaining.some((item) => item.id === current)
              ? current
              : (remaining[0]?.id ?? null),
        );
      }
      setReplayResult(null);
      setReplayValues((current) =>
        Object.fromEntries(
          Object.entries(current).filter(([id]) => id !== journey.id),
        ),
      );
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

  const deletableProjects = projects.filter(
    (project) => project.id !== 'project-sample-checkout',
  );
  const selectedProjectCount = deletableProjects.filter((project) =>
    selectedProjectIds.has(project.id),
  ).length;
  const allDeletableProjectsSelected =
    deletableProjects.length > 0 &&
    selectedProjectCount === deletableProjects.length;
  const qualityWarnings = journeyQualityWarnings(reviewSteps);

  return (
    <main className="dashboard-shell project-workbench">
      <header className="project-overview-header">
        <div className="project-overview-heading">
          <p className="eyebrow">External projects</p>
          <h1>Project overview</h1>
          <p className="hero-statement">
            Connect a controlled target, record its critical journey, and prove
            how repeated action changes the browser-visible outcome.
          </p>
        </div>
        <div className="project-overview-actions">
          <Link className="button button-secondary" href="/">
            Open Sample Checkout
          </Link>
        </div>
        <p className="safety-notice project-safety-notice">
          <strong>Controlled environments only.</strong> Test applications you
          own or are explicitly authorized to test. Production targets require
          an additional confirmation before replay.
        </p>
      </header>

      {error !== null ? (
        <div className="state-message state-message-error" role="alert">
          {error}
        </div>
      ) : null}

      <section
        className="project-grid project-overview-grid"
        aria-label="Projects"
      >
        <form
          className="panel project-form project-create-panel"
          onSubmit={(event) => void submitProject(event)}
        >
          <div className="project-panel-heading">
            <span className="project-panel-index" aria-hidden="true">
              01
            </span>
            <div>
              <p className="eyebrow">New project</p>
              <h2>Connect a target</h2>
            </div>
          </div>
          <p className="project-panel-description">
            Save the application boundary before recording any browser activity.
          </p>
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
            Environment
            <select defaultValue="production" name="environment" required>
              <option value="local">Local development</option>
              <option value="staging">Staging / disposable test data</option>
              <option value="production">Production / real data</option>
            </select>
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

        <div className="panel project-targets-panel">
          <div className="section-heading-row">
            <div className="project-panel-heading">
              <span className="project-panel-index" aria-hidden="true">
                02
              </span>
              <div>
                <p className="eyebrow">Projects</p>
                <h2>Saved targets</h2>
              </div>
            </div>
            <span className="project-count">
              {formatCount(projects.length, 'target')}
            </span>
          </div>
          {deletableProjects.length > 0 ? (
            <div className="project-bulk-actions">
              <label>
                <input
                  checked={allDeletableProjectsSelected}
                  disabled={busy !== null}
                  onChange={(event) =>
                    setSelectedProjectIds(
                      event.target.checked
                        ? new Set(
                            deletableProjects.map((project) => project.id),
                          )
                        : new Set(),
                    )
                  }
                  type="checkbox"
                />{' '}
                Select all
              </label>
              <button
                className="project-delete-button"
                disabled={busy !== null || selectedProjectCount === 0}
                onClick={() => void removeSelectedProjects()}
                type="button"
              >
                {busy === 'delete-projects'
                  ? 'Deleting selected…'
                  : `Delete selected (${selectedProjectCount})`}
              </button>
            </div>
          ) : null}
          {projects.length === 0 ? (
            <p className="empty-state">No projects yet.</p>
          ) : (
            <div className="project-list">
              {projects.map((project) => (
                <article
                  className={`project-card ${selected?.id === project.id ? 'project-card-selected' : ''}`}
                  key={project.id}
                >
                  {project.id !== 'project-sample-checkout' ? (
                    <label
                      aria-label={`Select ${project.name} ${project.id.slice(0, 8)}`}
                      className="project-checkbox"
                    >
                      <input
                        checked={selectedProjectIds.has(project.id)}
                        disabled={busy !== null}
                        onChange={(event) =>
                          setSelectedProjectIds((current) => {
                            const next = new Set(current);
                            if (event.target.checked) next.add(project.id);
                            else next.delete(project.id);
                            return next;
                          })
                        }
                        type="checkbox"
                      />
                    </label>
                  ) : (
                    <span
                      aria-hidden="true"
                      className="project-checkbox-placeholder"
                    />
                  )}
                  <button
                    className="project-card-select"
                    onClick={() => {
                      setSelected(project);
                      setRecording(null);
                      setReviewSteps([]);
                      setReplayResult(null);
                      setReplayAuthenticationRequired(false);
                      setReplayAuthCapture(null);
                      setReplayAuthMessage(null);
                    }}
                    type="button"
                  >
                    <span className="project-card-heading">
                      <strong>{project.name}</strong>
                      <StatusBadge
                        tone={
                          project.environment === 'production'
                            ? 'warning'
                            : 'neutral'
                        }
                      >
                        {environmentLabel(project.environment)}
                      </StatusBadge>
                    </span>
                    <code>{project.targetUrl}</code>
                    <span className="project-card-description">
                      {project.description ||
                        `Project ${project.id.slice(0, 8)}`}
                    </span>
                  </button>
                  {project.id !== 'project-sample-checkout' ? (
                    <button
                      aria-label={`Delete ${project.name} ${project.id.slice(0, 8)}`}
                      className="project-delete-button"
                      disabled={busy !== null}
                      onClick={() => void removeProject(project)}
                      type="button"
                    >
                      {busy === `delete-project-${project.id}`
                        ? 'Deleting…'
                        : 'Delete'}
                    </button>
                  ) : null}
                </article>
              ))}
            </div>
          )}
        </div>
      </section>

      {selected !== null ? (
        <>
          <section
            className="panel selected-project-overview"
            aria-labelledby="selected-project-title"
          >
            <div className="selected-project-overview-header">
              <div>
                <p className="eyebrow">Selected target</p>
                <p
                  className="selected-project-title"
                  id="selected-project-title"
                >
                  {selected.name}
                </p>
                <code>{selected.targetUrl}</code>
              </div>
              <StatusBadge
                tone={
                  selected.environment === 'production' ? 'warning' : 'neutral'
                }
              >
                {environmentLabel(selected.environment)} environment
              </StatusBadge>
            </div>

            <dl className="selected-project-facts">
              <div>
                <dt>Saved journeys</dt>
                <dd>
                  {projectDetailsLoading
                    ? 'Checking…'
                    : formatCount(journeys.length, 'journey')}
                </dd>
              </div>
              <div>
                <dt>Authentication</dt>
                <dd>{authenticationSummary(executionSettings)}</dd>
              </div>
              <div>
                <dt>Last updated</dt>
                <dd>{formatLocalDateTime(selected.updatedAt)}</dd>
              </div>
            </dl>

            <div className="selected-project-overview-footer">
              <p>
                {selected.description ||
                  'No project description has been saved for this target.'}
              </p>
              <a className="button button-primary" href="#recording-workspace">
                Record a journey
              </a>
            </div>
          </section>

          <section className="panel recording-panel" id="recording-workspace">
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
              {recording?.captureFormat === 'hybrid-v2' ? (
                <span>
                  Hybrid trace: {recording.traceStatus ?? 'capturing'}
                  {recording.traceSummary !== null &&
                  recording.traceSummary !== undefined
                    ? ` · ${recording.traceSummary.interactionCount} interactions · ${recording.traceSummary.eventCount} raw events`
                    : ''}
                </span>
              ) : null}
            </div>
            <p className="technical-note">
              A fresh visible Chromium context opens the target. FormCrash
              records semantic steps plus a redacted hybrid interaction trace.
              Replay verifies recorded control, selection, URL, and ARIA state
              instead of treating a click without an exception as success.
            </p>
            <details className="unsupported-list">
              <summary>Unsupported actions</summary>
              <p>
                CAPTCHA, third-party payment authorization, browser chrome, OS
                dialogs, closed Shadow DOM, and unallowlisted cross-origin
                frames remain unsupported. Drag, iframe, contenteditable, and
                open-shadow activity is retained in the raw trace when it cannot
                be represented by a legacy semantic step.
              </p>
              <p>
                For an application you own, configure the CAPTCHA provider's
                official test key, a staging-only bypass, or an allowlisted test
                account. FormCrash does not solve or evade live challenges.
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
              {qualityWarnings.length > 0 ? (
                <div className="journey-quality-warnings">
                  <strong>Review these journey risks before saving:</strong>
                  <ul>
                    {qualityWarnings.map((warning) => (
                      <li key={warning}>{warning}</li>
                    ))}
                  </ul>
                </div>
              ) : null}
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
                    {locatorRisk(step.locator) !== null ? (
                      <p className="recording-warning">
                        {locatorRisk(step.locator)}
                      </p>
                    ) : null}
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
                          disabled={step.value.kind === 'sensitive'}
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
                      <>
                        <label>
                          Runtime variable name
                          <input
                            maxLength={100}
                            pattern="[A-Z][A-Z0-9_]*"
                            required
                            value={step.value.variableName}
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
                          />
                        </label>
                        <p className="masked-value">
                          The captured value was discarded and cannot be
                          restored. Supply this variable when replaying.
                        </p>
                      </>
                    ) : null}
                  </li>
                ))}
              </ol>
              <button
                className="button button-primary"
                disabled={
                  busy !== null ||
                  journeyName.trim() === '' ||
                  reviewSteps.length === 0 ||
                  reviewSteps.some(
                    (step) =>
                      step.value?.kind === 'sensitive' &&
                      !/^[A-Z][A-Z0-9_]*$/u.test(step.value.variableName),
                  )
                }
                onClick={() => void persistJourney()}
                type="button"
              >
                {busy === 'saving' ? 'Saving…' : 'Save journey'}
              </button>
            </section>
          ) : null}

          <JourneyDetail
            authCapture={replayAuthCapture}
            authMessage={replayAuthMessage}
            authenticationRequired={replayAuthenticationRequired}
            busy={busy}
            executionSettings={executionSettings}
            journeys={journeys}
            loading={projectDetailsLoading}
            onAuthenticationConfirm={() =>
              void confirmReplayAuthenticationCapture()
            }
            onAuthenticationStart={() =>
              void beginReplayAuthenticationCapture()
            }
            onDelete={(journey) => void removeJourney(journey)}
            onProductionConfirmationChange={setProductionReplayConfirmed}
            onReplay={(journey) => void runReplay(journey)}
            onReplayModeChange={setReplayMode}
            onReplayPacingChange={setReplayPacing}
            onRuntimeValueChange={(journeyId, variableName, value) =>
              setReplayValues((current) => ({
                ...current,
                [journeyId]: {
                  ...current[journeyId],
                  [variableName]: value,
                },
              }))
            }
            onSelectionChange={(journeyId) => {
              setSelectedJourneyId(journeyId);
              setReplayResult(null);
              setReplayAuthenticationRequired(false);
              setReplayAuthCapture(null);
              setReplayAuthMessage(null);
            }}
            productionReplayConfirmed={productionReplayConfirmed}
            project={selected}
            replayMode={replayMode}
            replayPacing={replayPacing}
            replayResult={replayResult}
            replayValues={replayValues}
            selectedJourneyId={selectedJourneyId}
          />

          <ExternalExperimentPanel project={selected} journeys={journeys} />
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

function environmentLabel(environment: Project['environment']): string {
  if (environment === 'local') return 'Local';
  if (environment === 'staging') return 'Staging';
  return 'Production';
}

function authenticationSummary(
  settings: ProjectExecutionSettings | null,
): string {
  if (settings === null) return 'Checking…';
  if (settings.authentication.available) return 'Saved state available';
  if (settings.authentication.configured)
    return 'Configured, state unavailable';
  return 'Not configured';
}

function formValue(form: FormData, name: string): string {
  const value = form.get(name);
  return typeof value === 'string' ? value : '';
}

function nonEmptyValues(
  values: Readonly<Record<string, string>>,
): Readonly<Record<string, string>> {
  return Object.fromEntries(
    Object.entries(values).filter(([, value]) => value.trim() !== ''),
  );
}

function locatorRisk(locator: ReplayLocator | null): string | null {
  if (locator?.strategy !== 'css') return null;
  if (
    locator.value.includes('nth-of-type') ||
    locator.value.includes('nth-child')
  ) {
    return 'High-risk locator: this CSS path depends on element order and is likely to break when the page layout changes.';
  }
  return 'Brittle locator: this step uses a generated CSS path because no stable ID, name, label, role, or test attribute was available.';
}

function journeyQualityWarnings(
  steps: readonly RecordedJourneyStep[],
): readonly string[] {
  const warnings = new Set<string>();
  if (!steps.some((step) => step.type === 'click' || step.type === 'submit')) {
    warnings.add(
      'No click or submit step was captured, so this journey cannot be used for an impatient-user experiment.',
    );
  }
  if (steps.some((step) => locatorRisk(step.locator) !== null)) {
    warnings.add(
      'One or more steps use brittle CSS locators. Prefer stable IDs, names, labels, roles, or data-testid attributes in the target application.',
    );
  }
  for (let index = 1; index < steps.length; index += 1) {
    const current = steps[index];
    const previous = steps[index - 1];
    if (
      current?.type === 'navigate' &&
      previous?.type === 'navigate' &&
      current.url === previous.url
    ) {
      warnings.add(
        'Consecutive duplicate navigation steps were detected and should be removed.',
      );
    }
  }
  return [...warnings];
}

function normalizeVariableName(value: string): string {
  const normalized = value
    .toUpperCase()
    .replace(/[^A-Z0-9_]/gu, '_')
    .replace(/^[^A-Z]+/u, '');
  return normalized.slice(0, 100);
}
