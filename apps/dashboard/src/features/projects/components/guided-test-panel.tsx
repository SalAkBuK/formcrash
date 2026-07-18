'use client';

import { useEffect, useMemo, useState } from 'react';
import type {
  AuthCaptureSession,
  CreateExternalExperimentRequest,
  EphemeralRuntimeValues,
  ExternalRunDetail,
  PersistedJourney,
  Project,
  ProjectExecutionSettings,
  RankedRequestCandidate,
  RecordedJourneyStep,
  RequestDiscoveryResult,
  ReplayPacing,
} from '@formcrash/contracts';

import {
  createExternalExperiment,
  discoverRequests,
  runExternalExperiment,
  confirmAuthenticationCapture,
  getProjectSettings,
  startAuthenticationCapture,
} from '../api/external-experiments';
import { FormCrashApiError } from '../../../lib/api-client';
import {
  guidedRecipe,
  guidedRecipes,
  type GuidedRecipeId,
} from '../models/guided-recipes';
import {
  assertionSupportsValueEdit,
  assertionWithEditedValue,
  editableAssertionValue,
  recommendationProvenance,
  recommendationSelections,
  recommendationSetForCandidate,
  selectedAssertions,
  type RecommendationSelection,
} from '../models/assertion-recommendations';
import { guidedStepValueOverrides } from '../models/guided-values';
import { assessJourneyReadiness } from '../models/journey-readiness';
import { journeyRuntimeRequirements } from '../models/journey-runtime';
import {
  initialCandidateIndex,
  matcherForCandidate,
  selectionProvenance,
} from '../models/request-selection';
import { ExternalRunResult } from './external-run-result';

const noCandidates: readonly RankedRequestCandidate[] = [];

type SafeValueMode =
  | 'recorded'
  | 'unique_text'
  | 'uuid'
  | 'unique_name'
  | 'unique_email'
  | 'unique_phone'
  | 'custom';

const generatedTemplateByMode: Readonly<
  Partial<Record<SafeValueMode, string>>
> = {
  unique_text: '{{unique.text}}',
  uuid: '{{run.id}}',
  unique_name: '{{unique.name}}',
  unique_email: '{{unique.email}}',
  unique_phone: '{{unique.phone}}',
};

interface Props {
  readonly project: Project;
  readonly journeys: readonly PersistedJourney[];
  readonly settings: ProjectExecutionSettings | null;
  readonly onOpenAdvanced: () => void;
  readonly onCompleted: (result: ExternalRunDetail) => void;
  readonly onAuthenticationRecaptured: (
    settings: ProjectExecutionSettings,
  ) => void;
}

