'use client';

import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import type {
  ApproveOutcomeCheckRequest,
  CriticalAction,
  EphemeralRuntimeValues,
  OutcomeCaptureSession,
  OutcomeCheck,
  OutcomeCheckType,
  PersistedJourney,
  ProjectEnvironment,
  ReplayLocator,
} from '@formcrash/contracts';

import { FormCrashApiError } from '../../../lib/api-client';
import {
  approveCriticalAction,
  approveOutcomeCheck,
  closeOutcomeCapture,
  deleteOutcomeCheck,
  getActiveOutcomeCapture,
  getCriticalAction,
  getOutcomeCapture,
  listOutcomeChecks,
  startOutcomeCapture,
} from '../api/projects';
import {
  defaultOutcomeCheckDescription,
  describeOutcomeCheck,
  outcomeCheckTypeLabel,
} from '../models/outcome-check-presentation';
import {
  AuthenticationRecoveryPanel,
  useAuthenticationGate,
} from './authentication-gate';

export function OutcomeDefinitionPanel({
  journey,
  runtimeValues,
  confirmProduction,
  environment,
  disabled,
  activeSection = 'all',
  expanded,
  id = 'journey-outcome-configuration',
  onExpandedChange,
  onReviewRequested,
  onStateChange,
  presentation = 'disclosure',
  productionConfirmation,
}: {
  readonly journey: PersistedJourney;
  readonly runtimeValues: EphemeralRuntimeValues;
  readonly confirmProduction: boolean;
  readonly environment: ProjectEnvironment;
  readonly disabled: boolean;
  readonly activeSection?: 'all' | 'action' | 'checks';
  readonly expanded?: boolean;
  readonly id?: string;
  readonly onExpandedChange?: (expanded: boolean) => void;
  readonly onReviewRequested?: () => void;
  readonly onStateChange?: (state: OutcomeDefinitionState) => void;
  readonly presentation?: 'disclosure' | 'wizard';
  readonly productionConfirmation?: ReactNode;
}) {
  const compatibleSteps = useMemo(
    () =>
      journey.steps.filter(
        (step) => step.type === 'click' || step.type === 'submit',
      ),
    [journey],
  );
  const highConfidenceSteps = compatibleSteps.filter(isHighConfidenceAction);
  const recommended =
    highConfidenceSteps.length === 1 ? highConfidenceSteps[0]! : null;
  const [criticalAction, setCriticalAction] = useState<CriticalAction | null>(
    null,
  );
  const [checks, setChecks] = useState<readonly OutcomeCheck[]>([]);
  const [stepId, setStepId] = useState(recommended?.id ?? '');
  const [actionLabel, setActionLabel] = useState(recommended?.name ?? '');
  const [capture, setCapture] = useState<OutcomeCaptureSession | null>(null);
  const [checkType, setCheckType] = useState<OutcomeCheckType>(
    'matching_item_appears_exactly_once',
  );
  const [description, setDescription] = useState(
    'Exactly one matching item should appear.',
  );
  const [bindingExpression, setBindingExpression] = useState('');
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const authentication = useAuthenticationGate({
    projectId: journey.projectId,
  });
  const initialization = useRef<{
    readonly journeyId: string;
    readonly promise: ReturnType<typeof loadOutcomeDefinition>;
  } | null>(null);
  const authenticationJourneyId = useRef(journey.id);

  useEffect(() => {
    if (authenticationJourneyId.current === journey.id) return;
    authenticationJourneyId.current = journey.id;
    authentication.complete();
  }, [authentication.complete, journey.id]);

  useEffect(() => {
    let active = true;
    setLoading(true);
    setError(null);
    if (initialization.current?.journeyId !== journey.id) {
      initialization.current = {
        journeyId: journey.id,
        promise: loadOutcomeDefinition(journey.id),
      };
    }
    void initialization.current.promise
      .then(([action, savedChecks, activeCapture]) => {
        if (!active) return;
        setCriticalAction(action);
        setChecks(savedChecks);
        setCapture(activeCapture);
        setBindingExpression(
          activeCapture?.selectedTarget?.generatedBindings[0]?.expression ?? '',
        );
        if (activeCapture?.status === 'selection_ready') {
          onReviewRequested?.();
        }
        if (action !== null) {
          setStepId(action.stepId);
          setActionLabel(action.label);
        } else {
          setStepId(recommended?.id ?? '');
          setActionLabel(
            recommended === null ? '' : actionName(recommended, journey),
          );
        }
      })
      .catch((reason: unknown) => {
        if (active) setError(messageOf(reason));
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [journey, onReviewRequested, recommended]);

  useEffect(() => {
    onStateChange?.({ checks, criticalAction, error, loading });
  }, [checks, criticalAction, error, loading, onStateChange]);

  useEffect(() => {
    if (
      capture === null ||
      ![
        'launching',
        'replaying',
        'awaiting_selection',
        'selection_ready',
        'selection_rejected',
      ].includes(capture.status)
    ) {
      return;
    }
    const timer = window.setInterval(() => {
      void getOutcomeCapture(capture.id)
        .then((next) => {
          setCapture(next);
          const firstBinding =
            next.selectedTarget?.generatedBindings[0]?.expression ?? '';
          if (firstBinding !== '') setBindingExpression(firstBinding);
          if (
            next.status === 'selection_ready' &&
            capture.status !== 'selection_ready'
          ) {
            onReviewRequested?.();
          }
        })
        .catch((reason: unknown) => setError(messageOf(reason)));
    }, 700);
    return () => window.clearInterval(timer);
  }, [capture?.id, capture?.status, onReviewRequested]);

  async function saveCriticalAction(): Promise<void> {
    setBusy('action');
    setError(null);
    try {
      setCriticalAction(
        await approveCriticalAction(journey.id, stepId, actionLabel),
      );
    } catch (reason: unknown) {
      setError(messageOf(reason));
    } finally {
      setBusy(null);
    }
  }

  async function beginCapture(preflightComplete = false): Promise<boolean> {
    const operation = {
      kind: 'startOutcomeBaseline',
      projectId: journey.projectId,
      journeyId: journey.id,
    } as const;
    if (!preflightComplete && !(await authentication.ensure(operation)))
      return false;
    setBusy('capture');
    setError(null);
    try {
      const started = await startOutcomeCapture(
        journey.id,
        runtimeValues,
        confirmProduction,
      );
      setCapture(started);
      setBindingExpression(
        started.selectedTarget?.generatedBindings[0]?.expression ?? '',
      );
      setDescription(
        defaultOutcomeCheckDescription(checkType, started.finalPathname),
      );
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

  async function saveCheck(): Promise<void> {
    if (capture === null) return;
    setBusy('check');
    setError(null);
    try {
      const input = approvalInput(
        checkType,
        description,
        bindingExpression,
        capture.finalPathname,
      );
      const saved = await approveOutcomeCheck(capture.id, input);
      setChecks((current) => [...current, saved]);
      if (
        capture.status === 'selection_cancelled' &&
        checkType === 'final_pathname_matches'
      ) {
        setCapture({ ...capture, status: 'completed', errorMessage: null });
      }
    } catch (reason: unknown) {
      setError(messageOf(reason));
    } finally {
      setBusy(null);
    }
  }

  async function endCapture(): Promise<void> {
    if (capture === null) return;
    setBusy('close');
    setError(null);
    try {
      setCapture(await closeOutcomeCapture(capture.id));
    } catch (reason: unknown) {
      setError(messageOf(reason));
    } finally {
      setBusy(null);
    }
  }

  async function removeCheck(check: OutcomeCheck): Promise<void> {
    if (
      !window.confirm(
        `Remove this saved Outcome Check? The saved definition will be deleted so you can recapture it. Historical immutable snapshots, when present, are not edited.`,
      )
    ) {
      return;
    }
    setBusy(`delete-check-${check.id}`);
    setError(null);
    try {
      await deleteOutcomeCheck(journey.id, check.id);
      setChecks((current) => current.filter((item) => item.id !== check.id));
    } catch (reason: unknown) {
      setError(messageOf(reason));
    } finally {
      setBusy(null);
    }
  }

  const target = capture?.selectedTarget ?? null;
  const captureActive =
    capture !== null &&
    !['completed', 'expired', 'runner_error', 'selection_cancelled'].includes(
      capture.status,
    );
  const requiresTarget = checkType !== 'final_pathname_matches';
  const requiresBinding = checkType === 'matching_item_appears_exactly_once';
  const selectedStep =
    compatibleSteps.find((step) => step.id === stepId) ?? null;
  const resolvedGeneratedInputs =
    capture?.generatedInputs.filter(
      (
        input,
      ): input is typeof input & {
        readonly resolvedValue: string;
      } => typeof input.resolvedValue === 'string',
    ) ?? [];
  const showGeneratedInputs =
    capture !== null &&
    [
      'awaiting_selection',
      'selection_ready',
      'selection_rejected',
      'selection_cancelled',
    ].includes(capture.status) &&
    resolvedGeneratedInputs.length > 0;

  function useFinalPage(): void {
    if (
      capture?.finalPathname === null ||
      capture?.finalPathname === undefined
    ) {
      return;
    }
    setCheckType('final_pathname_matches');
    setDescription(
      defaultOutcomeCheckDescription(
        'final_pathname_matches',
        capture.finalPathname,
      ),
    );
    onReviewRequested?.();
  }

  return (
    <details
      className={`outcome-definition outcome-definition-${presentation} outcome-section-${activeSection}`}
      id={id}
      open={presentation === 'wizard' ? true : expanded}
      onToggle={(event) => {
        if (presentation === 'disclosure') {
          onExpandedChange?.(event.currentTarget.open);
        }
      }}
    >
      <summary>Define Critical Action and Outcome Checks</summary>
      <div className="outcome-definition-body">
        {loading ? (
          <div className="state-message state-message-loading" role="status">
            Loading the saved Critical Action and Outcome Checks…
          </div>
        ) : null}
        {error === null ? null : (
          <div className="state-message state-message-error" role="alert">
            {error}
          </div>
        )}
        <AuthenticationRecoveryPanel
          gate={authentication}
          onRetry={(operation) => {
            if (operation.kind !== 'startOutcomeBaseline') return;
            void beginCapture(true).then((started) => {
              if (started) authentication.complete();
            });
          }}
        />

        {activeSection === 'checks' ? null : (
          <>
            <div className="outcome-definition-step">
              <h3>What should FormCrash test?</h3>
              <p>
                Choose the final action that creates or updates the record.
                FormCrash replays every earlier journey step normally—including
                navigation and switching buildings—then stresses only this
                action.
              </p>
              <div className="outcome-form-grid">
                <label>
                  Action to test
                  <select
                    aria-label={`${journey.name} Critical Action`}
                    disabled={criticalAction !== null && checks.length > 0}
                    value={stepId}
                    onChange={(event) => {
                      const nextStep = compatibleSteps.find(
                        (step) => step.id === event.target.value,
                      );
                      setStepId(event.target.value);
                      setActionLabel(
                        nextStep === undefined
                          ? ''
                          : actionName(nextStep, journey),
                      );
                    }}
                  >
                    {recommended === null && criticalAction === null ? (
                      <option value="">Select an action</option>
                    ) : null}
                    {compatibleSteps.map((step) => (
                      <option key={step.id} value={step.id}>
                        {actionName(step, journey)}
                      </option>
                    ))}
                  </select>
                </label>
                <details>
                  <summary>Rename this action in results</summary>
                  <label>
                    Result label
                    <input
                      aria-label={`${journey.name} result label`}
                      maxLength={160}
                      value={actionLabel}
                      onChange={(event) => setActionLabel(event.target.value)}
                    />
                  </label>
                </details>
              </div>
              {selectedStep === null ? null : (
                <div
                  aria-label="Selected action details"
                  className="critical-action-preview"
                >
                  <strong>How this test will run</strong>
                  <span>
                    Replay the first {journey.steps.indexOf(selectedStep)}{' '}
                    journey steps normally. The selected action{' '}
                    {plainActionType(selectedStep).toLowerCase()}.
                  </span>
                  {actionPageContext(selectedStep.url) === null ? null : (
                    <small>
                      The selected action happens on{' '}
                      {actionPageContext(selectedStep.url)}.
                    </small>
                  )}
                </div>
              )}
              <button
                className="button button-secondary button-compact"
                disabled={
                  busy !== null ||
                  stepId === '' ||
                  actionLabel.trim() === '' ||
                  compatibleSteps.length === 0
                }
                onClick={() => void saveCriticalAction()}
                type="button"
              >
                {busy === 'action' ? 'Saving action…' : 'Confirm this action'}
              </button>
              {criticalAction === null ? null : (
                <p className="guided-ready-note">
                  Action confirmed. Earlier journey steps will run normally.
                </p>
              )}
              {checks.length > 0 ? (
                <p className="technical-note">
                  To choose a different Critical Action, explicitly remove every
                  current Outcome Check below, approve the new action, then
                  start a fresh baseline capture.
                </p>
              ) : null}
            </div>

            <div className="outcome-definition-step">
              <p className="eyebrow">Confirm the saved journey</p>
              <p>
                FormCrash now replays the whole saved journey—including building
                changes—to confirm it can reach the successful result on the{' '}
                {environment} target. This can create test data. Existing
                preparation, authentication, production confirmation, and
                cleanup settings apply.
              </p>
              {productionConfirmation}
              <div className="guided-ready-note">
                <strong>After the replay succeeds, Chromium stays open.</strong>
                <span>
                  In Chromium, click the tenant row, confirmation, or other
                  visible result that proves success. The click is captured by
                  FormCrash and may not visibly change the target page. Keep
                  Chromium open, then return here to approve the check.
                </span>
              </div>
              <div className="guided-action-row">
                <button
                  className={`button button-compact ${
                    presentation === 'wizard'
                      ? 'button-secondary'
                      : 'button-primary'
                  }`}
                  disabled={
                    busy !== null ||
                    disabled ||
                    criticalAction === null ||
                    captureActive ||
                    authentication.pending !== null
                  }
                  onClick={() => void beginCapture()}
                  type="button"
                >
                  {busy === 'capture'
                    ? 'Replaying journey…'
                    : 'Replay journey and choose result'}
                </button>
                {capture === null ? null : (
                  <span>{captureStatusLabel(capture.status)}</span>
                )}
              </div>
              {showGeneratedInputs ? (
                <div
                  aria-label="Generated values for this baseline"
                  className="outcome-generated-values"
                  role="status"
                >
                  <div>
                    <p className="eyebrow">Find the new record</p>
                    <strong>
                      Use these exact generated values in Chromium
                    </strong>
                  </div>
                  <dl>
                    {resolvedGeneratedInputs.map((input) => (
                      <div key={input.stepId}>
                        <dt>{input.stepName}</dt>
                        <dd>
                          <code>{input.resolvedValue}</code>
                        </dd>
                      </div>
                    ))}
                  </dl>
                  <small>
                    Click the new row, confirmation, or result containing one of
                    these values. They identify this baseline only and are not
                    saved in the reusable Outcome Check.
                  </small>
                </div>
              ) : null}
              {capture?.status === 'awaiting_selection' ? (
                <div className="guided-ready-note" role="status">
                  <strong>
                    Baseline succeeded. Choose the proof in Chromium.
                  </strong>
                  <span>
                    Leave Chromium open and click the visible result that proves
                    this journey succeeded. Then return here. If arriving at the
                    current page is sufficient proof, use the final page
                    instead.
                  </span>
                  {capture.finalPathname === null ? null : (
                    <button
                      className="button button-secondary button-compact"
                      onClick={useFinalPage}
                      type="button"
                    >
                      Use final page instead
                    </button>
                  )}
                </div>
              ) : null}
              {capture?.status === 'selection_cancelled' ? (
                <div className="recording-warning" role="status">
                  <strong>Chromium closed after the baseline succeeded.</strong>
                  <p>
                    No result element was approved. You can still use the
                    captured final page below, or replay the journey if you need
                    to select a visible result. Replaying will execute the real
                    action again.
                  </p>
                  {capture.finalPathname === null ? null : (
                    <button
                      className="button button-secondary button-compact"
                      onClick={useFinalPage}
                      type="button"
                    >
                      Use captured final page
                    </button>
                  )}
                </div>
              ) : null}
              {capture?.status === 'selection_rejected' ? (
                <div className="recording-warning" role="alert">
                  <strong>This result cannot be saved as selected.</strong>
                  <p>
                    In Chromium, click a different stable row, confirmation, or
                    result element. If reaching the current page is sufficient
                    proof, use the captured final page instead.
                  </p>
                  {capture.finalPathname === null ? null : (
                    <button
                      className="button button-secondary button-compact"
                      onClick={useFinalPage}
                      type="button"
                    >
                      Use captured final page
                    </button>
                  )}
                </div>
              ) : null}
              {capture?.selectionWarnings.map((warning) => (
                <p className="recording-warning" key={warning.code}>
                  {warning.message}
                </p>
              ))}
              {capture?.errorMessage === null ||
              capture?.errorMessage === undefined ? null : (
                <RunnerFailureMessage message={capture.errorMessage} />
              )}
            </div>
          </>
        )}

        {activeSection === 'action' ||
        capture === null ||
        ['completed', 'expired', 'runner_error'].includes(
          capture.status,
        ) ? null : (
          <div className="outcome-definition-step">
            <p className="eyebrow">Approve Outcome Check</p>
            <div className="outcome-form-grid">
              <label>
                Outcome Check type
                <select
                  aria-label={`${journey.name} Outcome Check type`}
                  value={checkType}
                  onChange={(event) => {
                    const nextType = event.target.value as OutcomeCheckType;
                    setCheckType(nextType);
                    setDescription(
                      defaultOutcomeCheckDescription(
                        nextType,
                        capture.finalPathname,
                      ),
                    );
                  }}
                >
                  <option value="matching_item_appears_exactly_once">
                    Matching item appears exactly once
                  </option>
                  <option value="visible_element_exists">
                    Visible element exists
                  </option>
                  <option value="final_pathname_matches">
                    Final pathname matches
                  </option>
                </select>
              </label>
              <label>
                Readable description
                <input
                  aria-label={`${journey.name} Outcome Check description`}
                  maxLength={500}
                  value={description}
                  onChange={(event) => setDescription(event.target.value)}
                />
              </label>
            </div>

            {requiresTarget ? (
              target === null ? (
                <p className="technical-note">
                  Select a reliable visible element in Chromium first.
                </p>
              ) : (
                <div className="captured-outcome-preview">
                  <strong>Selected element</strong>
                  <span>{target.preview}</span>
                  <code>{formatLocator(target.locator)}</code>
                  <small>Reliability: {target.reliability}</small>
                </div>
              )
            ) : (
              <p className="captured-outcome-preview">
                Final pathname: <code>{capture.finalPathname}</code>
              </p>
            )}

            {requiresBinding && target !== null ? (
              <div>
                <label>
                  Generated identity binding
                  <select
                    aria-label={`${journey.name} generated identity binding`}
                    value={bindingExpression}
                    onChange={(event) =>
                      setBindingExpression(event.target.value)
                    }
                  >
                    <option value="">Select a generated value</option>
                    {target.generatedBindings.map((binding) => (
                      <option
                        key={binding.expression}
                        value={binding.expression}
                      >
                        {binding.label} ({binding.template})
                      </option>
                    ))}
                  </select>
                </label>
                {capture.generatedInputs.map((input) => (
                  <p className="technical-note" key={input.stepId}>
                    Journey input <strong>{input.stepName}</strong> was replaced
                    by <code>{input.template}</code> for this baseline.
                  </p>
                ))}
                {bindingExpression === '' ? null : (
                  <p className="guided-ready-note">
                    The selected target is bound to{' '}
                    <code>
                      {
                        target.generatedBindings.find(
                          (item) => item.expression === bindingExpression,
                        )?.template
                      }
                    </code>
                    . The resolved run-specific literal is used only in memory
                    and is not persisted.
                  </p>
                )}
              </div>
            ) : null}

            <div className="guided-action-row">
              <button
                className={`button button-compact ${
                  presentation === 'wizard'
                    ? 'button-secondary'
                    : 'button-primary'
                }`}
                disabled={
                  busy !== null ||
                  description.trim() === '' ||
                  (requiresTarget && target === null) ||
                  (requiresBinding && bindingExpression === '') ||
                  (checkType === 'final_pathname_matches' &&
                    capture.finalPathname === null)
                }
                onClick={() => void saveCheck()}
                type="button"
              >
                {busy === 'check' ? 'Saving Outcome Check…' : 'Approve check'}
              </button>
              <button
                className="button button-secondary button-compact"
                disabled={busy !== null}
                onClick={() => void endCapture()}
                type="button"
              >
                {busy === 'close' ? 'Closing Chromium…' : 'Finish capture'}
              </button>
            </div>
          </div>
        )}

        {activeSection === 'action' ? null : (
          <div className="outcome-definition-step">
            <p className="eyebrow">Saved Outcome Checks</p>
            {checks.length === 0 ? (
              <p className="technical-note">No Outcome Checks saved yet.</p>
            ) : (
              <ul className="outcome-check-list">
                {checks.map((check) => (
                  <li key={check.id}>
                    <strong>{describeOutcomeCheck(check)}</strong>
                    <span>{outcomeCheckTypeLabel(check.type)}</span>
                    <details>
                      <summary>Technical details</summary>
                      <p>
                        {check.type.replaceAll('_', ' ')} - journey version{' '}
                        {journey.version} - {journey.id}
                      </p>
                      {'binding' in check ? (
                        <p>
                          Binding: <code>{check.binding.template}</code>
                        </p>
                      ) : null}
                      {'target' in check ? (
                        <p>
                          Locator:{' '}
                          <code>{formatLocator(check.target.locator)}</code>
                        </p>
                      ) : null}
                    </details>
                    <button
                      className="button button-secondary button-compact"
                      disabled={busy !== null || captureActive}
                      onClick={() => void removeCheck(check)}
                      type="button"
                    >
                      {busy === `delete-check-${check.id}`
                        ? 'Removing...'
                        : 'Remove and recapture'}
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}
      </div>
    </details>
  );
}

export interface OutcomeDefinitionState {
  readonly checks: readonly OutcomeCheck[];
  readonly criticalAction: CriticalAction | null;
  readonly error: string | null;
  readonly loading: boolean;
}

function loadOutcomeDefinition(journeyId: string) {
  return Promise.all([
    getCriticalAction(journeyId),
    listOutcomeChecks(journeyId),
    getActiveOutcomeCapture(journeyId),
  ]);
}

function isHighConfidenceAction(
  step: PersistedJourney['steps'][number],
): boolean {
  return (
    step.locator !== null &&
    step.locator.strategy !== 'css' &&
    step.locator.strategy !== 'text'
  );
}

function actionName(
  step: PersistedJourney['steps'][number],
  journey: PersistedJourney,
): string {
  const fingerprint = step.fingerprint;
  const tagName = fingerprint?.tagName.toLowerCase();
  const accessibleControlName =
    tagName === 'button' ||
    tagName === 'input' ||
    tagName === 'select' ||
    tagName === 'textarea' ||
    step.type === 'click'
      ? fingerprint?.accessibleName?.trim()
      : null;
  return (
    nonEmpty(accessibleControlName) ??
    nonEmpty(fingerprint?.label) ??
    nonEmpty(step.name) ??
    genericActionName(step, journey)
  );
}

function genericActionName(
  step: PersistedJourney['steps'][number],
  journey: PersistedJourney,
): string {
  const page = pageName(step.url) ?? pageName(journey.steps[0]?.url ?? '');
  if (step.type === 'submit') {
    return page === null ? 'Submit form' : `Submit ${page} form`;
  }
  return page === null ? 'Use recorded control' : `Use ${page} control`;
}

function plainActionType(step: PersistedJourney['steps'][number]): string {
  if (step.type === 'submit') {
    const page = pageName(step.url);
    return page === null
      ? 'Submits the selected form'
      : `Submits the ${page} form`;
  }
  return 'Activates the selected control';
}

function actionPageContext(url: string): string | null {
  const page = pageName(url);
  return page === null ? null : `${sentenceCase(page)} page`;
}

function pageName(url: string): string | null {
  try {
    const segment = new URL(url).pathname.split('/').filter(Boolean).at(-1);
    return segment === undefined
      ? null
      : decodeURIComponent(segment).replaceAll(/[-_]+/gu, ' ');
  } catch {
    return null;
  }
}

function nonEmpty(value: string | null | undefined): string | null {
  const trimmed = value?.trim();
  return trimmed === undefined || trimmed === '' ? null : trimmed;
}

function sentenceCase(value: string): string {
  return `${value.slice(0, 1).toUpperCase()}${value.slice(1)}`;
}

function approvalInput(
  type: OutcomeCheckType,
  description: string,
  bindingExpression: string,
  finalPathname: string | null,
): ApproveOutcomeCheckRequest {
  if (type === 'visible_element_exists') {
    return { type, description };
  }
  if (type === 'matching_item_appears_exactly_once') {
    return {
      type,
      description,
      bindingExpression: bindingExpression as
        'unique.email' | 'unique.name' | 'unique.phone' | 'unique.text',
    };
  }
  if (finalPathname === null) {
    throw new Error('The baseline replay did not expose a final pathname.');
  }
  return { type, description, expectedPathname: finalPathname };
}

function formatLocator(locator: ReplayLocator): string {
  return locator.strategy === 'role'
    ? `role=${locator.role}, name=${JSON.stringify(locator.name)}`
    : `${locator.strategy}=${JSON.stringify(locator.value)}`;
}

function RunnerFailureMessage({ message }: { readonly message: string }) {
  const technicalDetail = stripTerminalFormatting(message);
  const selectionSetupFailed = technicalDetail.includes(
    'Baseline replay completed, but Outcome Check selection could not start.',
  );
  return (
    <div className="outcome-runner-failure" role="alert">
      <div>
        <strong>
          {selectionSetupFailed
            ? 'Journey completed, but result selection failed'
            : 'Saved journey could not complete'}
        </strong>
        <p>{friendlyRunnerFailure(technicalDetail)}</p>
      </div>
      <details>
        <summary>Technical runner detail</summary>
        <pre>{technicalDetail}</pre>
      </details>
    </div>
  );
}

function captureStatusLabel(status: OutcomeCaptureSession['status']): string {
  if (status === 'launching') return 'Launching Chromium';
  if (status === 'replaying') return 'Replaying saved journey';
  if (status === 'awaiting_selection') return 'Waiting for result selection';
  if (status === 'selection_ready') return 'Result selected';
  if (status === 'selection_rejected') return 'Selection needs attention';
  if (status === 'selection_cancelled') return 'Result selection cancelled';
  if (status === 'closing') return 'Closing Chromium';
  if (status === 'completed') return 'Capture complete';
  if (status === 'expired') return 'Capture expired';
  return 'Runner error';
}

function friendlyRunnerFailure(message: string): string {
  if (
    message.includes('strict mode violation') &&
    message.includes('resolved to')
  ) {
    return 'A recorded label matched more than one element, so FormCrash could not safely identify the original control. Switching pages or buildings is supported; the problem was the ambiguous saved locator.';
  }
  if (
    message.includes(
      'Baseline replay completed, but Outcome Check selection could not start.',
    )
  ) {
    return 'The saved journey completed and may already have changed target data, but FormCrash could not start result selection. Do not immediately replay the mutation; review the target data first.';
  }
  if (
    message.includes('Target page, context or browser has been closed') ||
    message.includes('Target page, context or browser was closed')
  ) {
    return 'The controlled browser closed before the saved journey reached the baseline state. Review authentication and the recorded navigation, then retry.';
  }
  const firstLine = message.split(/\r?\n/u).find((line) => line.trim() !== '');
  return (
    firstLine?.replace(/^page\.goto:\s*/u, '') ??
    'The baseline replay stopped before an Outcome Check could be captured.'
  );
}

function stripTerminalFormatting(message: string): string {
  const terminalEscape = String.fromCharCode(27);
  const ansiSequence = new RegExp(
    `${terminalEscape}\\[[0-?]*[ -/]*[@-~]`,
    'gu',
  );
  return message
    .replace(ansiSequence, '')
    .replace(/\n?Call log:[\s\S]*$/u, '')
    .trim();
}

function messageOf(reason: unknown): string {
  return reason instanceof Error
    ? reason.message
    : 'The operation could not be completed.';
}
