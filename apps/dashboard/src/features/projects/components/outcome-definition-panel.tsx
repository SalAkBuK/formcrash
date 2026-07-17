'use client';

import { useEffect, useMemo, useState } from 'react';
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

export function OutcomeDefinitionPanel({
  journey,
  runtimeValues,
  confirmProduction,
  environment,
  disabled,
}: {
  readonly journey: PersistedJourney;
  readonly runtimeValues: EphemeralRuntimeValues;
  readonly confirmProduction: boolean;
  readonly environment: ProjectEnvironment;
  readonly disabled: boolean;
}) {
  const compatibleSteps = useMemo(
    () =>
      journey.steps.filter(
        (step) => step.type === 'click' || step.type === 'submit',
      ),
    [journey],
  );
  const recommended =
    [...compatibleSteps].reverse().find((step) => step.type === 'submit') ??
    compatibleSteps.at(-1) ??
    null;
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

  useEffect(() => {
    void Promise.all([
      getCriticalAction(journey.id),
      listOutcomeChecks(journey.id),
      getActiveOutcomeCapture(journey.id),
    ])
      .then(([action, savedChecks, activeCapture]) => {
        setCriticalAction(action);
        setChecks(savedChecks);
        setCapture(activeCapture);
        setBindingExpression(
          activeCapture?.selectedTarget?.generatedBindings[0]?.expression ?? '',
        );
        if (action !== null) {
          setStepId(action.stepId);
          setActionLabel(action.label);
        }
      })
      .catch((reason: unknown) => setError(messageOf(reason)));
  }, [journey.id]);

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
        })
        .catch((reason: unknown) => setError(messageOf(reason)));
    }, 700);
    return () => window.clearInterval(timer);
  }, [capture?.id, capture?.status]);

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

  async function beginCapture(): Promise<void> {
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
    } catch (reason: unknown) {
      setError(messageOf(reason));
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
    !['completed', 'expired', 'runner_error'].includes(capture.status);
  const requiresTarget = checkType !== 'final_pathname_matches';
  const requiresBinding = checkType === 'matching_item_appears_exactly_once';

  return (
    <details className="outcome-definition">
      <summary>Define Critical Action and Outcome Checks</summary>
      <div className="outcome-definition-body">
        {error === null ? null : (
          <div className="state-message state-message-error" role="alert">
            {error}
          </div>
        )}

        <div className="outcome-definition-step">
          <p className="eyebrow">Critical Action</p>
          <div className="outcome-form-grid">
            <label>
              Recorded click or submit
              <select
                aria-label={`${journey.name} Critical Action`}
                disabled={criticalAction !== null && checks.length > 0}
                value={stepId}
                onChange={(event) => {
                  setStepId(event.target.value);
                  setActionLabel(
                    compatibleSteps.find(
                      (step) => step.id === event.target.value,
                    )?.name ?? '',
                  );
                }}
              >
                {compatibleSteps.map((step) => (
                  <option key={step.id} value={step.id}>
                    {step.name} ({step.type})
                  </option>
                ))}
              </select>
            </label>
            <label>
              Human-readable label
              <input
                aria-label={`${journey.name} Critical Action label`}
                maxLength={160}
                value={actionLabel}
                onChange={(event) => setActionLabel(event.target.value)}
              />
            </label>
          </div>
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
            {busy === 'action'
              ? 'Saving Critical Action…'
              : criticalAction === null
                ? 'Approve Critical Action'
                : 'Update Critical Action label'}
          </button>
          {criticalAction === null ? null : (
            <p className="guided-ready-note">
              Approved: {criticalAction.label}
            </p>
          )}
          {checks.length > 0 ? (
            <p className="technical-note">
              To choose a different Critical Action, explicitly remove every
              current Outcome Check below, approve the new action, then start a
              fresh baseline capture.
            </p>
          ) : null}
        </div>

        <div className="outcome-definition-step">
          <p className="eyebrow">Successful baseline</p>
          <p>
            This executes the real saved journey against the {environment}{' '}
            target. It can send state-changing requests and create test data.
            Use a controlled non-production environment whenever possible.
            Existing preparation, authentication, production confirmation, and
            cleanup settings apply to this replay.
          </p>
          <div className="guided-action-row">
            <button
              className="button button-primary button-compact"
              disabled={
                busy !== null ||
                disabled ||
                criticalAction === null ||
                captureActive
              }
              onClick={() => void beginCapture()}
              type="button"
            >
              {busy === 'capture'
                ? 'Replaying baseline…'
                : 'Start outcome baseline'}
            </button>
            {capture === null ? null : <span>{capture.status}</span>}
          </div>
          {capture?.status === 'awaiting_selection' ? (
            <p className="guided-ready-note">
              Chromium is waiting. Click the visible result element you want
              FormCrash to capture.
            </p>
          ) : null}
          {capture?.selectionWarnings.map((warning) => (
            <p className="recording-warning" key={warning.code}>
              {warning.message}
            </p>
          ))}
          {capture?.errorMessage === null ||
          capture?.errorMessage === undefined ? null : (
            <p className="recording-warning">{capture.errorMessage}</p>
          )}
        </div>

        {capture === null ||
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
                  onChange={(event) =>
                    setCheckType(event.target.value as OutcomeCheckType)
                  }
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
                className="button button-primary button-compact"
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

        <div className="outcome-definition-step">
          <p className="eyebrow">Saved Outcome Checks</p>
          {checks.length === 0 ? (
            <p className="technical-note">No Outcome Checks saved yet.</p>
          ) : (
            <ul className="outcome-check-list">
              {checks.map((check) => (
                <li key={check.id}>
                  <strong>{readableOutcome(check)}</strong>
                  <span>{check.description}</span>
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
      </div>
    </details>
  );
}

function readableOutcome(check: OutcomeCheck): string {
  if (check.type === 'matching_item_appears_exactly_once') {
    return `Exactly one result matching ${check.binding.template} should appear.`;
  }
  if (check.type === 'final_pathname_matches') {
    return `The journey should finish at ${check.expectedPathname}.`;
  }
  return `The selected result element should be visible.`;
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

function messageOf(reason: unknown): string {
  return reason instanceof Error
    ? reason.message
    : 'The operation could not be completed.';
}