export function GuidedTestPanel({
  project,
  journeys,
  settings,
  onOpenAdvanced,
  onCompleted,
  onAuthenticationRecaptured,
}: Props) {
  const [journeyId, setJourneyId] = useState('');
  const [targetStepId, setTargetStepId] = useState('');
  const [runtimeValues, setRuntimeValues] = useState<EphemeralRuntimeValues>(
    {},
  );
  const [productionConfirmed, setProductionConfirmed] = useState(false);
  const [discovery, setDiscovery] = useState<RequestDiscoveryResult | null>(
    null,
  );
  const [candidateIndex, setCandidateIndex] = useState(-1);
  const [recipeId, setRecipeId] = useState<GuidedRecipeId>('duplicate_action');
  const [replayPacing, setReplayPacing] = useState<ReplayPacing>('recorded');
  const [experimentName, setExperimentName] = useState('');
  const [assertionSelections, setAssertionSelections] = useState<
    readonly RecommendationSelection[]
  >([]);
  const [result, setResult] = useState<ExternalRunDetail | null>(null);
  const [busy, setBusy] = useState<
    'analyze' | 'run' | 'auth-start' | 'auth-confirm' | null
  >(null);
  const [error, setError] = useState<string | null>(null);
  const [authenticationRequired, setAuthenticationRequired] = useState(false);
  const [authCapture, setAuthCapture] = useState<AuthCaptureSession | null>(
    null,
  );
  const [authMessage, setAuthMessage] = useState<string | null>(null);
  const [stepValueModes, setStepValueModes] = useState<
    Readonly<Record<string, SafeValueMode>>
  >({});
  const [customStepValues, setCustomStepValues] = useState<
    Readonly<Record<string, string>>
  >({});

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
  const runtimeRequirements =
    journey === null ? [] : journeyRuntimeRequirements(journey, settings);
  const recipe = guidedRecipe(recipeId);
  const candidates = discovery?.candidates ?? noCandidates;
  const selectedCandidate = candidates[candidateIndex] ?? null;
  const recommendationSet =
    discovery === null
      ? null
      : recommendationSetForCandidate(discovery, selectedCandidate);
  const assertions = selectedAssertions(assertionSelections);
  const suggestedStepValueOverrides = useMemo(
    () => (journey === null ? {} : guidedStepValueOverrides(journey)),
    [journey],
  );
  const configurableValueSteps = useMemo(
    () =>
      journey?.steps.filter(
        (step) =>
          step.value?.kind === 'safe' &&
          (step.type === 'fill' || step.type === 'select'),
      ) ?? [],
    [journey],
  );
  const stepValueOverrides = useMemo(() => {
    const overrides: Record<string, string> = {};
    for (const step of configurableValueSteps) {
      const mode = stepValueModes[step.id] ?? 'recorded';
      if (mode === 'recorded') continue;
      if (mode === 'custom') {
        const custom = customStepValues[step.id];
        if (custom !== undefined) overrides[step.id] = custom;
        continue;
      }
      const template = generatedTemplateByMode[mode];
      if (template !== undefined) overrides[step.id] = template;
    }
    return overrides;
  }, [configurableValueSteps, customStepValues, stepValueModes]);
  const customStepValueMissing = configurableValueSteps.some(
    (step) =>
      stepValueModes[step.id] === 'custom' &&
      (customStepValues[step.id]?.trim() ?? '') === '',
  );
  const analysis =
    journey === null
      ? null
      : analyzeJourney(journey, targetStep, stepValueOverrides);
  const readiness =
    journey === null || analysis === null || settings === null
      ? null
      : assessJourneyReadiness({
          journey,
          targetStep,
          runtimeRequirements,
          runtimeValues,
          generatedValueCount: analysis.generatedValueCount,
          authenticationAvailable: settings.authentication.available,
          cleanupConfigured: settings.afterRunHook !== null,
          production: project.environment === 'production',
        });
  const diagnosis = result === null ? null : diagnoseRun(result);

  useEffect(() => {
    if (journeys.some((item) => item.id === journeyId)) return;
    setJourneyId(journeys[0]?.id ?? '');
  }, [journeyId, journeys]);

  useEffect(() => {
    const modes: Record<string, SafeValueMode> = {};
    const customValues: Record<string, string> = {};
    for (const step of configurableValueSteps) {
      const suggested = suggestedStepValueOverrides[step.id];
      modes[step.id] = modeForTemplate(suggested);
      if (step.value?.kind === 'safe') {
        customValues[step.id] = step.value.value;
      }
    }
    setStepValueModes(modes);
    setCustomStepValues(customValues);
  }, [configurableValueSteps, suggestedStepValueOverrides]);

  useEffect(() => {
    if (journey === null) {
      setTargetStepId('');
      return;
    }
    const recommended = recommendTargetStep(journey);
    if (!compatibleSteps.some((step) => step.id === targetStepId)) {
      setTargetStepId(recommended?.id ?? '');
    }
  }, [compatibleSteps, journey, targetStepId]);

  useEffect(() => {
    setDiscovery(null);
    setCandidateIndex(-1);
    setAssertionSelections([]);
    setResult(null);
    setError(null);
  }, [journeyId, targetStepId, targetStep, recipeId]);

  useEffect(() => {
    setAssertionSelections(
      recommendationSet === null
        ? []
        : recommendationSelections(recommendationSet),
    );
  }, [discovery?.discoveryId, selectedCandidate?.candidateId, recipe.id]);

  useEffect(() => {
    setResult(null);
    setExperimentName(
      targetStep === null
        ? ''
        : boundedName(`${recipe.shortName}: ${targetStep.name}`),
    );
  }, [recipe.shortName, targetStep]);

  async function analyze(): Promise<void> {
    if (journey === null || targetStep === null) return;
    setBusy('analyze');
    setError(null);
    setResult(null);
    try {
      const discovered = await discoverRequests(
        journey.id,
        targetStep.id,
        nonEmptyValues(runtimeValues),
        project.environment !== 'production' || productionConfirmed,
        {
          recipe: {
            type: recipe.id,
            triggerCount: recipe.triggerCount,
            intervalMs: recipe.intervalMs,
          },
          normalizeJourney: true,
          stepValueOverrides,
        },
      );
      setDiscovery(discovered);
      setCandidateIndex(initialCandidateIndex(discovered));
    } catch (reason: unknown) {
      handleExecutionFailure(reason);
    } finally {
      setBusy(null);
    }
  }

  async function saveAndRun(): Promise<void> {
    if (journey === null || targetStep === null || selectedCandidate === null) {
      return;
    }
    setBusy('run');
    setError(null);
    setResult(null);
    try {
      const input: CreateExternalExperimentRequest = {
        name: experimentName,
        targetStepId: targetStep.id,
        triggerCount: recipe.triggerCount,
        intervalMs: recipe.intervalMs,
        networkMatcher: matcherForCandidate(selectedCandidate),
        assertions: [...assertions],
        continueAfterTarget: false,
        guided: true,
        normalizeJourney: true,
        requestSelectionProvenance:
          discovery === null
            ? null
            : selectionProvenance(discovery, selectedCandidate),
        assertionSelectionProvenance: [
          ...recommendationProvenance(assertionSelections),
        ],
        stepValueOverrides,
      };
      const version = await createExternalExperiment(journey.id, input);
      const completed = await runExternalExperiment(
        version.id,
        nonEmptyValues(runtimeValues),
        project.environment !== 'production' || productionConfirmed,
        'adaptive',
        replayPacing,
      );
      setResult(completed);
      onCompleted(completed);
      if (completed.runnerError?.code === 'authentication_required') {
        setAuthenticationRequired(true);
        setAuthMessage(completed.runnerError.message);
      }
    } catch (reason: unknown) {
      handleExecutionFailure(reason);
    } finally {
      setBusy(null);
    }
  }

  function handleExecutionFailure(reason: unknown): void {
    if (
      reason instanceof FormCrashApiError &&
      reason.code === 'AUTHENTICATION_REQUIRED'
    ) {
      setAuthenticationRequired(true);
      setAuthMessage(reason.message);
      setError(null);
      return;
    }
    setError(messageOf(reason));
  }

  async function beginAuthenticationRecovery(): Promise<void> {
    setBusy('auth-start');
    setError(null);
    try {
      setAuthCapture(await startAuthenticationCapture(project.id));
    } catch (reason: unknown) {
      setError(messageOf(reason));
    } finally {
      setBusy(null);
    }
  }

  async function confirmAuthenticationRecovery(): Promise<void> {
    if (authCapture === null) return;
    setBusy('auth-confirm');
    setError(null);
    try {
      const completed = await confirmAuthenticationCapture(
        project.id,
        authCapture.id,
      );
      setAuthCapture(completed);
      const refreshed = await getProjectSettings(project.id);
      onAuthenticationRecaptured(refreshed);
      setAuthenticationRequired(false);
      setAuthMessage(
        'Authentication was saved. Retry request analysis or run the test again.',
      );
    } catch (reason: unknown) {
      setError(messageOf(reason));
    } finally {
      setBusy(null);
    }
  }

  const productionBlocked =
    project.environment === 'production' && !productionConfirmed;
  const readinessBlocked = readiness?.status === 'blocked';

  return (
    <div className="guided-test">
      <div className="panel guided-hero">
        <div>
          <p className="eyebrow">Guided Test</p>
          <h2>
            Test a recorded action without configuring the technical details
          </h2>
          <p>
            FormCrash selects the likely action, discovers its request, creates
            evidence-backed resilience checks, saves the experiment, and runs
            it.
          </p>
        </div>
        <button
          className="button button-secondary button-compact"
          onClick={onOpenAdvanced}
          type="button"
        >
          Open Advanced mode
        </button>
      </div>

      <ol className="guided-steps" aria-label="Guided test progress">
        <GuidedStep
          active={candidates.length === 0 && result === null}
          complete={candidates.length > 0}
          number={1}
          title="Choose journey"
        />
        <GuidedStep
          active={candidates.length > 0 && result === null}
          complete={result !== null}
          number={2}
          title="Review recommendation"
        />
        <GuidedStep
          active={result !== null}
          complete={result !== null}
          number={3}
          title="Understand result"
        />
      </ol>

      {error !== null ? (
        <div className="state-message state-message-error" role="alert">
          {error}
        </div>
      ) : null}

      {authenticationRequired ? (
        <div className="state-message state-message-error" role="alert">
          <strong>Authentication interrupted</strong>
          <p>
            {authMessage ??
              'The application requires a new sign-in before FormCrash can continue.'}
          </p>
          <div className="recording-actions">
            <button
              className="button button-secondary button-compact"
              disabled={busy !== null}
              onClick={() => void beginAuthenticationRecovery()}
              type="button"
            >
              {busy === 'auth-start' ? 'Launching sign-inâ€¦' : 'Sign in again'}
            </button>
            {authCapture?.status === 'awaiting_confirmation' ? (
              <button
                className="button button-primary button-compact"
                disabled={busy !== null}
                onClick={() => void confirmAuthenticationRecovery()}
                type="button"
              >
                {busy === 'auth-confirm'
                  ? 'Saving sessionâ€¦'
                  : 'I am signed in â€” save session'}
              </button>
            ) : null}
          </div>
        </div>
      ) : authMessage !== null ? (
        <div className="state-message" role="status">
          {authMessage}
        </div>
      ) : null}

      <div className="panel guided-section">
        <div className="section-heading-row">
          <div>
            <p className="eyebrow">Step 1</p>
            <h3>Select a normal journey</h3>
          </div>
          {settings !== null ? (
            <span className="status-badge">
              Auth{' '}
              {settings.authentication.available ? 'ready' : 'not captured'}
            </span>
          ) : null}
        </div>

        {journeys.length === 0 ? (
          <div className="guided-onboarding">
            <div>
              <h4>Set up your first guided test</h4>
              <p>
                A guided test starts from a successful normal journey. FormCrash
                then repeats one action and checks whether the site handles it
                safely.
              </p>
            </div>
            <ol>
              <li>
                <strong>Capture authentication if needed.</strong>
                <span>Skip this for public pages.</span>
              </li>
              <li>
                <strong>Record one successful journey.</strong>
                <span>Complete the form normally and save the journey.</span>
              </li>
              <li>
                <strong>Return here and choose a recipe.</strong>
                <span>FormCrash handles request discovery and assertions.</span>
              </li>
            </ol>
            <div className="guided-action-row">
              <a className="button button-primary" href="#recording-workspace">
                Go to journey recording
              </a>
              <button
                className="button button-secondary"
                onClick={onOpenAdvanced}
                type="button"
              >
                Set up authentication
              </button>
            </div>
          </div>
        ) : (
          <>
            {settings === null ? (
              <p className="technical-note">Loading project settings…</p>
            ) : !settings.authentication.available ? (
              <div className="guided-auth-note">
                <div>
                  <strong>Authentication has not been captured.</strong>
                  <span>
                    Public journeys can continue. If this journey starts behind
                    a sign-in screen, capture authentication before analyzing
                    it.
                  </span>
                </div>
                <button
                  className="button button-secondary button-compact"
                  onClick={onOpenAdvanced}
                  type="button"
                >
                  Set up authentication
                </button>
              </div>
            ) : null}

            <div className="guided-form-grid">
              <label>
                Journey
                <select
                  aria-label="Guided journey"
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
                Action to stress-test
                <select
                  aria-label="Guided target action"
                  value={targetStepId}
                  onChange={(event) => setTargetStepId(event.target.value)}
                >
                  {compatibleSteps.map((step, index) => (
                    <option key={step.id} value={step.id}>
                      {index + 1}. {step.name} ({step.type})
                    </option>
                  ))}
                </select>
              </label>
            </div>

            <fieldset className="guided-recipe-selector">
              <legend>What problem do you want to test?</legend>
              <div className="guided-recipe-grid">
                {guidedRecipes.map((item) => (
                  <label
                    className={`guided-recipe-card ${
                      recipeId === item.id ? 'guided-recipe-card-selected' : ''
                    }`}
                    key={item.id}
                  >
                    <input
                      checked={recipeId === item.id}
                      name="guided-recipe"
                      onChange={() => setRecipeId(item.id)}
                      type="radio"
                    />
                    <span>
                      <strong>{item.name}</strong>
                      <small>{item.description}</small>
                      <em>{item.expectedOutcome}</em>
                    </span>
                  </label>
                ))}
              </div>
            </fieldset>

            {analysis !== null ? (
              <div className="guided-analysis">
                <SummaryMetric
                  label="Selected action"
                  value={targetStep?.name ?? 'No compatible action'}
                />
                <SummaryMetric
                  label="Generated values"
                  value={String(analysis.generatedValueCount)}
                />
                <SummaryMetric
                  label="Sensitive inputs"
                  value={String(analysis.sensitiveValueCount)}
                />
                <SummaryMetric
                  label="Locator quality"
                  value={analysis.locatorQuality}
                />
              </div>
            ) : null}

            {targetStep === null ? (
              <p className="recording-warning">
                This journey has no recorded click or submit action to test.
              </p>
            ) : (
              <p className="technical-note">
                Recommended automatically: the last recorded submit action is
                preferred; otherwise FormCrash uses the last click action.
              </p>
            )}

            {runtimeRequirements.length > 0 ? (
              <div className="guided-runtime-inputs">
                <h4>Values required for this journey</h4>
                <div className="runtime-value-grid">
                  {runtimeRequirements.map((requirement) => (
                    <label key={requirement.name}>
                      {requirement.label}
                      <input
                        aria-label={`Guided ${requirement.name}`}
                        autoComplete="off"
                        placeholder={requirement.name}
                        type={requirement.secret ? 'password' : 'text'}
                        value={runtimeValues[requirement.name] ?? ''}
                        onChange={(event) =>
                          setRuntimeValues((current) => ({
                            ...current,
                            [requirement.name]: event.target.value,
                          }))
                        }
                      />
                    </label>
                  ))}
                </div>
              </div>
            ) : (
              <p className="guided-ready-note">
                Runtime data is ready. Built-in templates will generate unique
                values automatically.
              </p>
            )}

            {configurableValueSteps.length > 0 ? (
              <div className="guided-runtime-inputs">
                <h4>Values FormCrash will enter</h4>
                <p className="technical-note">
                  Recorded values are reused unless you choose a generated or
                  custom value. Generated values are new for every analysis and
                  experiment run.
                </p>
                <div className="runtime-value-grid">
                  {configurableValueSteps.map((step) => {
                    const mode = stepValueModes[step.id] ?? 'recorded';
                    const recordedValue =
                      step.value?.kind === 'safe' ? step.value.value : '';
                    return (
                      <div className="guided-value-override" key={step.id}>
                        <label>
                          {step.name}
                          <select
                            aria-label={`${step.name} value source`}
                            value={mode}
                            onChange={(event) => {
                              const nextMode = event.target
                                .value as SafeValueMode;
                              setStepValueModes((current) => ({
                                ...current,
                                [step.id]: nextMode,
                              }));
                            }}
                          >
                            <option value="recorded">
                              Recorded — {boundedValue(recordedValue)}
                            </option>
                            <option value="unique_text">
                              Generated unique code
                            </option>
                            <option value="uuid">Generated UUID</option>
                            <option value="unique_name">
                              Generated test name
                            </option>
                            <option value="unique_email">
                              Generated email
                            </option>
                            <option value="unique_phone">
                              Generated phone
                            </option>
                            <option value="custom">Enter a custom value</option>
                          </select>
                        </label>
                        {mode === 'custom' ? (
                          <label>
                            Value for analysis and this test
                            <input
                              aria-label={`${step.name} custom value`}
                              autoComplete="off"
                              value={customStepValues[step.id] ?? ''}
                              onChange={(event) =>
                                setCustomStepValues((current) => ({
                                  ...current,
                                  [step.id]: event.target.value,
                                }))
                              }
                            />
                          </label>
                        ) : null}
                        {mode !== 'recorded' && mode !== 'custom' ? (
                          <small>
                            Template: {generatedTemplateByMode[mode]}
                          </small>
                        ) : null}
                      </div>
                    );
                  })}
                </div>
                <p className="technical-note">
                  Need a specific format? Choose custom and use a template such
                  as <code>P-{'{{run.shortId}}'}</code>.
                </p>
              </div>
            ) : null}

            {readiness !== null ? (
              <div className="guided-readiness">
                <div className="section-heading-row compact-heading">
                  <div>
                    <h4>Journey readiness</h4>
                    <p>
                      FormCrash checks replay stability, required data,
                      authentication, and cleanup before opening a browser.
                    </p>
                  </div>
                  <span
                    className={`readiness-score readiness-score-${readiness.status}`}
                  >
                    {readiness.score}/100 ·{' '}
                    {readiness.status === 'blocked'
                      ? 'Needs input'
                      : readiness.status === 'review'
                        ? 'Review'
                        : 'Ready'}
                  </span>
                </div>
                <div className="readiness-list">
                  {readiness.items.map((item) => (
                    <div
                      className={`readiness-item readiness-item-${item.level}`}
                      key={item.id}
                    >
                      <span aria-hidden="true">
                        {item.level === 'pass'
                          ? '✓'
                          : item.level === 'warning'
                            ? '!'
                            : '×'}
                      </span>
                      <div>
                        <strong>{item.title}</strong>
                        <small>{item.detail}</small>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            ) : null}

            {project.environment === 'production' ? (
              <label className="production-confirmation">
                <input
                  checked={productionConfirmed}
                  onChange={(event) =>
                    setProductionConfirmed(event.target.checked)
                  }
                  type="checkbox"
                />{' '}
                I understand that analysis submits the real action once and the
                guided run triggers it {recipe.triggerCount} times. This can
                create production data.
              </label>
            ) : (
              <p className="technical-note">
                Environment: {project.environment}. Use disposable data and
                configure cleanup for state-changing actions.
              </p>
            )}

            <div className="guided-action-row">
              <button
                className="button button-primary"
                disabled={
                  busy !== null ||
                  targetStep === null ||
                  settings === null ||
                  readinessBlocked ||
                  productionBlocked ||
                  customStepValueMissing
                }
                onClick={() => void analyze()}
                type="button"
              >
                {busy === 'analyze'
                  ? 'Analyzing action…'
                  : discovery !== null
                    ? 'Analyze again'
                    : 'Analyze action'}
              </button>
              <span>
                This executes the selected action once to identify its request.
              </span>
            </div>
          </>
        )}
      </div>

      {discovery !== null ? (
        <div className="panel guided-section">
          <div className="section-heading-row">
            <div>
              <p className="eyebrow">Step 2</p>
              <h3>Review FormCrash’s recommendation</h3>
            </div>
            <span className="status-badge">
              {recommendationOutcomeLabel(discovery)}
            </span>
          </div>

          <p className="technical-note">
            {discovery.recommendation.explanation}
          </p>

          {candidates.length > 0 ? (
            <div className="guided-candidate-list">
              {candidates.map((candidate, index) => (
                <label
                  className={`guided-candidate ${
                    candidateIndex === index ? 'guided-candidate-selected' : ''
                  }`}
                  key={candidate.candidateId}
                >
                  <input
                    checked={candidateIndex === index}
                    disabled={
                      discovery.recommendation.outcome === 'no_candidate'
                    }
                    name="guided-candidate"
                    onChange={() => setCandidateIndex(index)}
                    type="radio"
                  />
                  <span>
                    <strong>
                      {requestKind(candidate)}
                      {candidate.recommended ? ' — Recommended' : ''}
                    </strong>
                    <code>
                      {candidate.method} {candidate.pathname}
                    </code>
                    <small>
                      HTTP {candidate.status ?? 'pending'} ·{' '}
                      {candidate.occurrences} occurrence(s) ·{' '}
                      {new URL(candidate.origin).host}
                    </small>
                    <small>{basicCandidateReasons(candidate)}</small>
                  </span>
                </label>
              ))}
            </div>
          ) : (
            <div className="empty-state">
              <h4>No suitable request was observed</h4>
              <p>
                Check that the target action passed validation and caused the
                intended operation. Interface-only assertions remain available
                in Advanced mode.
              </p>
              <button
                className="button button-secondary button-compact"
                onClick={onOpenAdvanced}
                type="button"
              >
                Open Advanced mode
              </button>
            </div>
          )}
          {discovery.recommendation.outcome === 'no_candidate' &&
          candidates.length > 0 ? (
            <div className="empty-state">
              <h4>No request can be selected safely</h4>
              <p>
                The observed traffic was classified as static, analytics, or
                background activity. Interface-only assertions remain available
                in Advanced mode.
              </p>
              <button
                className="button button-secondary button-compact"
                onClick={onOpenAdvanced}
                type="button"
              >
                Open Advanced mode
              </button>
            </div>
          ) : null}

          {selectedCandidate !== null &&
          !isMutationMethod(selectedCandidate.method) ? (
            <p className="recording-warning">
              This is a read-only request. For a create or update form, select
              the related POST, PUT, PATCH, or DELETE request instead.
            </p>
          ) : null}

          {selectedCandidate !== null ? (
            <>
              <div className="guided-plan">
                <div>
                  <p className="eyebrow">Recommended experiment</p>
                  <h4>{recipe.name}</h4>
                  <p>
                    {recipe.triggerCount} triggers · {recipe.intervalMs} ms
                    interval. Later journey steps will not run.{' '}
                    {recipe.expectedOutcome}
                  </p>
                </div>
                <label>
                  Experiment name
                  <input
                    aria-label="Guided experiment name"
                    maxLength={160}
                    value={experimentName}
                    onChange={(event) => setExperimentName(event.target.value)}
                  />
                </label>
                <label>
                  Journey pacing
                  <select
                    aria-label="Guided replay pacing"
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
              </div>

              <div className="guided-assertion-list">
                <h4>Recommended checks</h4>
                {assertionSelections.map((selection) => (
                  <div
                    className="guided-assertion"
                    key={selection.recommendation.recommendationId}
                  >
                    <input
                      aria-label={`Enable ${selection.assertion.description}`}
                      checked={selection.enabled}
                      onChange={(event) =>
                        setAssertionSelections((current) =>
                          current.map((item) =>
                            item.recommendation.recommendationId ===
                            selection.recommendation.recommendationId
                              ? { ...item, enabled: event.target.checked }
                              : item,
                          ),
                        )
                      }
                      type="checkbox"
                    />
                    <div>
                      <strong>{selection.assertion.description}</strong>
                      <small>
                        {selection.recommendation.confidence === 'high'
                          ? 'Enabled by default'
                          : 'Review before enabling'}{' '}
                        · {selection.recommendation.explanation}
                      </small>
                      <small>
                        Evidence: {selection.recommendation.evidence.source}
                      </small>
                      {assertionSupportsValueEdit(selection.assertion) ? (
                        <input
                          aria-label={`Edit ${selection.assertion.description}`}
                          disabled={!selection.enabled}
                          value={editableAssertionValue(selection.assertion)}
                          onChange={(event) =>
                            setAssertionSelections((current) =>
                              current.map((item) =>
                                item.recommendation.recommendationId ===
                                selection.recommendation.recommendationId
                                  ? {
                                      ...item,
                                      assertion: assertionWithEditedValue(
                                        item.assertion,
                                        event.target.value,
                                      ),
                                    }
                                  : item,
                              ),
                            )
                          }
                        />
                      ) : null}
                    </div>
                  </div>
                ))}
                {recommendationSet?.limitations.map((limitation) => (
                  <p className="technical-note" key={limitation}>
                    {limitation}
                  </p>
                ))}
              </div>

              {settings?.afterRunHook === null ? (
                <div className="guided-cleanup-warning">
                  <p className="recording-warning">
                    No cleanup hook is configured. Manually remove test data
                    created by analysis and the guided run.
                  </p>
                  <button
                    className="button button-secondary button-compact"
                    onClick={onOpenAdvanced}
                    type="button"
                  >
                    Configure cleanup
                  </button>
                </div>
              ) : (
                <p className="guided-ready-note">
                  The configured cleanup hook will run after the experiment.
                </p>
              )}

              <div className="guided-action-row">
                <button
                  className="button button-primary"
                  disabled={
                    busy !== null ||
                    experimentName.trim() === '' ||
                    productionBlocked ||
                    assertions.length === 0 ||
                    customStepValueMissing
                  }
                  onClick={() => void saveAndRun()}
                  type="button"
                >
                  {busy === 'run'
                    ? 'Saving and running…'
                    : selectedCandidate.recommended
                      ? 'Save and run recommended test'
                      : 'Save and run selected test'}
                </button>
                <button
                  className="button button-secondary"
                  onClick={onOpenAdvanced}
                  type="button"
                >
                  Customize in Advanced mode
                </button>
              </div>
            </>
          ) : null}
        </div>
      ) : null}

      {result !== null ? (
        <div className="panel guided-section">
          <p className="eyebrow">Step 3</p>
          <h3>What FormCrash found</h3>
          <div className={`guided-diagnosis guided-diagnosis-${result.status}`}>
            <strong>{diagnosis?.title}</strong>
            <p>{diagnosis?.message}</p>
            {diagnosis !== null && diagnosis.actions.length > 0 ? (
              <div className="guided-next-actions">
                <h4>What to do next</h4>
                <ul>
                  {diagnosis.actions.map((action) => (
                    <li key={action}>{action}</li>
                  ))}
                </ul>
              </div>
            ) : null}
          </div>
          <ExternalRunResult eyebrow="Guided test result" result={result} />
          <div className="guided-action-row">
            <button
              className="button button-secondary"
              onClick={() => {
                setDiscovery(null);
                setCandidateIndex(-1);
                setResult(null);
                setError(null);
              }}
              type="button"
            >
              Start another guided test
            </button>
          </div>
        </div>
      ) : null}
    </div>
  );
}

function GuidedStep({
  number,
  title,
  active,
  complete,
}: {
  readonly number: number;
  readonly title: string;
  readonly active: boolean;
  readonly complete: boolean;
}) {
  return (
    <li
      className={`guided-step ${active ? 'guided-step-active' : ''} ${
        complete ? 'guided-step-complete' : ''
      }`}
    >
      <span>{complete ? '✓' : number}</span>
      <strong>{title}</strong>
    </li>
  );
}

function SummaryMetric({
  label,
  value,
}: {
  readonly label: string;
  readonly value: string;
}) {
  return (
    <div>
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

function recommendTargetStep(
  journey: PersistedJourney,
): RecordedJourneyStep | null {
  return (
    [...journey.steps].reverse().find((step) => step.type === 'submit') ??
    [...journey.steps].reverse().find((step) => step.type === 'click') ??
    null
  );
}

function analyzeJourney(
  journey: PersistedJourney,
  targetStep: RecordedJourneyStep | null,
  stepValueOverrides: Readonly<Record<string, string>>,
) {
  return {
    generatedValueCount: journey.steps.filter(
      (step) =>
        (step.value?.kind === 'safe' && step.value.value.includes('{{')) ||
        stepValueOverrides[step.id] !== undefined,
    ).length,
    sensitiveValueCount: journey.steps.filter(
      (step) => step.value?.kind === 'sensitive',
    ).length,
    locatorQuality:
      targetStep?.locator === null || targetStep === null
        ? 'Unavailable'
        : targetStep.locator.strategy === 'css'
          ? 'Brittle'
          : 'Strong',
  };
}

function requestKind(candidate: RankedRequestCandidate): string {
  switch (candidate.classification) {
    case 'likely_business_mutation':
      return candidate.method === 'POST'
        ? 'Likely create request'
        : 'Possible related update';
    case 'background_refresh':
      return 'Background list refresh';
    case 'analytics':
      return 'Analytics request';
    case 'static_asset':
      return 'Static asset';
    case 'other':
      return 'Other related request';
  }
}

function recommendationOutcomeLabel(discovery: RequestDiscoveryResult): string {
  switch (discovery.recommendation.outcome) {
    case 'recommended':
      return 'High confidence';
    case 'review':
      return 'Review required';
    case 'ambiguous':
      return 'Ambiguous requests';
    case 'no_candidate':
      return 'No suitable request';
  }
}

function basicCandidateReasons(candidate: RankedRequestCandidate): string {
  const limiting = candidate.reasons.filter((reason) => reason.scoreImpact < 0);
  const supporting = candidate.reasons.filter(
    (reason) => reason.scoreImpact > 0,
  );
  return [...limiting, ...supporting]
    .slice(0, 2)
    .map((reason) => reason.label)
    .join(' ');
}

function isMutationMethod(method: string): boolean {
  return ['POST', 'PUT', 'PATCH', 'DELETE'].includes(method);
}

function diagnoseRun(result: ExternalRunDetail): {
  readonly title: string;
  readonly message: string;
  readonly actions: readonly string[];
} {
  const matched = result.networkObservations.filter((item) => item.matched);
  const serverErrors = matched.filter(
    (item) => item.status !== null && item.status >= 500,
  );
  const successes = matched.filter(
    (item) =>
      !item.failed &&
      item.status !== null &&
      item.status >= 200 &&
      item.status < 400,
  );
  if (result.status === 'runner_error') {
    return {
      title: 'The browser could not complete the journey.',
      message:
        result.runnerError?.message ??
        'Execution stopped before the safety checks could be evaluated.',
      actions: [
        'Review the failed step and replay locator shown below.',
        'Confirm saved authentication is still valid if the journey requires sign-in.',
        'Record the journey again if the target page or form has changed.',
      ],
    };
  }
  if (matched.length > 1 && serverErrors.length > 0) {
    return {
      title: 'The repeated action reached the server more than once.',
      message: `${matched.length} matching requests occurred. ${successes.length} succeeded and ${serverErrors.length} returned a server error. The client should prevent re-entry and the server should not turn a duplicate request into HTTP 5xx.`,
      actions: [
        'Disable the triggering control immediately when submission starts.',
        'Add a server idempotency key or database uniqueness rule.',
        'Return a controlled conflict response instead of HTTP 5xx for duplicates.',
      ],
    };
  }
  if (successes.length > 1) {
    return {
      title: 'The repeated action succeeded more than once.',
      message: `${successes.length} matching requests succeeded. Verify whether duplicate business records were created and add client locking plus server-side idempotency.`,
      actions: [
        'Check the target system for duplicate records created by this run.',
        'Add a pending-state lock in the client.',
        'Enforce idempotency or a unique business constraint on the server.',
      ],
    };
  }
  if (result.status === 'passed') {
    return {
      title: 'The action handled the repeated trigger safely.',
      message:
        matched.length === 1
          ? 'Only one matching request was observed and every selected safety check passed.'
          : `${matched.length} matching requests were observed, but no more than one succeeded and every selected safety check passed.`,
      actions: [
        'Keep both client-side locking and server-side duplicate protection in place.',
        'Run the other recipes to test slower retries and server duplicate handling.',
      ],
    };
  }
  if (matched.length > 1 && successes.length <= 1) {
    return {
      title: 'The browser sent the action more than once.',
      message: `${matched.length} matching requests occurred, but only ${successes.length} succeeded. Server protection helped, while the client-side duplicate-action check still failed.`,
      actions: [
        'Lock the button or form synchronously before awaiting the network request.',
        'Keep the server duplicate protection that limited successful writes.',
      ],
    };
  }
  if (matched.length === 0) {
    return {
      title: 'The configured request was not observed.',
      message:
        'The action may have changed, validation may have blocked submission, or the selected request may not represent this action.',
      actions: [
        'Run request analysis again and select the request caused by the action.',
        'Confirm required form values pass the target application’s validation.',
        'Record the journey again if the page changed.',
      ],
    };
  }
  return {
    title: 'The action needs review.',
    message:
      'One or more recommended checks failed. Review the assertion details and request statuses below.',
    actions: [
      'Review the failed assertion and the response status for each attempt.',
      'Repeat the test after fixing the client or server protection.',
    ],
  };
}

function nonEmptyValues(
  values: EphemeralRuntimeValues,
): EphemeralRuntimeValues {
  return Object.fromEntries(
    Object.entries(values).filter(([, value]) => value.trim() !== ''),
  );
}

function boundedName(value: string): string {
  return value.trim().slice(0, 160);
}

function messageOf(reason: unknown): string {
  return reason instanceof Error
    ? reason.message
    : 'The operation could not be completed.';
}

function modeForTemplate(value: string | undefined): SafeValueMode {
  if (value === '{{unique.text}}') return 'unique_text';
  if (value === '{{run.id}}') return 'uuid';
  if (value === '{{unique.name}}') return 'unique_name';
  if (value === '{{unique.email}}') return 'unique_email';
  if (value === '{{unique.phone}}') return 'unique_phone';
  return 'recorded';
}

function boundedValue(value: string): string {
  const normalized = value.replace(/\s+/gu, ' ').trim();
  if (normalized === '') return '(empty)';
  return normalized.length <= 36 ? normalized : `${normalized.slice(0, 33)}…`;
}
