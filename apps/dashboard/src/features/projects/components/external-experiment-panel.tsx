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
  AuthValidationResult,
  AssertionRecommendation,
  CreateExternalExperimentRequest,
  EphemeralRuntimeValues,
  ExternalAssertion,
  ExternalAssertionType,
  ExternalExperimentVersion,
  ExternalRunDetail,
  ExternalRunSummary,
  HttpHook,
  PersistedJourney,
  Project,
  ProjectExecutionSettings,
  ProjectExecutionSettingsInput,
  RankedRequestCandidate,
  RequestDiscoveryResult,
  ReplayPacing,
  RuntimeVariableDeclarationInput,
} from '@formcrash/contracts';

import {
  clearAuthentication,
  confirmAuthenticationCapture,
  createExternalExperiment,
  deleteExternalExperimentVersion,
  deleteExternalRun,
  discoverRequests,
  getExternalRun,
  getProjectSettings,
  listExternalExperiments,
  listExternalRuns,
  runExternalExperiment,
  saveProjectSettings,
  startAuthenticationCapture,
  testAuthentication,
} from '../api/external-experiments';
import {
  initialCandidateIndex,
  matcherForCandidate,
  selectionProvenance,
} from '../models/request-selection';
import {
  assertionWithEditedValue,
  editableAssertionValue,
  recommendationProvenance,
  recommendationSetForCandidate,
  type RecommendationSelection,
} from '../models/assertion-recommendations';
import { ExternalRunResult } from './external-run-result';
import { ExternalRunComparison } from './external-run-comparison';
import { GuidedTestPanel } from './guided-test-panel';

const noCandidates: readonly RankedRequestCandidate[] = [];

interface Props {
  readonly project: Project;
  readonly journeys: readonly PersistedJourney[];
}

const emptySettings: ProjectExecutionSettingsInput = {
  variables: [],
  beforeRunHook: null,
  afterRunHook: null,
};

interface AssertionDraft {
  readonly key: string;
  readonly type: ExternalAssertionType;
  readonly value: string;
  readonly stepId: string;
  readonly enabled: boolean;
  readonly recommendation: AssertionRecommendation | null;
}

