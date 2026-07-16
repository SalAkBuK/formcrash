'use client';

import Link from 'next/link';
import { useEffect, useState, type FormEvent } from 'react';
import type {
  PersistedJourney,
  Project,
  ProjectExecutionSettings,
  RecordedJourneyStep,
  RecordingSession,
  ReplayLocator,
  ReplayResult,
} from '@formcrash/contracts';

import { getProjectSettings } from '../api/external-experiments';
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
import { journeyRuntimeRequirements } from '../models/journey-runtime';

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
  const [executionSettings, setExecutionSettings] =
    useState<ProjectExecutionSettings | null>(null);
  const [replayValues, setReplayValues] = useState<
    Readonly<Record<string, Readonly<Record<string, string>>>>
  >({});
  const [productionReplayConfirmed, setProductionReplayConfirmed] =
    useState(false);
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
    setProductionReplayConfirmed(false);
    void Promise.all([
      listJourneys(selected.id),
      getProjectSettings(selected.id),
    ])
      .then(([nextJourneys, nextSettings]) => {
        setJourneys(nextJourneys);
        setExecutionSettings(nextSettings);
        setReplayValues({});
      })
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
      setReplayResult(
        await replayJourney(
          journey.id,
          nonEmptyValues(replayValues[journey.id] ?? {}),
          selected?.environment !== 'production' || productionReplayConfirmed,
        ),
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
      if (selected !== null) setJourneys(await listJourneys(selected.id));
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
        <div className="workflow-actions">
          <Link className="button button-secondary" href="/">
            Run Bundled Sample
          </Link>
        </div>
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

        <div className="panel">
          <div className="section-heading-row">
            <div>
              <p className="eyebrow">Projects</p>
              <h2>Saved targets</h2>
            </div>
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
                    }}
                    type="button"
                  >
                    <strong>{project.name}</strong>
                    <span>
                      {project.targetUrl} · {project.environment} ·{' '}
                      {project.id.slice(0, 8)}
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

          <ExternalExperimentPanel project={selected} journeys={journeys} />

          <section className="panel saved-journeys">
            <div className="section-heading-row">
              <div>
                <p className="eyebrow">Saved journeys</p>
                <h2>Reproducible normal paths</h2>
              </div>
            </div>
            {selected.environment === 'production' ? (
              <label className="production-confirmation">
                <input
                  checked={productionReplayConfirmed}
                  onChange={(event) =>
                    setProductionReplayConfirmed(event.target.checked)
                  }
                  type="checkbox"
                />{' '}
                I understand that replay can submit forms and change real
                production data.
              </label>
            ) : null}
            {replayResult !== null ? (
              <div
                className={`replay-result replay-${replayResult.status}`}
                role="status"
              >
                <strong>Replay {replayResult.status}</strong>
                {replayResult.failedStep === null
                  ? ' — every persisted step completed.'
                  : ` — step ${replayResult.failedStep.stepNumber}, “${replayResult.failedStep.stepName}”, failed.`}
                {replayResult.failedStep?.technicalMessage !== null &&
                replayResult.failedStep?.technicalMessage !== undefined ? (
                  <p>{replayResult.failedStep.technicalMessage}</p>
                ) : null}
                {replayResult.failedStep !== null ? (
                  <dl className="replay-diagnostics">
                    <div>
                      <dt>Locator</dt>
                      <dd>
                        <code>
                          {formatLocator(replayResult.failedStep.locator)}
                        </code>
                      </dd>
                    </div>
                    <div>
                      <dt>Browser URL</dt>
                      <dd>
                        <code>
                          {replayResult.failedStep.currentUrl ?? 'Unavailable'}
                        </code>
                      </dd>
                    </div>
                  </dl>
                ) : null}
              </div>
            ) : null}
            {journeys.length === 0 ? (
              <p className="empty-state">
                No recorded journeys saved for this project.
              </p>
            ) : (
              <div className="journey-list">
                {journeys.map((journey) => {
                  const requirements = journeyRuntimeRequirements(
                    journey,
                    executionSettings,
                  );
                  return (
                    <article className="journey-card" key={journey.id}>
                      <div>
                        <strong>{journey.name}</strong>
                        <span>
                          Version {journey.version} · {journey.steps.length}{' '}
                          steps
                        </span>
                        {requirements.length > 0 ? (
                          <div className="runtime-value-grid replay-runtime-grid">
                            {requirements.map((requirement) => (
                              <label key={requirement.name}>
                                {requirement.label}
                                <input
                                  aria-label={`${journey.name} ${requirement.name}`}
                                  autoComplete="off"
                                  placeholder={requirement.name}
                                  type={
                                    requirement.secret ? 'password' : 'text'
                                  }
                                  value={
                                    replayValues[journey.id]?.[
                                      requirement.name
                                    ] ?? ''
                                  }
                                  onChange={(event) =>
                                    setReplayValues((current) => ({
                                      ...current,
                                      [journey.id]: {
                                        ...current[journey.id],
                                        [requirement.name]: event.target.value,
                                      },
                                    }))
                                  }
                                />
                              </label>
                            ))}
                          </div>
                        ) : (
                          <span>No runtime values required.</span>
                        )}
                      </div>
                      <div className="journey-card-actions">
                        <button
                          className="button button-secondary button-compact"
                          disabled={
                            busy !== null ||
                            (selected.environment === 'production' &&
                              !productionReplayConfirmed) ||
                            requirements.some(
                              (requirement) =>
                                (
                                  replayValues[journey.id]?.[
                                    requirement.name
                                  ] ?? ''
                                ).trim() === '',
                            )
                          }
                          onClick={() => void runReplay(journey)}
                          type="button"
                        >
                          {busy === `replay-${journey.id}`
                            ? 'Replaying…'
                            : 'Replay'}
                        </button>
                        <button
                          className="copy-button"
                          disabled={busy !== null}
                          onClick={() => void removeJourney(journey)}
                          type="button"
                        >
                          {busy === `delete-journey-${journey.id}`
                            ? 'Deleting…'
                            : 'Delete'}
                        </button>
                      </div>
                    </article>
                  );
                })}
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
