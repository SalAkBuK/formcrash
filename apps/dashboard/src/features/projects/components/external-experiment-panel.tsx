'use client';

import {
  useEffect,
  useMemo,
  useState,
  type Dispatch,
  type SetStateAction,
} from 'react';
import type {
  AuthCaptureSession,
  CreateExternalExperimentRequest,
  DiscoveredRequest,
  EphemeralRuntimeValues,
  ExternalAssertion,
  ExternalAssertionType,
  ExternalExperimentVersion,
  ExternalRunDetail,
  HttpHook,
  PersistedJourney,
  Project,
  ProjectExecutionSettings,
  ProjectExecutionSettingsInput,
  RuntimeVariableDeclarationInput,
} from '@formcrash/contracts';

import {
  clearAuthentication,
  confirmAuthenticationCapture,
  createExternalExperiment,
  discoverRequests,
  getProjectSettings,
  listExternalExperiments,
  runExternalExperiment,
  saveProjectSettings,
  startAuthenticationCapture,
} from '../api/external-experiments';

interface Props {
  readonly project: Project;
  readonly journeys: readonly PersistedJourney[];
}

const emptySettings: ProjectExecutionSettingsInput = {
  variables: [],
  beforeRunHook: null,
  afterRunHook: null,
};

export function ExternalExperimentPanel({ project, journeys }: Props) {
  const [settings, setSettings] =
    useState<ProjectExecutionSettingsInput>(emptySettings);
  const [settingsState, setSettingsState] =
    useState<ProjectExecutionSettings | null>(null);
  const [runtimeValues, setRuntimeValues] = useState<EphemeralRuntimeValues>(
    {},
  );
  const [capture, setCapture] = useState<AuthCaptureSession | null>(null);
  const [journeyId, setJourneyId] = useState('');
  const [targetStepId, setTargetStepId] = useState('');
  const [experimentName, setExperimentName] = useState('Impatient submit');
  const [triggerCount, setTriggerCount] = useState<2 | 3>(2);
  const [intervalMs, setIntervalMs] = useState<0 | 100 | 300>(0);
  const [continueAfterTarget, setContinueAfterTarget] = useState(false);
  const [candidates, setCandidates] = useState<readonly DiscoveredRequest[]>(
    [],
  );
  const [candidateIndex, setCandidateIndex] = useState(-1);
  const [assertionType, setAssertionType] = useState<ExternalAssertionType>(
    'network_request_max',
  );
  const [assertionValue, setAssertionValue] = useState('1');
  const [experiments, setExperiments] = useState<
    readonly ExternalExperimentVersion[]
  >([]);
  const [result, setResult] = useState<ExternalRunDetail | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const journey = useMemo(
    () => journeys.find((item) => item.id === journeyId) ?? null,
    [journeyId, journeys],
  );
  const compatibleSteps = useMemo(
    () =>
      journey?.steps.filter(
        (step) => step.type === 'click' || step.type === 'submit',
      ) ?? [],
    [journey],
  );
  const targetStep =
    compatibleSteps.find((step) => step.id === targetStepId) ?? null;

  useEffect(() => {
    setBusy('load-settings');
    setError(null);
    void getProjectSettings(project.id)
      .then((value) => {
        setSettingsState(value);
        setSettings(toSettingsInput(value));
      })
      .catch((reason: unknown) => setError(messageOf(reason)))
      .finally(() => setBusy(null));
  }, [project.id]);

  useEffect(() => {
    const selected = journeys.find((item) => item.id === journeyId);
    if (selected !== undefined) return;
    setJourneyId(journeys[0]?.id ?? '');
  }, [journeyId, journeys]);

  useEffect(() => {
    if (journey === null) {
      setTargetStepId('');
      setExperiments([]);
      return;
    }
    const first = journey.steps.find(
      (step) => step.type === 'click' || step.type === 'submit',
    );
    if (!journey.steps.some((step) => step.id === targetStepId)) {
      setTargetStepId(first?.id ?? '');
    }
    setCandidates([]);
    setCandidateIndex(-1);
    void refreshExperiments(journey.id);
  }, [journey, targetStepId]);

  async function refreshExperiments(selectedJourneyId: string): Promise<void> {
    try {
      setExperiments(await listExternalExperiments(selectedJourneyId));
    } catch (reason: unknown) {
      setError(messageOf(reason));
    }
  }

  async function persistSettings(): Promise<void> {
    setBusy('settings');
    setError(null);
    try {
      const saved = await saveProjectSettings(project.id, settings);
      setSettingsState(saved);
      setSettings(toSettingsInput(saved));
    } catch (reason: unknown) {
      setError(messageOf(reason));
    } finally {
      setBusy(null);
    }
  }

  async function beginAuth(): Promise<void> {
    setBusy('auth-start');
    setError(null);
    try {
      setCapture(await startAuthenticationCapture(project.id));
    } catch (reason: unknown) {
      setError(messageOf(reason));
    } finally {
      setBusy(null);
    }
  }

  async function confirmAuth(): Promise<void> {
    if (capture === null) return;
    setBusy('auth-confirm');
    setError(null);
    try {
      setCapture(await confirmAuthenticationCapture(project.id, capture.id));
      const refreshed = await getProjectSettings(project.id);
      setSettingsState(refreshed);
    } catch (reason: unknown) {
      setError(messageOf(reason));
    } finally {
      setBusy(null);
    }
  }

  async function removeAuth(): Promise<void> {
    setBusy('auth-clear');
    setError(null);
    try {
      setSettingsState(await clearAuthentication(project.id));
      setCapture(null);
    } catch (reason: unknown) {
      setError(messageOf(reason));
    } finally {
      setBusy(null);
    }
  }

  async function discover(): Promise<void> {
    if (journey === null || targetStep === null) return;
    setBusy('discovery');
    setError(null);
    try {
      const discovered = await discoverRequests(
        journey.id,
        targetStep.id,
        runtimeValues,
      );
      setCandidates(discovered.candidates);
      setCandidateIndex(discovered.candidates.length === 0 ? -1 : 0);
    } catch (reason: unknown) {
      setError(messageOf(reason));
    } finally {
      setBusy(null);
    }
  }

  async function saveExperiment(): Promise<void> {
    if (journey === null || targetStep === null) return;
    setBusy('experiment');
    setError(null);
    try {
      const candidate = candidates[candidateIndex] ?? null;
      const assertion = buildAssertion(
        assertionType,
        assertionValue,
        targetStep,
      );
      const input: CreateExternalExperimentRequest = {
        name: experimentName,
        targetStepId: targetStep.id,
        triggerCount,
        intervalMs,
        networkMatcher:
          candidate === null
            ? null
            : {
                method: candidate.method,
                pathname: candidate.pathname,
                host: new URL(candidate.origin).host,
              },
        assertions: [assertion],
        continueAfterTarget,
      };
      await createExternalExperiment(journey.id, input);
      await refreshExperiments(journey.id);
    } catch (reason: unknown) {
      setError(messageOf(reason));
    } finally {
      setBusy(null);
    }
  }

  async function run(version: ExternalExperimentVersion): Promise<void> {
    setBusy(`run-${version.id}`);
    setResult(null);
    setError(null);
    try {
      setResult(await runExternalExperiment(version.id, runtimeValues));
    } catch (reason: unknown) {
      setError(messageOf(reason));
    } finally {
      setBusy(null);
    }
  }

  return (
    <section
      className="external-workbench"
      aria-label="External experiment configuration"
    >
      <div className="panel settings-panel">
        <div className="section-heading-row">
          <div>
            <p className="eyebrow">Project execution settings</p>
            <h2>Authentication and runtime inputs</h2>
          </div>
          <span className="status-badge">
            Auth{' '}
            {settingsState?.authentication.available === true
              ? 'ready'
              : 'not captured'}
          </span>
        </div>
        {error !== null ? (
          <div className="state-message state-message-error" role="alert">
            {error}
          </div>
        ) : null}
        <div className="settings-grid">
          <div className="settings-column">
            <h3>Authentication state</h3>
            <p className="technical-note">
              Launch a visible browser, sign in yourself, then confirm.
              FormCrash stores Playwright state on disk; credentials are never
              entered in this dashboard.
            </p>
            <div className="recording-actions">
              <button
                className="button button-secondary"
                disabled={busy !== null}
                onClick={() => void beginAuth()}
                type="button"
              >
                {busy === 'auth-start'
                  ? 'Launching…'
                  : 'Capture authentication'}
              </button>
              <button
                className="button button-primary"
                disabled={
                  busy !== null || capture?.status !== 'awaiting_confirmation'
                }
                onClick={() => void confirmAuth()}
                type="button"
              >
                {busy === 'auth-confirm'
                  ? 'Saving…'
                  : 'I am signed in — save state'}
              </button>
              <button
                className="copy-button"
                disabled={
                  busy !== null ||
                  settingsState?.authentication.configured !== true
                }
                onClick={() => void removeAuth()}
                type="button"
              >
                Clear
              </button>
            </div>
            {capture !== null ? (
              <p className="technical-note">Capture: {capture.status}</p>
            ) : null}
            {settingsState?.authentication.missingReason !== null &&
            settingsState?.authentication.missingReason !== undefined ? (
              <p className="recording-warning">
                {settingsState.authentication.missingReason}
              </p>
            ) : null}
          </div>
          <div className="settings-column">
            <div className="section-heading-row compact-heading">
              <div>
                <h3>Runtime variables</h3>
                <p>
                  Values come from this run or <code>FORMCRASH_VAR_NAME</code>.
                </p>
              </div>
              <button
                className="copy-button"
                onClick={() =>
                  setSettings((current) => ({
                    ...current,
                    variables: [
                      ...current.variables,
                      newVariable(current.variables.length),
                    ],
                  }))
                }
                type="button"
              >
                Add variable
              </button>
            </div>
            {settings.variables.map((variable, index) => (
              <div className="variable-row" key={`${variable.name}-${index}`}>
                <input
                  aria-label={`Variable ${index + 1} name`}
                  placeholder="CUSTOMER_EMAIL"
                  value={variable.name}
                  onChange={(event) =>
                    updateVariable(setSettings, index, {
                      name: event.target.value.toUpperCase(),
                    })
                  }
                />
                <input
                  aria-label={`${variable.name} template`}
                  placeholder="Optional template, e.g. {{unique.email}}"
                  value={variable.template ?? ''}
                  onChange={(event) =>
                    updateVariable(setSettings, index, {
                      template:
                        event.target.value === '' ? null : event.target.value,
                    })
                  }
                />
                <label className="inline-check">
                  <input
                    checked={variable.secret}
                    onChange={(event) =>
                      updateVariable(setSettings, index, {
                        secret: event.target.checked,
                      })
                    }
                    type="checkbox"
                  />{' '}
                  Secret
                </label>
                <button
                  className="copy-button"
                  onClick={() =>
                    setSettings((current) => ({
                      ...current,
                      variables: current.variables.filter(
                        (_, itemIndex) => itemIndex !== index,
                      ),
                    }))
                  }
                  type="button"
                >
                  Remove
                </button>
              </div>
            ))}
            {settings.variables.length === 0 ? (
              <p className="empty-state">No declared runtime variables.</p>
            ) : null}
          </div>
        </div>
        <div className="settings-grid hook-grid">
          <HookEditor
            label="Before-run hook"
            value={settings.beforeRunHook}
            onChange={(value) =>
              setSettings((current) => ({ ...current, beforeRunHook: value }))
            }
          />
          <HookEditor
            label="After-run cleanup hook"
            value={settings.afterRunHook}
            onChange={(value) =>
              setSettings((current) => ({ ...current, afterRunHook: value }))
            }
          />
        </div>
        <button
          className="button button-primary"
          disabled={busy !== null}
          onClick={() => void persistSettings()}
          type="button"
        >
          {busy === 'settings' ? 'Saving…' : 'Save project settings'}
        </button>
      </div>

      <div className="panel experiment-builder">
        <p className="eyebrow">Create Failure Experiment</p>
        <h2>Repeat one external click or submit</h2>
        {journeys.length === 0 ? (
          <p className="empty-state">
            Save a recorded journey before configuring an experiment.
          </p>
        ) : (
          <div className="builder-grid">
            <label>
              Journey
              <select
                value={journeyId}
                onChange={(event) => setJourneyId(event.target.value)}
              >
                {journeys.map((item) => (
                  <option key={item.id} value={item.id}>
                    {item.name} v{item.version}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Target step
              <select
                value={targetStepId}
                onChange={(event) => setTargetStepId(event.target.value)}
              >
                {journey?.steps.map((step, index) => (
                  <option
                    disabled={step.type !== 'click' && step.type !== 'submit'}
                    key={step.id}
                    value={step.id}
                  >
                    {index + 1}. {step.name} ({step.type})
                    {step.type !== 'click' && step.type !== 'submit'
                      ? ' — incompatible'
                      : ''}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Experiment name
              <input
                value={experimentName}
                onChange={(event) => setExperimentName(event.target.value)}
              />
            </label>
            <label>
              Triggers
              <select
                value={triggerCount}
                onChange={(event) =>
                  setTriggerCount(Number(event.target.value) as 2 | 3)
                }
              >
                <option value={2}>2</option>
                <option value={3}>3</option>
              </select>
            </label>
            <label>
              Interval
              <select
                value={intervalMs}
                onChange={(event) =>
                  setIntervalMs(Number(event.target.value) as 0 | 100 | 300)
                }
              >
                <option value={0}>0 ms</option>
                <option value={100}>100 ms</option>
                <option value={300}>300 ms</option>
              </select>
            </label>
            <label className="inline-check continue-check">
              <input
                checked={continueAfterTarget}
                onChange={(event) =>
                  setContinueAfterTarget(event.target.checked)
                }
                type="checkbox"
              />{' '}
              Continue later journey steps
            </label>
          </div>
        )}
        {journey !== null && compatibleSteps.length === 0 ? (
          <p className="recording-warning">
            This journey has no compatible click or submit step.
          </p>
        ) : null}

        <div className="discovery-box">
          <div className="section-heading-row compact-heading">
            <div>
              <h3>Request discovery</h3>
              <p>
                Replays through the target once and shows method/path evidence
                caused by that action.
              </p>
            </div>
            <button
              className="button button-secondary button-compact"
              disabled={busy !== null || targetStep === null}
              onClick={() => void discover()}
              type="button"
            >
              {busy === 'discovery' ? 'Discovering…' : 'Discover requests'}
            </button>
          </div>
          <label>
            Optional network matcher
            <select
              value={candidateIndex}
              onChange={(event) =>
                setCandidateIndex(Number(event.target.value))
              }
            >
              <option value={-1}>No matcher</option>
              {candidates.map((candidate, index) => (
                <option
                  key={`${candidate.method}-${candidate.origin}-${candidate.pathname}-${index}`}
                  value={index}
                >
                  {candidate.method} {candidate.pathname} —{' '}
                  {candidate.status ?? 'no status'} · {candidate.occurrences}x
                </option>
              ))}
            </select>
          </label>
        </div>

        <div className="assertion-box">
          <h3>Assertion</h3>
          <div className="builder-grid">
            <label>
              Type
              <select
                value={assertionType}
                onChange={(event) => {
                  setAssertionType(event.target.value as ExternalAssertionType);
                  setAssertionValue(
                    defaultAssertionValue(
                      event.target.value as ExternalAssertionType,
                    ),
                  );
                }}
              >
                {assertionOptions.map(([value, label]) => (
                  <option key={value} value={value}>
                    {label}
                  </option>
                ))}
              </select>
            </label>
            <label>
              {assertionLabel(assertionType)}
              <input
                value={assertionValue}
                onChange={(event) => setAssertionValue(event.target.value)}
              />
            </label>
          </div>
          {assertionType.startsWith('element_') &&
          targetStep?.locator === null ? (
            <p className="recording-warning">
              The selected step has no reusable element locator.
            </p>
          ) : null}
        </div>
        <button
          className="button button-primary"
          disabled={
            busy !== null || targetStep === null || experimentName.trim() === ''
          }
          onClick={() => void saveExperiment()}
          type="button"
        >
          {busy === 'experiment'
            ? 'Saving version…'
            : 'Save immutable experiment version'}
        </button>
      </div>

      <div className="panel">
        <p className="eyebrow">Runtime values and versions</p>
        <h2>Run the external experiment</h2>
        {settings.variables.length > 0 ? (
          <div className="runtime-value-grid">
            {settings.variables.map((variable) => (
              <label key={variable.name}>
                {variable.name}
                <input
                  autoComplete="off"
                  placeholder={
                    variable.template === null
                      ? `Optional if ${`FORMCRASH_VAR_${variable.name}`} is set`
                      : 'Template configured'
                  }
                  type={variable.secret ? 'password' : 'text'}
                  value={runtimeValues[variable.name] ?? ''}
                  onChange={(event) =>
                    setRuntimeValues((current) => ({
                      ...current,
                      [variable.name]: event.target.value,
                    }))
                  }
                />
              </label>
            ))}
          </div>
        ) : (
          <p className="technical-note">
            No runtime variables declared. Built-in templates remain available.
          </p>
        )}
        <div className="experiment-version-list">
          {experiments.map((version) => (
            <article className="journey-card" key={version.id}>
              <div>
                <strong>{version.name}</strong>
                <span>
                  Version {version.version} · {version.triggerCount} triggers ·{' '}
                  {version.intervalMs} ms · {version.assertions.length}{' '}
                  assertion(s)
                </span>
              </div>
              <button
                className="button button-secondary button-compact"
                disabled={busy !== null}
                onClick={() => void run(version)}
                type="button"
              >
                {busy === `run-${version.id}` ? 'Running Chromium…' : 'Run'}
              </button>
            </article>
          ))}
          {experiments.length === 0 ? (
            <p className="empty-state">
              No experiment versions for the selected journey.
            </p>
          ) : null}
        </div>
        {result !== null ? <RunResult result={result} /> : null}
      </div>
    </section>
  );
}

function HookEditor({
  label,
  value,
  onChange,
}: {
  readonly label: string;
  readonly value: HttpHook | null;
  readonly onChange: (value: HttpHook | null) => void;
}) {
  const enabled = value !== null;
  const update = (patch: Partial<HttpHook>) =>
    onChange({ ...(value ?? emptyHook()), ...patch });
  return (
    <div className="hook-editor">
      <label className="inline-check">
        <input
          checked={enabled}
          onChange={(event) =>
            onChange(event.target.checked ? emptyHook() : null)
          }
          type="checkbox"
        />{' '}
        {label}
      </label>
      {enabled ? (
        <>
          <div className="hook-line">
            <select
              aria-label={`${label} method`}
              value={value.method}
              onChange={(event) =>
                update({ method: event.target.value as 'POST' | 'DELETE' })
              }
            >
              <option>POST</option>
              <option>DELETE</option>
            </select>
            <input
              aria-label={`${label} URL`}
              placeholder="http://localhost:4300/api/reset/{{run.id}}"
              value={value.url}
              onChange={(event) => update({ url: event.target.value })}
            />
          </div>
          <textarea
            aria-label={`${label} headers`}
            rows={2}
            value={JSON.stringify(value.headers)}
            onChange={(event) => {
              try {
                update({
                  headers: JSON.parse(event.target.value) as Record<
                    string,
                    string
                  >,
                });
              } catch {
                /* Keep the last valid JSON while editing. */
              }
            }}
          />
          <textarea
            aria-label={`${label} body`}
            rows={2}
            value={JSON.stringify(value.body)}
            onChange={(event) => {
              try {
                update({
                  body: JSON.parse(event.target.value) as HttpHook['body'],
                });
              } catch {
                /* Keep the last valid JSON while editing. */
              }
            }}
          />
        </>
      ) : null}
    </div>
  );
}

function RunResult({ result }: { readonly result: ExternalRunDetail }) {
  return (
    <div className={`external-result replay-${result.status}`} role="status">
      <div className="section-heading-row">
        <div>
          <p className="eyebrow">Latest result</p>
          <h3>{result.status.replaceAll('_', ' ')}</h3>
        </div>
        <strong>
          {result.assertions.filter((item) => item.status === 'passed').length}/
          {result.assertions.length} assertions passed
        </strong>
      </div>
      {result.runnerError !== null ? <p>{result.runnerError.message}</p> : null}
      {result.warnings.map((warning) => (
        <p key={warning.code}>{warning.message}</p>
      ))}
      <ul>
        {result.assertions.map((assertion) => (
          <li key={assertion.assertionResultId}>
            <strong>{assertion.status}</strong> — {assertion.description}
            <br />
            <span>{assertion.observedDescription}</span>
          </li>
        ))}
      </ul>
      <p className="technical-note">
        {result.networkObservations.filter((item) => item.matched).length}{' '}
        matched network request(s) · {result.artifacts.length} screenshot
        artifact(s)
      </p>
    </div>
  );
}

function buildAssertion(
  type: ExternalAssertionType,
  value: string,
  targetStep: PersistedJourney['steps'][number],
): ExternalAssertion {
  const base = {
    id: crypto.randomUUID(),
    description: assertionOptions.find(([item]) => item === type)?.[1] ?? type,
  };
  if (type === 'network_request_max' || type === 'network_success_max')
    return { ...base, type, maximum: Number(value) };
  if (type === 'network_expected_status')
    return { ...base, type, expectedStatus: Number(value) };
  if (type === 'text_appeared') return { ...base, type, text: value };
  if (type === 'final_url_contains' || type === 'final_url_not_contains')
    return { ...base, type, value };
  if (
    type === 'element_visible' ||
    type === 'element_not_visible' ||
    type === 'element_disabled'
  ) {
    if (targetStep.locator === null)
      throw new Error('The selected step has no reusable element locator.');
    return {
      ...base,
      type,
      locator: targetStep.locator,
      targetDescription: targetStep.name,
    };
  }
  throw new Error(
    'Field-retained assertions must be configured through the API in this release.',
  );
}

const assertionOptions: readonly (readonly [ExternalAssertionType, string])[] =
  [
    ['network_request_max', 'Network requests do not exceed'],
    ['network_success_max', 'Successful network requests do not exceed'],
    ['network_expected_status', 'Matched request has expected status'],
    ['element_visible', 'Target element is visible'],
    ['element_not_visible', 'Target element is not visible'],
    ['element_disabled', 'Target element is disabled'],
    ['text_appeared', 'Text appeared'],
    ['final_url_contains', 'Final URL contains'],
    ['final_url_not_contains', 'Final URL does not contain'],
  ];

function assertionLabel(type: ExternalAssertionType): string {
  return type.includes('max')
    ? 'Maximum'
    : type === 'network_expected_status'
      ? 'HTTP status'
      : type.startsWith('element_')
        ? 'Uses selected target locator'
        : 'Expected text/value';
}
function defaultAssertionValue(type: ExternalAssertionType): string {
  return type.includes('max')
    ? '1'
    : type === 'network_expected_status'
      ? '200'
      : type.startsWith('element_')
        ? 'Selected target'
        : '';
}
function emptyHook(): HttpHook {
  return { method: 'POST', url: '', headers: {}, body: null, timeoutMs: 5000 };
}
function newVariable(index: number): RuntimeVariableDeclarationInput {
  return {
    name: `VARIABLE_${index + 1}`,
    secret: true,
    description: '',
    template: null,
  };
}
function toSettingsInput(
  value: ProjectExecutionSettings,
): ProjectExecutionSettingsInput {
  return {
    variables: value.variables.map(
      ({ name, secret, description, template }) => ({
        name,
        secret,
        description,
        template,
      }),
    ),
    beforeRunHook: value.beforeRunHook,
    afterRunHook: value.afterRunHook,
  };
}
function updateVariable(
  setter: Dispatch<SetStateAction<ProjectExecutionSettingsInput>>,
  index: number,
  patch: Partial<RuntimeVariableDeclarationInput>,
): void {
  setter((current) => ({
    ...current,
    variables: current.variables.map((variable, itemIndex) =>
      itemIndex === index ? { ...variable, ...patch } : variable,
    ),
  }));
}
function messageOf(reason: unknown): string {
  return reason instanceof Error
    ? reason.message
    : 'The operation could not be completed.';
}