export function ExternalExperimentPanel({ project, journeys }: Props) {
  const [workspaceMode, setWorkspaceMode] = useState<'guided' | 'advanced'>(
    'guided',
  );
  const [settings, setSettings] =
    useState<ProjectExecutionSettingsInput>(emptySettings);
  const [settingsState, setSettingsState] =
    useState<ProjectExecutionSettings | null>(null);
  const [runtimeValues, setRuntimeValues] = useState<EphemeralRuntimeValues>(
    {},
  );
  const [capture, setCapture] = useState<AuthCaptureSession | null>(null);
  const [authValidation, setAuthValidation] =
    useState<AuthValidationResult | null>(null);
  const [journeyId, setJourneyId] = useState('');
  const [targetStepId, setTargetStepId] = useState('');
  const [experimentName, setExperimentName] = useState('Impatient submit');
  const [triggerCount, setTriggerCount] = useState<2 | 3>(2);
  const [intervalMs, setIntervalMs] = useState<0 | 100 | 300>(0);
  const [replayPacing, setReplayPacing] = useState<ReplayPacing>('recorded');
  const [continueAfterTarget, setContinueAfterTarget] = useState(false);
  const [discovery, setDiscovery] = useState<RequestDiscoveryResult | null>(
    null,
  );
  const [candidateIndex, setCandidateIndex] = useState(-1);
  const [assertionDrafts, setAssertionDrafts] = useState<
    readonly AssertionDraft[]
  >([newAssertionDraft()]);
  const [experiments, setExperiments] = useState<
    readonly ExternalExperimentVersion[]
  >([]);
  const [result, setResult] = useState<ExternalRunDetail | null>(null);
  const [runHistory, setRunHistory] = useState<readonly ExternalRunSummary[]>(
    [],
  );
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [productionConfirmed, setProductionConfirmed] = useState(false);

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
  const networkAssertionSelected = assertionDrafts.some(
    (draft) => draft.enabled && draft.type.startsWith('network_'),
  );
  const candidates = discovery?.candidates ?? noCandidates;
  const selectedNetworkCandidate = candidates[candidateIndex] ?? null;
  const networkMatcherMissing =
    networkAssertionSelected && selectedNetworkCandidate === null;

  useEffect(() => {
    if (discovery === null) return;
    const recommendationSet = recommendationSetForCandidate(
      discovery,
      selectedNetworkCandidate,
    );
    setAssertionDrafts((current) => {
      const manual = current.filter((draft) => draft.recommendation === null);
      const retainedManual =
        recommendationSet.recommendations.length > 0 &&
        manual.length === 1 &&
        isPristineManualDraft(manual[0]!)
          ? []
          : manual;
      if (
        recommendationSet.recommendations.length === 0 &&
        retainedManual.length === 0
      ) {
        return [newAssertionDraft(targetStep?.id ?? '')];
      }
      return [
        ...recommendationSet.recommendations.map(recommendationDraft),
        ...retainedManual,
      ];
    });
  }, [
    discovery?.discoveryId,
    selectedNetworkCandidate?.candidateId,
    targetStep?.id,
  ]);

  useEffect(() => {
    setWorkspaceMode('guided');
    setBusy('load-settings');
    setError(null);
    setProductionConfirmed(false);
    setAuthValidation(null);
    void Promise.all([
      getProjectSettings(project.id),
      listExternalRuns(project.id),
    ])
      .then(async ([value, history]) => {
        setSettingsState(value);
        setSettings(toSettingsInput(value));
        setRunHistory(history.items);
        setResult(
          history.items[0] === undefined
            ? null
            : await getExternalRun(history.items[0].runId),
        );
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
    setDiscovery(null);
    setCandidateIndex(-1);
    void refreshExperiments(journey.id);
  }, [journey, targetStepId]);

  useEffect(() => {
    setDiscovery(null);
    setCandidateIndex(-1);
  }, [triggerCount, intervalMs]);

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
      setAuthValidation(null);
    } catch (reason: unknown) {
      setError(messageOf(reason));
    } finally {
      setBusy(null);
    }
  }

  async function validateAuth(): Promise<void> {
    setBusy('auth-test');
    setError(null);
    try {
      setAuthValidation(await testAuthentication(project.id));
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
        project.environment !== 'production' || productionConfirmed,
        {
          recipe: {
            type: 'advanced_repeated_action',
            triggerCount,
            intervalMs,
          },
          normalizeJourney: false,
          stepValueOverrides: {},
        },
      );
      setDiscovery(discovered);
      setCandidateIndex(initialCandidateIndex(discovered));
    } catch (reason: unknown) {
      setError(messageOf(reason));
    } finally {
      setBusy(null);
    }
  }

  async function saveExperiment(): Promise<void> {
    if (journey === null || targetStep === null) return;
    if (networkMatcherMissing) {
      setError(
        'Run request discovery and select the request that this network assertion should measure.',
      );
      return;
    }
    setBusy('experiment');
    setError(null);
    try {
      const candidate = selectedNetworkCandidate;
      const assertions = assertionDrafts
        .filter((draft) => draft.enabled)
        .map((draft) => {
          const assertionStep =
            journey.steps.find((step) => step.id === draft.stepId) ??
            targetStep;
          if (draft.recommendation !== null) {
            const original = draft.recommendation.assertion;
            if (draft.type === original.type) {
              return assertionWithEditedValue(original, draft.value);
            }
            return {
              ...buildAssertion(draft.type, draft.value, assertionStep),
              id: original.id,
            };
          }
          return buildAssertion(draft.type, draft.value, assertionStep);
        });
      const generatedSelections: RecommendationSelection[] = assertionDrafts
        .filter(
          (
            draft,
          ): draft is AssertionDraft & {
            readonly recommendation: AssertionRecommendation;
          } => draft.recommendation !== null,
        )
        .map((draft) => {
          const assertion =
            assertions.find(
              (item) => item.id === draft.recommendation.assertion.id,
            ) ?? draft.recommendation.assertion;
          return {
            recommendation: draft.recommendation,
            assertion,
            enabled: draft.enabled,
          };
        });
      const generatedAssertionIds = new Set(
        generatedSelections.map(
          (selection) => selection.recommendation.assertion.id,
        ),
      );
      const manualAssertions = assertions.filter(
        (assertion) => !generatedAssertionIds.has(assertion.id),
      );
      const input: CreateExternalExperimentRequest = {
        name: experimentName,
        targetStepId: targetStep.id,
        triggerCount,
        intervalMs,
        networkMatcher:
          candidate === null ? null : matcherForCandidate(candidate),
        assertions,
        continueAfterTarget,
        requestSelectionProvenance:
          candidate === null || discovery === null
            ? null
            : selectionProvenance(discovery, candidate),
        assertionSelectionProvenance: [
          ...recommendationProvenance(generatedSelections, manualAssertions),
        ],
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
      const completed = await runExternalExperiment(
        version.id,
        runtimeValues,
        project.environment !== 'production' || productionConfirmed,
        'adaptive',
        replayPacing,
      );
      setResult(completed);
      setRunHistory((await listExternalRuns(project.id)).items);
    } catch (reason: unknown) {
      setError(messageOf(reason));
    } finally {
      setBusy(null);
    }
  }

  async function removeExperimentVersion(
    version: ExternalExperimentVersion,
  ): Promise<void> {
    if (
      !window.confirm(
        `Delete "${version.name}" v${version.version} and its persisted runs and screenshots? This cannot be undone.`,
      )
    ) {
      return;
    }
    setBusy(`delete-version-${version.id}`);
    setError(null);
    try {
      await deleteExternalExperimentVersion(version.id);
      if (journey !== null) await refreshExperiments(journey.id);
      const history = await listExternalRuns(project.id);
      setRunHistory(history.items);
      if (result?.experimentVersionId === version.id) setResult(null);
    } catch (reason: unknown) {
      setError(messageOf(reason));
    } finally {
      setBusy(null);
    }
  }

  async function removeRun(runId: string): Promise<void> {
    if (
      !window.confirm(
        'Delete this external run, its assertion evidence, events, and screenshots? This cannot be undone.',
      )
    ) {
      return;
    }
    setBusy(`delete-run-${runId}`);
    setError(null);
    try {
      await deleteExternalRun(runId);
      const history = await listExternalRuns(project.id);
      setRunHistory(history.items);
      if (result?.runId === runId) {
        setResult(
          history.items[0] === undefined
            ? null
            : await getExternalRun(history.items[0].runId),
        );
      }
    } catch (reason: unknown) {
      setError(messageOf(reason));
    } finally {
      setBusy(null);
    }
  }

  function handleGuidedCompleted(completed: ExternalRunDetail): void {
    setResult(completed);
    void listExternalRuns(project.id)
      .then((history) => setRunHistory(history.items))
      .catch((reason: unknown) => setError(messageOf(reason)));
  }

  function handleGuidedAuthenticationRecaptured(
    refreshed: ProjectExecutionSettings,
  ): void {
    setSettingsState(refreshed);
    setSettings(toSettingsInput(refreshed));
  }

  return (
    <section
      className="external-workbench"
      id="experiment-workspace"
      aria-label="External experiment configuration"
    >
      <div className="panel test-mode-switcher">
        <div>
          <p className="eyebrow">Testing workspace</p>
          <h2>How do you want to test this project?</h2>
          <p>
            Guided Test finds the request and creates sensible checks for you.
            Advanced mode exposes every authentication, runtime, matcher, and
            assertion control.
          </p>
        </div>
        <div
          className="test-mode-options"
          role="tablist"
          aria-label="Test mode"
        >
          <button
            aria-selected={workspaceMode === 'guided'}
            className={`test-mode-option ${
              workspaceMode === 'guided' ? 'test-mode-option-selected' : ''
            }`}
            onClick={() => setWorkspaceMode('guided')}
            role="tab"
            type="button"
          >
            <strong>Guided Test</strong>
            <span>Recommended</span>
          </button>
          <button
            aria-selected={workspaceMode === 'advanced'}
            className={`test-mode-option ${
              workspaceMode === 'advanced' ? 'test-mode-option-selected' : ''
            }`}
            onClick={() => setWorkspaceMode('advanced')}
            role="tab"
            type="button"
          >
            <strong>Advanced</strong>
            <span>Full control</span>
          </button>
        </div>
      </div>

      {error !== null ? (
        <div className="state-message state-message-error" role="alert">
          {error}
        </div>
      ) : null}

      {workspaceMode === 'guided' ? (
        <>
          <GuidedTestPanel
            journeys={journeys}
            onAuthenticationRecaptured={handleGuidedAuthenticationRecaptured}
            onCompleted={handleGuidedCompleted}
            onOpenAdvanced={() => setWorkspaceMode('advanced')}
            project={project}
            settings={settingsState}
          />
          {result !== null ? (
            <ExternalRunComparison beforeRun={result} runs={runHistory} />
          ) : null}
        </>
      ) : (
        <>
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
            {project.environment === 'production' ? (
              <label className="production-confirmation">
                <input
                  checked={productionConfirmed}
                  onChange={(event) =>
                    setProductionConfirmed(event.target.checked)
                  }
                  type="checkbox"
                />{' '}
                I understand that discovery, replay, and repeated triggers can
                create, modify, or delete real production data.
              </label>
            ) : (
              <p className="technical-note">
                Environment: {project.environment}. Use disposable data and a
                cleanup hook whenever the target action changes state.
              </p>
            )}
            <div className="settings-grid">
              <div className="settings-column">
                <h3>Authentication state</h3>
                <p className="technical-note">
                  Launch a visible browser, sign in yourself, then confirm.
                  FormCrash stores Playwright state on disk; credentials are
                  never entered in this dashboard. Saved authentication is
                  restored automatically for new recordings, replays, and
                  experiment runs; it does not appear as a runtime variable.
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
                      busy !== null ||
                      capture?.status !== 'awaiting_confirmation'
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
                  <button
                    className="button button-secondary button-compact"
                    disabled={
                      busy !== null ||
                      settingsState?.authentication.available !== true
                    }
                    onClick={() => void validateAuth()}
                    type="button"
                  >
                    {busy === 'auth-test' ? 'Testing…' : 'Test authentication'}
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
                {authValidation !== null ? (
                  <div
                    className={`auth-validation auth-validation-${authValidation.status}`}
                    role="status"
                  >
                    <strong>
                      {authValidation.status.replaceAll('_', ' ')}
                    </strong>
                    <span>{authValidation.message}</span>
                    {authValidation.currentUrl !== null ? (
                      <code>{authValidation.currentUrl}</code>
                    ) : null}
                  </div>
                ) : null}
              </div>
              <div className="settings-column">
                <div className="section-heading-row compact-heading">
                  <div>
                    <h3>Runtime variables</h3>
                    <p>
                      Values come from this run or{' '}
                      <code>FORMCRASH_VAR_NAME</code>.
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
                  <div
                    className="variable-row"
                    key={`${variable.name}-${index}`}
                  >
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
                            event.target.value === ''
                              ? null
                              : event.target.value,
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
                  setSettings((current) => ({
                    ...current,
                    beforeRunHook: value,
                  }))
                }
              />
              <HookEditor
                label="After-run cleanup hook"
                value={settings.afterRunHook}
                onChange={(value) =>
                  setSettings((current) => ({
                    ...current,
                    afterRunHook: value,
                  }))
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
                        disabled={
                          step.type !== 'click' && step.type !== 'submit'
                        }
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
                <label>
                  Journey pacing
                  <select
                    value={replayPacing}
                    onChange={(event) =>
                      setReplayPacing(event.target.value as ReplayPacing)
                    }
                  >
                    <option value="recorded">Recorded human pauses</option>
                    <option value="deliberate">1 second per normal step</option>
                    <option value="fast">No added pauses</option>
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
                    Replays through the target once and shows method/path
                    evidence. This executes the real action once and may create
                    or modify target data.
                  </p>
                </div>
                <button
                  className="button button-secondary button-compact"
                  disabled={
                    busy !== null ||
                    targetStep === null ||
                    (project.environment === 'production' &&
                      !productionConfirmed)
                  }
                  onClick={() => void discover()}
                  type="button"
                >
                  {busy === 'discovery' ? 'Discovering…' : 'Discover requests'}
                </button>
              </div>
              <label>
                {networkAssertionSelected
                  ? 'Required network matcher'
                  : 'Optional network matcher'}
                <select
                  value={candidateIndex}
                  onChange={(event) =>
                    setCandidateIndex(Number(event.target.value))
                  }
                >
                  <option value={-1}>
                    {networkAssertionSelected
                      ? 'Select a discovered request'
                      : 'No matcher'}
                  </option>
                  {candidates.map((candidate, index) => (
                    <option key={candidate.candidateId} value={index}>
                      {candidate.method} {candidate.pathname} —{' '}
                      {candidate.status ?? 'no status'} ·{' '}
                      {candidate.occurrences}x · score {candidate.score}
                    </option>
                  ))}
                </select>
              </label>
              {discovery !== null ? (
                <p className="technical-note">
                  {discovery.recommendation.explanation}
                </p>
              ) : null}
              {selectedNetworkCandidate !== null ? (
                <div className="technical-note">
                  <strong>
                    Rank {selectedNetworkCandidate.rank} ·{' '}
                    {selectedNetworkCandidate.classification.replaceAll(
                      '_',
                      ' ',
                    )}{' '}
                    · {selectedNetworkCandidate.confidence}
                  </strong>
                  <ul>
                    {selectedNetworkCandidate.reasons.map((reason) => (
                      <li key={reason.code}>
                        {reason.label} ({formatScoreImpact(reason.scoreImpact)})
                      </li>
                    ))}
                  </ul>
                </div>
              ) : null}
              {networkMatcherMissing ? (
                <p className="recording-warning">
                  Network assertions cannot run without a matcher. Discover
                  requests, then select the POST or other request caused by the
                  target action.
                </p>
              ) : null}
            </div>

            <div className="assertion-box">
              <div className="section-heading-row compact-heading">
                <div>
                  <h3>Assertions</h3>
                  <p>Every configured assertion must pass.</p>
                </div>
                <button
                  className="copy-button"
                  disabled={assertionDrafts.length >= 20}
                  onClick={() =>
                    setAssertionDrafts((current) => [
                      ...current,
                      newAssertionDraft(targetStep?.id ?? ''),
                    ])
                  }
                  type="button"
                >
                  Add assertion
                </button>
              </div>
              <div className="assertion-draft-list">
                {assertionDrafts.map((draft, index) => {
                  const needsStep = assertionNeedsStep(draft.type);
                  const fieldOnly = draft.type === 'field_retained';
                  return (
                    <div className="assertion-draft" key={draft.key}>
                      <label>
                        <input
                          checked={draft.enabled}
                          onChange={(event) =>
                            setAssertionDrafts((current) =>
                              current.map((item) =>
                                item.key === draft.key
                                  ? {
                                      ...item,
                                      enabled: event.target.checked,
                                    }
                                  : item,
                              ),
                            )
                          }
                          type="checkbox"
                        />{' '}
                        {draft.recommendation === null
                          ? 'Manually added'
                          : draftMatchesRecommendation(draft)
                            ? 'Generated unchanged'
                            : 'Generated and modified'}
                      </label>
                      {draft.recommendation !== null ? (
                        <p className="technical-note">
                          {draft.recommendation.confidence} confidence ·{' '}
                          {draft.recommendation.explanation}
                        </p>
                      ) : null}
                      <div className="builder-grid">
                        <label>
                          Assertion {index + 1} type
                          <select
                            value={draft.type}
                            onChange={(event) => {
                              const type = event.target
                                .value as ExternalAssertionType;
                              setAssertionDrafts((current) =>
                                current.map((item) =>
                                  item.key === draft.key
                                    ? {
                                        ...item,
                                        type,
                                        value: defaultAssertionValue(type),
                                      }
                                    : item,
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
                        {assertionNeedsValue(draft.type) ? (
                          <label>
                            {assertionLabel(draft.type)}
                            <input
                              value={draft.value}
                              onChange={(event) =>
                                setAssertionDrafts((current) =>
                                  current.map((item) =>
                                    item.key === draft.key
                                      ? { ...item, value: event.target.value }
                                      : item,
                                  ),
                                )
                              }
                            />
                          </label>
                        ) : null}
                        {needsStep ? (
                          <label>
                            Assertion target step
                            <select
                              value={draft.stepId}
                              onChange={(event) =>
                                setAssertionDrafts((current) =>
                                  current.map((item) =>
                                    item.key === draft.key
                                      ? { ...item, stepId: event.target.value }
                                      : item,
                                  ),
                                )
                              }
                            >
                              <option value="">Use experiment target</option>
                              {journey?.steps
                                .filter(
                                  (step) =>
                                    step.locator !== null &&
                                    (!fieldOnly || step.value !== null),
                                )
                                .map((step, stepIndex) => (
                                  <option key={step.id} value={step.id}>
                                    {stepIndex + 1}. {step.name}
                                  </option>
                                ))}
                            </select>
                          </label>
                        ) : null}
                      </div>
                      {draft.recommendation === null &&
                      assertionDrafts.length > 1 ? (
                        <button
                          className="copy-button"
                          onClick={() =>
                            setAssertionDrafts((current) =>
                              current.filter((item) => item.key !== draft.key),
                            )
                          }
                          type="button"
                        >
                          Remove assertion
                        </button>
                      ) : null}
                    </div>
                  );
                })}
              </div>
            </div>
            <button
              className="button button-primary"
              disabled={
                busy !== null ||
                targetStep === null ||
                experimentName.trim() === '' ||
                networkMatcherMissing ||
                !assertionDrafts.some((draft) => draft.enabled) ||
                assertionDrafts.some(
                  (draft) =>
                    draft.enabled &&
                    assertionNeedsValue(draft.type) &&
                    draft.value.trim() === '',
                )
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
                No runtime variables declared. Built-in templates remain
                available.
              </p>
            )}
            <div className="experiment-version-list">
              {experiments.map((version) => (
                <article className="journey-card" key={version.id}>
                  <div>
                    <strong>{version.name}</strong>
                    <span>
                      Version {version.version} · {version.triggerCount}{' '}
                      triggers · {version.intervalMs} ms ·{' '}
                      {version.assertions.length} assertion(s)
                    </span>
                  </div>
                  <div className="journey-card-actions">
                    <button
                      className="button button-secondary button-compact"
                      disabled={
                        busy !== null ||
                        (project.environment === 'production' &&
                          !productionConfirmed)
                      }
                      onClick={() => void run(version)}
                      type="button"
                    >
                      {busy === `run-${version.id}`
                        ? 'Running Chromium…'
                        : 'Run'}
                    </button>
                    <button
                      className="copy-button"
                      disabled={busy !== null}
                      onClick={() => void removeExperimentVersion(version)}
                      type="button"
                    >
                      {busy === `delete-version-${version.id}`
                        ? 'Deleting…'
                        : 'Delete'}
                    </button>
                  </div>
                </article>
              ))}
              {experiments.length === 0 ? (
                <p className="empty-state">
                  No experiment versions for the selected journey.
                </p>
              ) : null}
            </div>
            {result !== null ? (
              <>
                <ExternalRunResult result={result} />
                <ExternalRunComparison beforeRun={result} runs={runHistory} />
              </>
            ) : null}
            <div className="external-run-history">
              <div className="section-heading-row compact-heading">
                <div>
                  <h3>Persisted run history</h3>
                  <p>
                    Results remain available after refreshing the dashboard.
                  </p>
                </div>
              </div>
              {runHistory.length === 0 ? (
                <p className="empty-state">No external experiment runs yet.</p>
              ) : (
                <div className="experiment-version-list">
                  {runHistory.map((runSummary) => (
                    <article className="journey-card" key={runSummary.runId}>
                      <div>
                        <strong>
                          {runSummary.experimentName} — {runSummary.status}
                        </strong>
                        <span>
                          {runSummary.matchedRequestCount} matched request(s) ·{' '}
                          {runSummary.passedAssertionCount}/
                          {runSummary.assertionCount} assertions ·{' '}
                          {runSummary.screenshotCount} screenshots
                        </span>
                      </div>
                      <div className="journey-card-actions">
                        <button
                          className="button button-secondary button-compact"
                          disabled={busy !== null}
                          onClick={() => {
                            setBusy(`history-${runSummary.runId}`);
                            setError(null);
                            void getExternalRun(runSummary.runId)
                              .then(setResult)
                              .catch((reason: unknown) =>
                                setError(messageOf(reason)),
                              )
                              .finally(() => setBusy(null));
                          }}
                          type="button"
                        >
                          {busy === `history-${runSummary.runId}`
                            ? 'Loading…'
                            : 'View result'}
                        </button>
                        <button
                          className="copy-button"
                          disabled={busy !== null}
                          onClick={() => void removeRun(runSummary.runId)}
                          type="button"
                        >
                          {busy === `delete-run-${runSummary.runId}`
                            ? 'Deleting…'
                            : 'Delete'}
                        </button>
                      </div>
                    </article>
                  ))}
                </div>
              )}
            </div>
          </div>
        </>
      )}
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
  if (type === 'network_request_exact' || type === 'network_success_exact')
    return { ...base, type, expected: Number(value) };
  if (type === 'network_expected_status')
    return { ...base, type, expectedStatus: Number(value) };
  if (type === 'network_all_status') {
    return {
      ...base,
      type,
      allowedStatuses: value
        .split(',')
        .map((item) => Number(item.trim()))
        .filter((item) => Number.isInteger(item)),
    };
  }
  if (type === 'network_no_server_errors') return { ...base, type };
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
  if (targetStep.locator === null || targetStep.value === null) {
    throw new Error(
      'Field-retained assertions require a recorded field step with a locator and value.',
    );
  }
  return {
    ...base,
    type: 'field_retained',
    locator: targetStep.locator,
    targetDescription: targetStep.name,
    expectedValue: targetStep.value,
  };
}

const assertionOptions: readonly (readonly [ExternalAssertionType, string])[] =
  [
    ['network_request_max', 'Network requests do not exceed'],
    ['network_request_exact', 'Network request count equals'],
    ['network_success_max', 'Successful network requests do not exceed'],
    ['network_success_exact', 'Successful response count equals'],
    ['network_expected_status', 'At least one response has status'],
    ['network_all_status', 'Every response has an allowed status'],
    ['network_no_server_errors', 'No response returns HTTP 5xx'],
    ['element_visible', 'Target element is visible'],
    ['element_not_visible', 'Target element is not visible'],
    ['element_disabled', 'Target element is disabled'],
    ['text_appeared', 'Text appeared'],
    ['field_retained', 'Recorded field retained its value'],
    ['final_url_contains', 'Final URL contains'],
    ['final_url_not_contains', 'Final URL does not contain'],
  ];

function assertionLabel(type: ExternalAssertionType): string {
  return type.includes('max')
    ? 'Maximum'
    : type.includes('exact')
      ? 'Exact count'
      : type === 'network_all_status'
        ? 'Allowed HTTP statuses (comma-separated)'
        : type === 'network_expected_status'
          ? 'HTTP status'
          : type.startsWith('element_')
            ? 'Uses selected target locator'
            : 'Expected text/value';
}
function defaultAssertionValue(type: ExternalAssertionType): string {
  return type.includes('max') || type.includes('exact')
    ? '1'
    : type === 'network_all_status'
      ? '200, 201, 204'
      : type === 'network_expected_status'
        ? '200'
        : type.startsWith('element_')
          ? 'Selected target'
          : '';
}
function assertionNeedsValue(type: ExternalAssertionType): boolean {
  return ![
    'network_no_server_errors',
    'element_visible',
    'element_not_visible',
    'element_disabled',
    'field_retained',
  ].includes(type);
}
function assertionNeedsStep(type: ExternalAssertionType): boolean {
  return type.startsWith('element_') || type === 'field_retained';
}
function newAssertionDraft(stepId = ''): AssertionDraft {
  return {
    key: crypto.randomUUID(),
    type: 'network_request_max',
    value: '1',
    stepId,
    enabled: true,
    recommendation: null,
  };
}

function recommendationDraft(
  recommendation: AssertionRecommendation,
): AssertionDraft {
  return {
    key: recommendation.recommendationId,
    type: recommendation.assertion.type,
    value: editableAssertionValue(recommendation.assertion),
    stepId: '',
    enabled: recommendation.defaultEnabled,
    recommendation,
  };
}

function draftMatchesRecommendation(draft: AssertionDraft): boolean {
  if (draft.recommendation === null) return false;
  return (
    draft.type === draft.recommendation.assertion.type &&
    draft.value === editableAssertionValue(draft.recommendation.assertion)
  );
}

function isPristineManualDraft(draft: AssertionDraft): boolean {
  return (
    draft.recommendation === null &&
    draft.enabled &&
    draft.type === 'network_request_max' &&
    draft.value === '1' &&
    draft.stepId === ''
  );
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
function formatScoreImpact(value: number): string {
  return value > 0 ? `+${value}` : String(value);
}
function messageOf(reason: unknown): string {
  return reason instanceof Error
    ? reason.message
    : 'The operation could not be completed.';
}
