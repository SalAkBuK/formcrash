'use client';

import Link from 'next/link';
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type Dispatch,
  type ReactNode,
  type SetStateAction,
} from 'react';
import type {
  CreateExternalExperimentRequest,
  EphemeralRuntimeValues,
  ExternalAssertion,
  ExternalExperimentVersion,
  NetworkEvidenceCandidate,
  NetworkEvidenceCandidateList,
  PersistedJourney,
  Project,
  ProjectExecutionSettings,
  ReplayPacing,
} from '@formcrash/contracts';

import { Button } from '../../../components/ui/button';
import { DisclosurePanel } from '../../../components/ui/disclosure-panel';
import { StateMessage } from '../../../components/ui/state-message';
import { StatusBadge } from '../../../components/ui/status-badge';
import {
  createExternalExperimentSuite,
  listNetworkEvidenceCandidates,
  saveProductionReplayAcknowledgement,
} from '../api/external-experiments';
import { guidedRecipes, type GuidedRecipeId } from '../models/guided-recipes';
import { guidedStepValueOverrides } from '../models/guided-values';
import { assessJourneyReadiness } from '../models/journey-readiness';
import {
  candidateCanBeApproved,
  matcherForCandidate,
  provenanceForCandidate,
  recipeNetworkAssertions,
} from '../models/network-evidence';
import { journeyRuntimeRequirements } from '../models/journey-runtime';
import {
  describeOutcomeCheck,
  outcomeCheckTypeLabel,
} from '../models/outcome-check-presentation';
import {
  OutcomeDefinitionPanel,
  type OutcomeDefinitionState,
} from './outcome-definition-panel';
import {
  TechnicalChecksEditor,
  technicalChecksAreValid,
} from './technical-checks-editor';

type WizardStep = 1 | 2 | 3;
export type GuidedWizardStage = 'outcome' | 'safety' | 'review';
type ExpectedWorkspaceTab = 'overview' | 'action' | 'checks';
type SafeValueMode =
  | 'recorded'
  | 'unique_text'
  | 'uuid'
  | 'unique_name'
  | 'unique_email'
  | 'unique_phone'
  | 'custom';

export interface GuidedTestDraftV1 {
  readonly version: 1;
  readonly projectId: string;
  readonly journeyId: string;
  readonly stage: GuidedWizardStage;
  readonly recipeId: GuidedRecipeId;
  readonly replayPacing: ReplayPacing;
  readonly experimentName: string;
  readonly stepValueModes: Readonly<
    Record<string, Exclude<SafeValueMode, 'custom'>>
  >;
}

const generatedTemplateByMode: Readonly<
  Partial<Record<SafeValueMode, string>>
> = {
  unique_text: '{{unique.text}}',
  uuid: '{{run.id}}',
  unique_name: '{{unique.name}}',
  unique_email: '{{unique.email}}',
  unique_phone: '{{unique.phone}}',
};

const initialOutcomeState: OutcomeDefinitionState = {
  checks: [],
  criticalAction: null,
  error: null,
  loading: true,
};

interface Props {
  readonly project: Project;
  readonly journeys: readonly PersistedJourney[];
  readonly settings: ProjectExecutionSettings | null;
  readonly selectedJourneyId?: string | null | undefined;
  readonly onSelectedJourneyChange?: ((journeyId: string) => void) | undefined;
  readonly onSaved: (versions: readonly ExternalExperimentVersion[]) => void;
  readonly onAuthenticationRecaptured: (
    settings: ProjectExecutionSettings,
  ) => void;
  readonly initialDraft?: GuidedTestDraftV1 | null;
  readonly onDraftChange?: ((draft: GuidedTestDraftV1) => void) | undefined;
  readonly onStageChange?: ((stage: GuidedWizardStage) => void) | undefined;
}

export function GuidedTestPanel({
  project,
  journeys,
  settings,
  selectedJourneyId,
  onSelectedJourneyChange,
  onSaved,
  onAuthenticationRecaptured,
  initialDraft = null,
  onDraftChange,
  onStageChange,
}: Props) {
  const [currentStep, setCurrentStep] = useState<WizardStep>(
    initialDraft?.stage === 'outcome' ? 1 : 2,
  );
  const [expectedWorkspaceTab, setExpectedWorkspaceTab] =
    useState<ExpectedWorkspaceTab>('overview');
  const [completedSteps, setCompletedSteps] = useState<ReadonlySet<number>>(
    new Set(),
  );
  const [journeyId, setJourneyId] = useState(
    initialDraft?.journeyId ?? selectedJourneyId ?? '',
  );
  const [outcomeState, setOutcomeState] =
    useState<OutcomeDefinitionState>(initialOutcomeState);
  const [runtimeValues, setRuntimeValues] = useState<EphemeralRuntimeValues>(
    {},
  );
  const [productionConfirmed, setProductionConfirmed] = useState(false);
  const [recipeId] = useState<GuidedRecipeId>(
    initialDraft?.recipeId ?? 'duplicate_action',
  );
  const [replayPacing, setReplayPacing] = useState<ReplayPacing>(
    initialDraft?.replayPacing ?? 'recorded',
  );
  const [experimentName, setExperimentName] = useState(
    initialDraft?.experimentName ?? '',
  );
  const [technicalChecks, setTechnicalChecks] = useState<
    readonly ExternalAssertion[]
  >([]);
  const [networkEvidence, setNetworkEvidence] =
    useState<NetworkEvidenceCandidateList | null>(null);
  const [networkEvidenceLoading, setNetworkEvidenceLoading] = useState(false);
  const [approvedCandidateId, setApprovedCandidateId] = useState<string | null>(
    null,
  );
  const [stepValueModes, setStepValueModes] = useState<
    Readonly<Record<string, SafeValueMode>>
  >({});
  const [customStepValues, setCustomStepValues] = useState<
    Readonly<Record<string, string>>
  >({});
  const [savedVersions, setSavedVersions] = useState<
    readonly ExternalExperimentVersion[]
  >([]);
  const [busy, setBusy] = useState<'review' | 'save' | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [showValidation, setShowValidation] = useState(false);
  const submissionPending = useRef(false);
  const restoredDraftName = useRef(false);
  const journeyResetReady = useRef(false);

  const journey = useMemo(
    () => journeys.find((item) => item.id === journeyId) ?? null,
    [journeyId, journeys],
  );
  const criticalStep = useMemo(
    () =>
      journey?.steps.find(
        (step) => step.id === outcomeState.criticalAction?.stepId,
      ) ?? null,
    [journey, outcomeState.criticalAction?.stepId],
  );
  const runtimeRequirements = useMemo(
    () =>
      journey === null ? [] : journeyRuntimeRequirements(journey, settings),
    [journey, settings],
  );
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
  const generatedTemplates = useMemo(
    () => safeGeneratedTemplates(settings, stepValueOverrides),
    [settings, stepValueOverrides],
  );
  const approvedCandidate =
    networkEvidence?.items.find(
      (candidate) => candidate.candidateId === approvedCandidateId,
    ) ?? null;
  const missingRuntime = runtimeRequirements.filter(
    (requirement) =>
      (runtimeValues[requirement.name] ?? '').trim().length === 0,
  );
  const customStepValueMissing = configurableValueSteps.some(
    (step) =>
      stepValueModes[step.id] === 'custom' &&
      (customStepValues[step.id]?.trim() ?? '') === '',
  );
  const productionBlocked =
    project.environment === 'production' && !productionConfirmed;
  const readiness =
    journey === null || settings === null
      ? null
      : assessJourneyReadiness({
          journey,
          targetStep: criticalStep,
          runtimeRequirements,
          runtimeValues,
          generatedValueCount: generatedTemplates.length,
          authenticationAvailable: settings.authentication.available,
          cleanupConfigured: settings.afterRunHook !== null,
          production: project.environment === 'production',
        });

  const expectedBlockers = useMemo(() => {
    const reasons: string[] = [];
    if (outcomeState.loading) {
      reasons.push('Saved Outcome Check configuration is still loading.');
    }
    if (outcomeState.error !== null) {
      reasons.push('Saved Outcome Check configuration could not be loaded.');
    }
    if (outcomeState.criticalAction === null) {
      reasons.push('Approve one Critical Action for this journey version.');
    }
    if (outcomeState.checks.length === 0) {
      reasons.push('Save at least one valid Outcome Check.');
    }
    return reasons;
  }, [outcomeState]);

  const safetyBlockers = useMemo(() => {
    const reasons: string[] = [];
    if (settings === null)
      reasons.push('Project execution settings are loading.');
    if (criticalStep === null) {
      reasons.push(
        'The saved Critical Action is missing from this journey version.',
      );
    }
    if (outcomeState.checks.length === 0) {
      reasons.push('At least one saved Outcome Check is required.');
    }
    if (customStepValueMissing) {
      reasons.push('Every custom journey value needs a value or template.');
    }
    return reasons;
  }, [
    criticalStep,
    customStepValueMissing,
    outcomeState.checks.length,
    settings,
  ]);

  const reviewBlockers = useMemo(() => {
    const reasons = [...safetyBlockers];
    if (!technicalChecksAreValid(technicalChecks)) {
      reasons.push('Complete or remove each optional Technical check.');
    }
    if (suiteActionLabel(experimentName) === '') {
      reasons.push('Enter an action label.');
    }
    return reasons;
  }, [experimentName, safetyBlockers, technicalChecks]);

  useEffect(() => {
    setProductionConfirmed(settings?.productionReplayAcknowledged === true);
  }, [project.id, settings?.productionReplayAcknowledged]);

  useEffect(() => {
    const preferred =
      journeys.find((item) => item.id === selectedJourneyId)?.id ??
      journeys[0]?.id ??
      '';
    if (journeys.some((item) => item.id === journeyId)) return;
    setJourneyId(preferred);
  }, [journeyId, journeys, selectedJourneyId]);

  useEffect(() => {
    if (
      selectedJourneyId === undefined ||
      selectedJourneyId === null ||
      selectedJourneyId === journeyId ||
      !journeys.some((item) => item.id === selectedJourneyId)
    ) {
      return;
    }
    setJourneyId(selectedJourneyId);
  }, [journeyId, journeys, selectedJourneyId]);

  useEffect(() => {
    if (!journeyResetReady.current) {
      journeyResetReady.current = true;
      return;
    }
    setCurrentStep(1);
    setExpectedWorkspaceTab('overview');
    setCompletedSteps(new Set());
    setOutcomeState(initialOutcomeState);
    setTechnicalChecks([]);
    setNetworkEvidence(null);
    setApprovedCandidateId(null);
    setSavedVersions([]);
    setError(null);
    setShowValidation(false);
  }, [journeyId]);

  useEffect(() => {
    if (journey === null || criticalStep === null) {
      setNetworkEvidence(null);
      setApprovedCandidateId(null);
      return;
    }
    let active = true;
    setNetworkEvidenceLoading(true);
    setApprovedCandidateId(null);
    void listNetworkEvidenceCandidates(journey.id, criticalStep.id)
      .then((result) => {
        if (active) setNetworkEvidence(result);
      })
      .catch(() => {
        if (active) {
          setNetworkEvidence({
            items: [],
            source: null,
            explanation:
              'Network evidence could not be loaded. The test can still be saved with browser outcome coverage only.',
          });
        }
      })
      .finally(() => {
        if (active) setNetworkEvidenceLoading(false);
      });
    return () => {
      active = false;
    };
  }, [criticalStep, journey]);

  useEffect(() => {
    if (initialDraft === null) return;
    const hydratedStep = stepForStage(initialDraft.stage);
    setCurrentStep((current) =>
      current === hydratedStep ? current : hydratedStep,
    );
  }, [initialDraft?.stage]);

  useEffect(() => {
    if (project.id === '' || journeyId === '') return;
    const safeModes: Record<string, Exclude<SafeValueMode, 'custom'>> = {};
    for (const [stepId, mode] of Object.entries(stepValueModes)) {
      if (mode !== 'custom') safeModes[stepId] = mode;
    }
    onDraftChange?.({
      version: 1,
      projectId: project.id,
      journeyId,
      stage: stageForStep(currentStep),
      recipeId,
      replayPacing,
      experimentName,
      stepValueModes: safeModes,
    });
  }, [
    currentStep,
    experimentName,
    journeyId,
    onDraftChange,
    project.id,
    recipeId,
    replayPacing,
    stepValueModes,
  ]);

  useEffect(() => {
    const modes: Record<string, SafeValueMode> = {};
    const customValues: Record<string, string> = {};
    for (const step of configurableValueSteps) {
      const suggested = suggestedStepValueOverrides[step.id];
      modes[step.id] =
        initialDraft?.stepValueModes[step.id] ?? modeForTemplate(suggested);
      if (step.value?.kind === 'safe') customValues[step.id] = step.value.value;
    }
    setStepValueModes(modes);
    setCustomStepValues(customValues);
  }, [configurableValueSteps, initialDraft, suggestedStepValueOverrides]);

  useEffect(() => {
    if (criticalStep === null) {
      setExperimentName('');
      return;
    }
    if (
      !restoredDraftName.current &&
      initialDraft?.journeyId === journeyId &&
      initialDraft.experimentName.trim() !== ''
    ) {
      restoredDraftName.current = true;
      setExperimentName(suiteActionLabel(initialDraft.experimentName));
      return;
    }
    setExperimentName(
      boundedName(outcomeState.criticalAction?.label ?? criticalStep.name),
    );
  }, [
    criticalStep,
    initialDraft,
    journeyId,
    outcomeState.criticalAction?.label,
  ]);

  const handleOutcomeState = useCallback((state: OutcomeDefinitionState) => {
    setOutcomeState(state);
  }, []);
  const reviewOutcomeCheck = useCallback(() => {
    setExpectedWorkspaceTab('checks');
  }, []);

  function selectJourney(nextJourneyId: string): void {
    setJourneyId(nextJourneyId);
    onSelectedJourneyChange?.(nextJourneyId);
  }

  async function persistProductionAcknowledgement(
    acknowledged: boolean,
  ): Promise<void> {
    const previous = productionConfirmed;
    setProductionConfirmed(acknowledged);
    setError(null);
    try {
      const next = await saveProductionReplayAcknowledgement(
        project.id,
        acknowledged,
      );
      onAuthenticationRecaptured(next);
      setProductionConfirmed(next.productionReplayAcknowledged === true);
    } catch (reason: unknown) {
      setProductionConfirmed(previous);
      setError(messageOf(reason));
    }
  }

  function completeStep(step: WizardStep): void {
    setCompletedSteps((current) => new Set([...current, step]));
  }

  function navigateToStep(step: WizardStep): void {
    setCurrentStep(step);
    onStageChange?.(stageForStep(step));
  }

  function continueFromExpectedOutcome(): void {
    setShowValidation(true);
    if (expectedBlockers.length > 0) return;
    completeStep(1);
    navigateToStep(2);
    setShowValidation(false);
    setError(null);
  }

  async function saveTest(): Promise<boolean> {
    setShowValidation(true);
    if (
      submissionPending.current ||
      busy !== null ||
      journey === null ||
      criticalStep === null ||
      reviewBlockers.length > 0
    ) {
      return false;
    }
    submissionPending.current = true;
    setBusy('save');
    setError(null);
    setSavedVersions([]);
    try {
      const tests: CreateExternalExperimentRequest[] = guidedRecipes.map(
        (item) => ({
          name: boundedName(
            `${approvedCandidate === null ? 'Browser-only ' : ''}${item.shortName}: ${suiteActionLabel(experimentName)}`,
          ),
          targetStepId: criticalStep.id,
          triggerCount: item.triggerCount,
          intervalMs: item.intervalMs,
          networkMatcher:
            approvedCandidate === null
              ? null
              : matcherForCandidate(approvedCandidate),
          assertions: [
            ...technicalChecks,
            ...(approvedCandidate === null
              ? []
              : recipeNetworkAssertions(
                  item.id,
                  item.triggerCount,
                  approvedCandidate,
                )),
          ],
          continueAfterTarget: false,
          guided: true,
          normalizeJourney: true,
          requestSelectionProvenance: null,
          networkEvidenceProvenance:
            approvedCandidate === null
              ? null
              : provenanceForCandidate(approvedCandidate),
          assertionSelectionProvenance: [],
          stepValueOverrides,
        }),
      );
      const versions = await createExternalExperimentSuite(journey.id, {
        tests,
      });
      setSavedVersions(versions);
      completeStep(3);
      onSaved(versions);
      return true;
    } catch (reason: unknown) {
      setError(messageOf(reason));
      return false;
    } finally {
      submissionPending.current = false;
      setBusy(null);
    }
  }

  if (journeys.length === 0) {
    return (
      <div className="guided-test guided-wizard-empty">
        <div className="panel guided-onboarding">
          <div>
            <p className="eyebrow">Test</p>
            <h2>Set up your first test</h2>
            <p>
              Record and save one successful journey before defining its
              expected result and repeated-submission experiment.
            </p>
          </div>
          <div className="guided-action-row">
            <a className="button button-primary" href="#recording-workspace">
              Go to journey recording
            </a>
            <Link
              className="button button-secondary"
              href={`/projects/${project.id}/settings`}
            >
              Set up authentication
            </Link>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="guided-test guided-wizard">
      <header className="guided-wizard-header">
        <div>
          <p className="eyebrow">Test</p>
          <h2 aria-label="Define the outcome, check safety, then save">
            {project.name}
          </h2>
          <p>
            Set up the expected result, review safety, then save one reusable
            test. Saving does not run the journey.
          </p>
        </div>
      </header>

      <WizardProgress
        completedSteps={completedSteps}
        currentStep={currentStep}
        onNavigate={navigateToStep}
      />

      {error !== null ? (
        <StateMessage variant="error">{error}</StateMessage>
      ) : null}

      <section
        aria-labelledby="guided-expected-title"
        className="guided-wizard-stage guided-wizard-stage-expected"
        hidden={currentStep !== 1}
      >
        <WizardStageHeading
          description="Define the specific browser-visible or state-based evidence that proves the Critical Action succeeded."
          step="Step 1 of 3"
          title="What should be true after this action?"
        />

        <div className="guided-context-grid">
          <ContextFact label="Project" value={project.name} />
          <label className="guided-context-select">
            Journey and immutable version
            <select
              aria-label="Scenario journey version"
              value={journeyId}
              onChange={(event) => selectJourney(event.target.value)}
            >
              {journeys.map((item) => (
                <option key={item.id} value={item.id}>
                  {item.name} v{item.version}
                </option>
              ))}
            </select>
          </label>
          <ContextFact
            label="Critical Action"
            value={outcomeState.criticalAction?.label ?? 'Not configured'}
          />
          <ContextFact
            label="Saved Outcome Checks"
            value={String(outcomeState.checks.length)}
          />
        </div>

        <nav
          aria-label="Expected Outcome workspace"
          className="expected-workspace-tabs"
          role="tablist"
        >
          <button
            aria-controls="expected-overview-panel"
            aria-selected={expectedWorkspaceTab === 'overview'}
            id="expected-overview-tab"
            onClick={() => setExpectedWorkspaceTab('overview')}
            role="tab"
            type="button"
          >
            <span>Overview</span>
            <small>{expectedBlockers.length} remaining</small>
          </button>
          <button
            aria-controls="expected-configuration-panel"
            aria-selected={expectedWorkspaceTab === 'action'}
            id="expected-action-tab"
            onClick={() => setExpectedWorkspaceTab('action')}
            role="tab"
            type="button"
          >
            <span>Critical Action</span>
            <small>
              {outcomeState.criticalAction === null
                ? 'Needs setup'
                : 'Configured'}
            </small>
          </button>
          <button
            aria-controls="expected-configuration-panel"
            aria-selected={expectedWorkspaceTab === 'checks'}
            id="expected-checks-tab"
            onClick={() => setExpectedWorkspaceTab('checks')}
            role="tab"
            type="button"
          >
            <span>Outcome Checks</span>
            <small>{outcomeState.checks.length} saved</small>
          </button>
        </nav>

        <div
          aria-labelledby="expected-overview-tab"
          className="expected-workspace-panel expected-overview-panel"
          hidden={expectedWorkspaceTab !== 'overview'}
          id="expected-overview-panel"
          role="tabpanel"
        >
          {outcomeState.loading ? (
            <StateMessage variant="loading">
              Loading the saved Critical Action and Outcome Checks…
            </StateMessage>
          ) : null}
          {outcomeState.error !== null ? (
            <StateMessage variant="error">{outcomeState.error}</StateMessage>
          ) : null}
          <div
            aria-label="Saved Outcome Check coverage"
            className="guided-outcome-type-grid"
          >
            <OutcomeTypeCard
              count={
                outcomeState.checks.filter(
                  (check) =>
                    check.type === 'matching_item_appears_exactly_once',
                ).length
              }
              description="Proves one browser-visible result matches the approved run-specific identity."
              title="Exactly one matching record appears"
            />
            <OutcomeTypeCard
              count={
                outcomeState.checks.filter(
                  (check) => check.type === 'visible_element_exists',
                ).length
              }
              description="Proves the approved confirmation element is visible after the action."
              title="A confirmation element appears"
            />
            <OutcomeTypeCard
              count={
                outcomeState.checks.filter(
                  (check) => check.type === 'final_pathname_matches',
                ).length
              }
              description="Proves the browser finishes on the approved path without inventing a business result."
              title="The browser reaches a specific page"
            />
          </div>

          <div className="expected-next-task">
            <div>
              <p className="eyebrow">Next required task</p>
              <h3>
                {outcomeState.criticalAction === null
                  ? 'Choose the state-changing action'
                  : outcomeState.checks.length === 0
                    ? 'Capture a successful baseline'
                    : 'Expected Outcome is ready'}
              </h3>
              <p>
                {outcomeState.criticalAction === null
                  ? 'Approve the recorded click or submit that the test will repeat.'
                  : outcomeState.checks.length === 0
                    ? 'Replay the saved journey once, then approve at least one browser-visible result.'
                    : 'The saved Critical Action and Outcome Checks are ready for Safety & Data review.'}
              </p>
            </div>
            {expectedBlockers.length > 0 ? (
              <Button
                onClick={() => setExpectedWorkspaceTab('action')}
                variant="primary"
              >
                Open Critical Action
              </Button>
            ) : (
              <StatusBadge tone="pass">Ready</StatusBadge>
            )}
          </div>

          {expectedBlockers.length > 0 ? (
            <BlockingReasons
              heading="Expected Outcome is incomplete"
              reasons={expectedBlockers}
              visible={showValidation || !outcomeState.loading}
            />
          ) : (
            <StateMessage>
              Every saved Outcome Check will be evaluated by the existing
              runner.
            </StateMessage>
          )}
        </div>

        {journey !== null &&
        outcomeState.checks.length === 0 &&
        runtimeRequirements.length > 0 &&
        expectedWorkspaceTab === 'action' ? (
          <div className="guided-baseline-prerequisites">
            <RuntimeInputs
              labelPrefix="Baseline"
              requirements={runtimeRequirements}
              runtimeValues={runtimeValues}
              setRuntimeValues={setRuntimeValues}
            />
          </div>
        ) : null}

        {journey === null ? (
          <StateMessage variant="error">
            The selected journey version no longer exists.
          </StateMessage>
        ) : (
          <div
            aria-labelledby={
              expectedWorkspaceTab === 'checks'
                ? 'expected-checks-tab'
                : 'expected-action-tab'
            }
            className="expected-workspace-panel"
            hidden={expectedWorkspaceTab === 'overview'}
            id="expected-configuration-panel"
            role="tabpanel"
          >
            <OutcomeDefinitionPanel
              activeSection={
                expectedWorkspaceTab === 'checks' ? 'checks' : 'action'
              }
              confirmProduction={productionConfirmed}
              disabled={
                missingRuntime.length > 0 ||
                productionBlocked ||
                settings === null
              }
              environment={project.environment}
              id="guided-outcome-configuration"
              journey={journey}
              onReviewRequested={reviewOutcomeCheck}
              onStateChange={handleOutcomeState}
              presentation="wizard"
              productionConfirmation={
                project.environment === 'production' ? (
                  <ProductionConfirmation
                    checked={productionConfirmed}
                    onChange={(acknowledged) =>
                      void persistProductionAcknowledgement(acknowledged)
                    }
                  />
                ) : undefined
              }
              runtimeValues={runtimeValues}
            />
          </div>
        )}

        <WizardActions>
          <span />
          <Button
            className="guided-wizard-primary"
            disabled={busy !== null || expectedBlockers.length > 0}
            onClick={continueFromExpectedOutcome}
            variant="primary"
          >
            Continue to Safety &amp; Data
          </Button>
        </WizardActions>
      </section>

      {currentStep === 2 ? (
        <section
          aria-labelledby="guided-safety-title"
          className="guided-wizard-stage guided-wizard-stage-safety"
        >
          <WizardStageHeading
            description="Can this experiment replay deterministically without hiding its data risks?"
            step="Step 2 of 3"
            title="Safety & Data"
          />

          <div className="guided-safety-layout">
            <div className="guided-safety-main">
              <div className="guided-safety-grid">
                <SafetyCard
                  detail={`${new URL(project.targetUrl).origin} · ${project.environment}`}
                  status={
                    project.environment === 'production' ? 'Review' : 'Ready'
                  }
                  title="Target origin"
                  tone={
                    project.environment === 'production' ? 'warning' : 'pass'
                  }
                />
                <SafetyCard
                  detail={
                    settings?.authentication.available === true
                      ? 'Saved authentication available. The replay browser can restore the captured state.'
                      : 'No saved authentication. FormCrash may discover during replay that authentication is required.'
                  }
                  status={
                    settings?.authentication.available === true
                      ? 'Available'
                      : 'Unknown requirement'
                  }
                  title="Authentication"
                  tone={
                    settings?.authentication.available === true
                      ? 'pass'
                      : 'neutral'
                  }
                />
                <SafetyCard
                  detail={
                    missingRuntime.length === 0
                      ? 'All required values are available without exposing their contents.'
                      : `${missingRuntime.length} required value${missingRuntime.length === 1 ? '' : 's'} must be provided for this browser session.`
                  }
                  status={
                    missingRuntime.length === 0 ? 'Ready' : 'Missing values'
                  }
                  title="Runtime variables"
                  tone={missingRuntime.length === 0 ? 'pass' : 'warning'}
                />
                <SafetyCard
                  detail={recordedEnvironmentSummary(journey)}
                  status={
                    journey?.replayFormat === 'hybrid-v2'
                      ? 'Recorded trace'
                      : 'Semantic replay'
                  }
                  title="Recorded environment"
                  tone="browser"
                />
              </div>

              {runtimeRequirements.length > 0 ? (
                <div className="guided-safety-section">
                  <h4>Runtime values for the first explicit run</h4>
                  <p>
                    These values are not persisted with the test and are not
                    required to save it. Secret values remain masked.
                  </p>
                  <RuntimeInputs
                    labelPrefix="Runtime"
                    requirements={runtimeRequirements}
                    runtimeValues={runtimeValues}
                    setRuntimeValues={setRuntimeValues}
                  />
                </div>
              ) : (
                <StateMessage>
                  No unresolved runtime variables are required for this journey.
                </StateMessage>
              )}

              {configurableValueSteps.length > 0 ? (
                <div className="guided-safety-section">
                  <h4>Generated and recorded journey values</h4>
                  <p>
                    Templates persist with the experiment snapshot; resolved
                    run-specific literals do not appear here.
                  </p>
                  <div className="guided-value-grid">
                    {configurableValueSteps.map((step) => {
                      const mode = stepValueModes[step.id] ?? 'recorded';
                      return (
                        <div className="guided-value-card" key={step.id}>
                          <label>
                            {step.name}
                            <select
                              aria-label={`${step.name} value source`}
                              value={mode}
                              onChange={(event) =>
                                setStepValueModes((current) => ({
                                  ...current,
                                  [step.id]: event.target
                                    .value as SafeValueMode,
                                }))
                              }
                            >
                              <option value="recorded">
                                Recorded saved value
                              </option>
                              <option value="unique_text">
                                {'{{unique.text}}'}
                              </option>
                              <option value="uuid">{'{{run.id}}'}</option>
                              <option value="unique_name">
                                {'{{unique.name}}'}
                              </option>
                              <option value="unique_email">
                                {'{{unique.email}}'}
                              </option>
                              <option value="unique_phone">
                                {'{{unique.phone}}'}
                              </option>
                              <option value="custom">
                                Custom value or template
                              </option>
                            </select>
                          </label>
                          {mode === 'custom' ? (
                            <label>
                              Unsaved value or template
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
                          ) : mode !== 'recorded' ? (
                            <code>{generatedTemplateByMode[mode]}</code>
                          ) : (
                            <small>
                              The stored literal is intentionally not previewed.
                            </small>
                          )}
                        </div>
                      );
                    })}
                  </div>
                </div>
              ) : null}

              <div className="guided-safety-section">
                <div className="section-heading-row compact-heading">
                  <div>
                    <h4>Failure recipe and replay pacing</h4>
                    <p>
                      Replay pacing affects normal journey steps. It does not
                      change the repeated-trigger interval.
                    </p>
                  </div>
                </div>
                <fieldset className="guided-recipe-selector">
                  <legend>Generated Test suite</legend>
                  <p>
                    Saving creates all three sibling Tests from this Journey and
                    its approved Outcome Checks.
                  </p>
                  <div className="guided-recipe-grid">
                    {guidedRecipes.map((item) => (
                      <div
                        className="guided-recipe-card guided-recipe-card-selected"
                        key={item.id}
                      >
                        <span>
                          <strong>{item.name}</strong>
                          <small>{item.description}</small>
                        </span>
                      </div>
                    ))}
                  </div>
                </fieldset>
                <NetworkEvidenceApproval
                  approvedCandidate={approvedCandidate}
                  evidence={networkEvidence}
                  loading={networkEvidenceLoading}
                  onApprove={setApprovedCandidateId}
                  onRemove={() => setApprovedCandidateId(null)}
                />
                <fieldset className="guided-pacing-selector">
                  <legend>Replay pacing</legend>
                  <div className="guided-pacing-options">
                    {(
                      [
                        ['recorded', 'Recorded', 'Use captured human pauses.'],
                        [
                          'deliberate',
                          'Deliberate',
                          'Wait one second at normal steps.',
                        ],
                        ['fast', 'Fast', 'Add no normal-step pauses.'],
                      ] as const
                    ).map(([value, label, detail]) => (
                      <label key={value}>
                        <input
                          checked={replayPacing === value}
                          name="guided-replay-pacing"
                          onChange={() => setReplayPacing(value)}
                          type="radio"
                        />
                        <span>
                          <strong>{label}</strong>
                          <small>{detail}</small>
                        </span>
                      </label>
                    ))}
                  </div>
                </fieldset>
              </div>

              <div className="guided-hook-grid">
                <HookSummary
                  hook={settings?.beforeRunHook ?? null}
                  title="Before hook"
                />
                <HookSummary
                  hook={settings?.afterRunHook ?? null}
                  title="Cleanup hook"
                />
              </div>

              {settings?.afterRunHook === null ? (
                <StateMessage variant="warning">
                  Test data may be created or modified. Cleanup is not
                  guaranteed; remove residue manually when no cleanup hook is
                  configured.
                </StateMessage>
              ) : (
                <StateMessage>
                  The saved cleanup hook will run after test execution, but
                  external cleanup still cannot be guaranteed.
                </StateMessage>
              )}

              {project.environment === 'production' ? (
                <ProductionConfirmation
                  checked={productionConfirmed}
                  onChange={(acknowledged) =>
                    void persistProductionAcknowledgement(acknowledged)
                  }
                />
              ) : null}

              <DisclosurePanel
                description="Known browser and target boundaries"
                title="CAPTCHA and unsupported interactions"
              >
                <p>
                  FormCrash does not evade real CAPTCHA challenges. Use test
                  keys, a staging bypass, WAF allowlisting, or authorized test
                  accounts.
                </p>
                <p>
                  File uploads, third-party payment flows, unsupported frames,
                  shadow DOM, and changed locators may still stop replay. The
                  saved journey reports{' '}
                  {journey?.recordingMetadata.warningCount ?? 0} recorder
                  warning(s), but this contract does not expose their individual
                  codes.
                </p>
              </DisclosurePanel>
            </div>
            <aside
              className="guided-safety-sidebar"
              aria-label="Safety review and actions"
            >
              <div
                className={`guided-production-summary${project.environment === 'production' ? ' is-production' : ''}`}
              >
                <strong>
                  {project.environment === 'production'
                    ? 'Production safety'
                    : 'Controlled target'}
                </strong>
                <p>
                  {project.environment === 'production'
                    ? 'This test performs real actions against the configured production target.'
                    : `This run targets the saved ${project.environment} environment.`}
                </p>
              </div>

              {readiness !== null ? (
                <div className="guided-readiness-compact">
                  <StatusBadge
                    tone={readiness.status === 'blocked' ? 'warning' : 'pass'}
                  >
                    {readiness.status === 'blocked'
                      ? 'Needs required data'
                      : 'Safety inputs ready'}
                  </StatusBadge>
                  <span>
                    {readiness.blockerCount} blocker(s) ·{' '}
                    {readiness.warningCount} warning(s)
                  </span>
                </div>
              ) : (
                <StateMessage variant="loading">
                  Loading project execution settings…
                </StateMessage>
              )}

              {safetyBlockers.length > 0 ? (
                <BlockingReasons
                  heading="Safety & Data is incomplete"
                  reasons={safetyBlockers}
                  visible
                />
              ) : (
                <StateMessage>
                  No request-discovery replay is required. The actual test run
                  will repeat the approved Critical Action and evaluate the
                  saved Outcome Checks.
                </StateMessage>
              )}

              <WizardActions>
                <Button onClick={() => navigateToStep(1)}>Back</Button>
                <Button
                  className="guided-wizard-primary"
                  disabled={busy !== null || safetyBlockers.length > 0}
                  onClick={() => {
                    completeStep(2);
                    navigateToStep(3);
                    setShowValidation(false);
                  }}
                  variant="primary"
                >
                  Review &amp; Save
                </Button>
              </WizardActions>
            </aside>
          </div>
        </section>
      ) : null}

      {currentStep === 3 ? (
        <section
          aria-labelledby="guided-review-title"
          className="guided-wizard-stage guided-wizard-stage-review"
        >
          <WizardStageHeading
            description="Review the exact local choices and saved entities the existing runner will use."
            step="Step 3 of 3"
            title="Review & Save"
          />

          <div className="guided-review-layout">
            <div className="guided-review-main">
              <div className="guided-review-callout">
                <StatusBadge
                  tone={reviewBlockers.length === 0 ? 'pass' : 'warning'}
                >
                  {reviewBlockers.length === 0 ? 'Ready to save' : 'Blocked'}
                </StatusBadge>
                <p>
                  FormCrash will save Double-click, Triple-click, and Delayed
                  repeat as three sibling Tests for{' '}
                  {outcomeState.criticalAction?.label ?? 'the Critical Action'}.
                </p>
              </div>

              <label className="guided-experiment-name">
                Action label
                <input
                  aria-describedby="guided-experiment-name-note"
                  maxLength={160}
                  value={experimentName}
                  onChange={(event) => setExperimentName(event.target.value)}
                />
                <small id="guided-experiment-name-note">
                  Each generated Test prefixes this label with its recipe name.
                </small>
              </label>

              <div className="guided-review-grid">
                <ReviewGroup title="Target and recording">
                  <ReviewRow label="Project" value={project.name} />
                  <ReviewRow
                    label="Target"
                    value={project.targetUrl}
                    technical
                  />
                  <ReviewRow
                    label="Journey"
                    value={`${journey?.name ?? 'Missing'} v${journey?.version ?? '—'}`}
                  />
                  <ReviewRow
                    label="Recorded steps"
                    value={`${journey?.steps.length ?? 0} · ${journey?.replayFormat ?? 'semantic-v1'}`}
                  />
                  <ReviewRow
                    label="Critical Action"
                    value={outcomeState.criticalAction?.label ?? 'Missing'}
                  />
                </ReviewGroup>
                <ReviewGroup title="Repeated submission">
                  <ReviewRow label="Generated Tests" value="3 sibling Tests" />
                  <ReviewRow
                    label="Recipes"
                    value="Double-click Â· Triple-click Â· Delayed repeat"
                  />
                  <ReviewRow
                    label="Continuation"
                    value="Stop after Critical Action"
                  />
                  <ReviewRow label="Replay mode" value="Adaptive" />
                  <ReviewRow
                    label="Replay pacing"
                    value={pacingLabel(replayPacing)}
                  />
                  <ReviewRow
                    label="Coverage"
                    value={
                      approvedCandidate === null
                        ? 'Browser outcome coverage only'
                        : `Browser and approved ${approvedCandidate.source === 'recording' ? 'recording' : 'prior-run'} network coverage`
                    }
                  />
                </ReviewGroup>
                <ReviewGroup title="Readiness">
                  <ReviewRow
                    label="Authentication"
                    value={
                      settings?.authentication.available === true
                        ? 'Saved authentication available'
                        : 'No saved authentication; requirement unknown until replay'
                    }
                  />
                  <ReviewRow
                    label="Runtime variables"
                    value={
                      missingRuntime.length === 0
                        ? 'Ready'
                        : `${missingRuntime.length} missing`
                    }
                  />
                  <ReviewRow
                    label="Generated templates"
                    value={
                      generatedTemplates.length === 0
                        ? 'None'
                        : generatedTemplates.join(', ')
                    }
                    technical
                  />
                  <ReviewRow
                    label="Before hook"
                    value={safeHookSummary(settings?.beforeRunHook ?? null)}
                  />
                  <ReviewRow
                    label="Cleanup"
                    value={safeHookSummary(settings?.afterRunHook ?? null)}
                  />
                  <ReviewRow
                    label="Production confirmation"
                    value={
                      project.environment !== 'production'
                        ? 'Not applicable'
                        : productionConfirmed
                          ? 'Saved for this project'
                          : 'Needed only when running'
                    }
                  />
                </ReviewGroup>
              </div>

              <div className="guided-review-outcomes">
                <div className="section-heading-row compact-heading">
                  <div>
                    <h4>Saved Outcome Checks</h4>
                    <p>
                      All saved checks are evaluated; this runner has no per-run
                      subset.
                    </p>
                  </div>
                  <StatusBadge
                    tone={outcomeState.checks.length > 0 ? 'pass' : 'warning'}
                  >
                    {outcomeState.checks.length} saved
                  </StatusBadge>
                </div>
                {outcomeState.checks.length > 0 ? (
                  <ol>
                    {outcomeState.checks.map((check) => (
                      <li key={check.id}>
                        <strong>{outcomeCheckTypeLabel(check.type)}</strong>
                        <span>{describeOutcomeCheck(check)}</span>
                      </li>
                    ))}
                  </ol>
                ) : (
                  <p>No saved Outcome Checks are available.</p>
                )}
              </div>

              {journey === null ? null : (
                <TechnicalChecksEditor
                  assertions={technicalChecks}
                  journey={journey}
                  onChange={setTechnicalChecks}
                />
              )}

              <StateMessage
                variant={
                  settings?.afterRunHook === null ? 'warning' : 'neutral'
                }
              >
                {settings?.afterRunHook === null
                  ? 'Test data may remain after the run because no cleanup hook is configured.'
                  : 'The cleanup hook is configured, but cleanup by an external target is not guaranteed.'}
              </StateMessage>

              <DisclosurePanel
                description="Outcome evidence and browser checks"
                title="How FormCrash will measure this"
              >
                <p>
                  The run evaluates every approved Outcome Check and{' '}
                  {technicalChecks.length} optional Technical check(s). Outcome
                  Checks are not duplicated as technical assertions, and the
                  test does not perform a separate request-discovery replay
                  first.
                </p>
              </DisclosurePanel>
            </div>
            <aside
              className="guided-review-sidebar"
              aria-label="Save checks and action"
            >
              <h4>Save checks</h4>
              <div className="guided-preflight-list">
                <span>
                  Outcome Checks{' '}
                  <strong>{outcomeState.checks.length} saved</strong>
                </span>
                <span>
                  Runtime values{' '}
                  <strong>
                    {missingRuntime.length === 0
                      ? 'Ready'
                      : `${missingRuntime.length} missing`}
                  </strong>
                </span>
                <span>
                  Cleanup{' '}
                  <strong>
                    {settings?.afterRunHook === null
                      ? 'Not configured'
                      : 'Configured'}
                  </strong>
                </span>
              </div>

              <DisclosurePanel
                description="CAPTCHA and unsupported browser boundaries"
                title="Execution boundaries"
              >
                <p>
                  FormCrash does not bypass real CAPTCHA challenges. Changed
                  pages, unsupported frames, uploads, payment providers, or
                  brittle locators may stop execution before the checks can be
                  evaluated.
                </p>
              </DisclosurePanel>

              {reviewBlockers.length > 0 ? (
                <BlockingReasons
                  heading="Save is blocked"
                  reasons={reviewBlockers}
                  visible
                />
              ) : null}

              {busy === 'save' ? (
                <StateMessage variant="loading">
                  Saving three new Tests without running them…
                </StateMessage>
              ) : null}
              {savedVersions.length > 0 ? (
                <StateMessage>
                  Three Tests saved as Version 1. Run each explicitly from the
                  Tests list.
                </StateMessage>
              ) : null}

              <WizardActions>
                <Button
                  disabled={busy !== null}
                  onClick={() => navigateToStep(2)}
                >
                  Back to Safety &amp; Data
                </Button>
                <Button
                  aria-describedby={
                    reviewBlockers.length > 0
                      ? 'guided-action-blockers'
                      : undefined
                  }
                  className="guided-wizard-primary"
                  disabled={
                    busy !== null ||
                    reviewBlockers.length > 0 ||
                    savedVersions.length > 0
                  }
                  onClick={() => void saveTest()}
                  variant="primary"
                >
                  {busy === 'save'
                    ? 'Saving Test suite…'
                    : savedVersions.length > 0
                      ? 'Test suite saved'
                      : 'Save 3-Test suite'}
                </Button>
              </WizardActions>
            </aside>
          </div>
        </section>
      ) : null}
    </div>
  );
}

function OutcomeTypeCard({
  count,
  description,
  title,
}: {
  readonly count: number;
  readonly description: string;
  readonly title: string;
}) {
  return (
    <article className={count > 0 ? 'is-configured' : undefined}>
      <div className="guided-outcome-type-icon" aria-hidden="true">
        {count > 0 ? '✓' : '○'}
      </div>
      <strong>{title}</strong>
      <p>{description}</p>
      <span>{count > 0 ? `${count} saved` : 'Not configured'}</span>
    </article>
  );
}

function WizardProgress({
  currentStep,
  completedSteps,
  onNavigate,
}: {
  readonly currentStep: WizardStep;
  readonly completedSteps: ReadonlySet<number>;
  readonly onNavigate: (step: WizardStep) => void;
}) {
  const steps = [
    [1, 'Expected Outcome'],
    [2, 'Safety & Data'],
    [3, 'Review & Save'],
  ] as const;
  return (
    <nav aria-label="Test setup progress" className="guided-wizard-progress">
      <ol>
        {steps.map(([step, label]) => {
          const current = currentStep === step;
          const complete = completedSteps.has(step);
          const canNavigate = step < currentStep || complete;
          return (
            <li
              className={`${current ? 'is-current' : ''} ${complete ? 'is-complete' : ''}`}
              key={step}
            >
              <button
                aria-current={current ? 'step' : undefined}
                disabled={!canNavigate || current}
                onClick={() => onNavigate(step)}
                type="button"
              >
                <span aria-hidden="true">
                  {complete && !current ? '✓' : step}
                </span>
                <span>
                  <small>Step {step}</small>
                  <strong>{label}</strong>
                </span>
              </button>
            </li>
          );
        })}
      </ol>
      <p className="sr-only" role="status">
        Current step: {steps[currentStep - 1]?.[1]}
      </p>
    </nav>
  );
}

function WizardStageHeading({
  step,
  title,
  description,
}: {
  readonly step: string;
  readonly title: string;
  readonly description: string;
}) {
  const id = step.startsWith('Step 1')
    ? 'guided-expected-title'
    : step.startsWith('Step 2')
      ? 'guided-safety-title'
      : 'guided-review-title';
  return (
    <div className="guided-wizard-stage-heading">
      <p className="eyebrow">{step}</p>
      <h3
        aria-label={step.startsWith('Step 1') ? 'Expected Outcome' : undefined}
        id={id}
      >
        {title}
      </h3>
      <p>{description}</p>
    </div>
  );
}

function ContextFact({
  label,
  value,
}: {
  readonly label: string;
  readonly value: string;
}) {
  return (
    <div className="guided-context-fact">
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

function SafetyCard({
  title,
  status,
  detail,
  tone,
}: {
  readonly title: string;
  readonly status: string;
  readonly detail: string;
  readonly tone: 'pass' | 'warning' | 'neutral' | 'browser';
}) {
  return (
    <article className="guided-safety-card">
      <div>
        <h4>{title}</h4>
        <StatusBadge tone={tone}>{status}</StatusBadge>
      </div>
      <p>{detail}</p>
    </article>
  );
}

function NetworkEvidenceApproval({
  evidence,
  loading,
  approvedCandidate,
  onApprove,
  onRemove,
}: {
  readonly evidence: NetworkEvidenceCandidateList | null;
  readonly loading: boolean;
  readonly approvedCandidate: NetworkEvidenceCandidate | null;
  readonly onApprove: (candidateId: string) => void;
  readonly onRemove: () => void;
}) {
  if (loading) {
    return (
      <StateMessage variant="loading">
        Loading sanitized request evidence from the saved recordingâ€¦
      </StateMessage>
    );
  }
  if (approvedCandidate !== null) {
    return (
      <div className="guided-safety-section">
        <div className="section-heading-row compact-heading">
          <div>
            <h4>Approved network evidence</h4>
            <p>
              {approvedCandidate.method} {approvedCandidate.host}
              {approvedCandidate.pathname}
            </p>
          </div>
          <StatusBadge tone="pass">
            {approvedCandidate.source === 'recording'
              ? 'Recording approved'
              : 'Prior run approved'}
          </StatusBadge>
        </div>
        <StateMessage>
          Each generated recipe will enforce its bounded request attempts, at
          most one successful response, and no HTTP 5xx. Delayed repeat also
          allows the approved HTTP {approvedCandidate.status} or 409 response
          set.
        </StateMessage>
        <Button onClick={onRemove}>Use browser outcomes only</Button>
      </div>
    );
  }
  if (evidence === null || evidence.items.length === 0) {
    return (
      <StateMessage variant="warning">
        <strong>Browser outcome coverage only.</strong>{' '}
        {evidence?.explanation ??
          'No approved request matcher is available, so request counts, response statuses, and server-error protection are not evaluated.'}
      </StateMessage>
    );
  }
  return (
    <div className="guided-safety-section">
      <div className="section-heading-row compact-heading">
        <div>
          <h4>Optional network evidence</h4>
          <p>{evidence.explanation}</p>
        </div>
        <StatusBadge tone="warning">Approval required</StatusBadge>
      </div>
      <p>
        FormCrash stores only method, origin/host, pathname, status, failure,
        and timing. Headers, bodies, cookies, authorization, secrets, and query
        strings are excluded.
      </p>
      <div className="guided-value-grid">
        {evidence.items.slice(0, 5).map((candidate) => {
          const approvable = candidateCanBeApproved(candidate);
          return (
            <article className="guided-value-card" key={candidate.candidateId}>
              <strong>
                {candidate.method} {candidate.pathname}
              </strong>
              <small>
                {candidate.host} Â· HTTP {candidate.status ?? 'unavailable'} Â·{' '}
                {candidate.relativeTimestampMs} ms after action Â· score{' '}
                {candidate.score}
              </small>
              <Button
                disabled={!approvable}
                onClick={() => onApprove(candidate.candidateId)}
                variant="secondary"
              >
                {approvable ? 'Use this request' : 'Not safe to approve'}
              </Button>
            </article>
          );
        })}
      </div>
      <StateMessage variant="warning">
        <strong>
          Browser outcome coverage only until you approve a request.
        </strong>{' '}
        Candidate display alone never enables or claims server protection.
      </StateMessage>
    </div>
  );
}

function RuntimeInputs({
  labelPrefix,
  requirements,
  runtimeValues,
  setRuntimeValues,
}: {
  readonly labelPrefix: string;
  readonly requirements: readonly {
    readonly name: string;
    readonly label: string;
    readonly secret: boolean;
  }[];
  readonly runtimeValues: EphemeralRuntimeValues;
  readonly setRuntimeValues: Dispatch<SetStateAction<EphemeralRuntimeValues>>;
}) {
  return (
    <div className="runtime-value-grid">
      {requirements.map((requirement) => (
        <label key={requirement.name}>
          {requirement.label}
          <span className="guided-source-label">
            {requirement.secret
              ? 'Secret · this session only'
              : 'This session only'}
          </span>
          <input
            aria-label={`${labelPrefix} ${requirement.name}`}
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
  );
}

function ProductionConfirmation({
  checked,
  onChange,
}: {
  readonly checked: boolean;
  readonly onChange: (checked: boolean) => void;
}) {
  return (
    <label className="production-confirmation guided-production-confirmation">
      <input
        checked={checked}
        onChange={(event) => onChange(event.target.checked)}
        type="checkbox"
      />
      <span>
        <strong>I confirm this test may change production data.</strong>
        <small>
          Saved for this project until you turn it off. Outcome capture and test
          runs can perform real actions against this target.
        </small>
      </span>
    </label>
  );
}

function HookSummary({
  title,
  hook,
}: {
  readonly title: string;
  readonly hook: ProjectExecutionSettings['beforeRunHook'];
}) {
  return (
    <article className="guided-hook-card">
      <div>
        <h4>{title}</h4>
        <StatusBadge tone={hook === null ? 'neutral' : 'pass'}>
          {hook === null ? 'Not configured' : 'Configured'}
        </StatusBadge>
      </div>
      <p>{safeHookSummary(hook)}</p>
    </article>
  );
}

function BlockingReasons({
  heading,
  reasons,
  visible,
}: {
  readonly heading: string;
  readonly reasons: readonly string[];
  readonly visible: boolean;
}) {
  if (!visible) return null;
  return (
    <div
      className="guided-blocking-reasons"
      id={heading.endsWith('is blocked') ? 'guided-action-blockers' : undefined}
      role="status"
    >
      <strong>{heading}</strong>
      <ul>
        {reasons.map((reason) => (
          <li key={reason}>{reason}</li>
        ))}
      </ul>
    </div>
  );
}

function WizardActions({ children }: { readonly children: ReactNode }) {
  return <div className="guided-wizard-actions">{children}</div>;
}

function ReviewGroup({
  title,
  children,
}: {
  readonly title: string;
  readonly children: ReactNode;
}) {
  return (
    <section className="guided-review-group">
      <h4>{title}</h4>
      <dl>{children}</dl>
    </section>
  );
}

function ReviewRow({
  label,
  value,
  technical = false,
}: {
  readonly label: string;
  readonly value: string;
  readonly technical?: boolean;
}) {
  return (
    <div>
      <dt>{label}</dt>
      <dd className={technical ? 'technical-value' : undefined}>{value}</dd>
    </div>
  );
}

function recordedEnvironmentSummary(journey: PersistedJourney | null): string {
  if (journey === null) return 'No journey version is selected.';
  if (journey.replayFormat === 'hybrid-v2' && journey.trace !== null) {
    return 'A hybrid trace is available. The runner restores its recorded environment when the trace is opened; the journey summary does not expose raw environment values.';
  }
  return 'This semantic recording does not expose a recorded environment manifest. Replay uses the existing semantic compatibility path.';
}

function safeHookSummary(
  hook: ProjectExecutionSettings['beforeRunHook'],
): string {
  if (hook === null) return 'Not configured';
  const url = new URL(hook.url);
  return `${hook.method} ${url.origin}${url.pathname}`;
}

function safeGeneratedTemplates(
  settings: ProjectExecutionSettings | null,
  stepValueOverrides: Readonly<Record<string, string>>,
): readonly string[] {
  const values = [
    ...Object.values(stepValueOverrides),
    ...(settings?.variables
      .filter((variable) => !variable.secret && variable.template !== null)
      .map((variable) => variable.template ?? '') ?? []),
  ];
  const templates = new Set<string>();
  for (const value of values) {
    for (const match of value.matchAll(
      /\{\{(?:unique\.(?:email|name|phone|text)|run\.(?:id|shortId))\}\}/gu,
    )) {
      templates.add(match[0]);
    }
  }
  return [...templates];
}

function pacingLabel(pacing: ReplayPacing): string {
  return pacing === 'recorded'
    ? 'Recorded'
    : pacing === 'deliberate'
      ? 'Deliberate'
      : 'Fast';
}

function suiteActionLabel(value: string): string {
  return value
    .trim()
    .replace(
      /^(?:Browser-only )?(?:Double-click|Triple-click|Delayed repeat):\s*/u,
      '',
    );
}

function stageForStep(step: WizardStep): GuidedWizardStage {
  if (step === 1) return 'outcome';
  if (step === 2) return 'safety';
  return 'review';
}

function stepForStage(stage: GuidedWizardStage): WizardStep {
  if (stage === 'outcome') return 1;
  if (stage === 'safety') return 2;
  return 3;
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
