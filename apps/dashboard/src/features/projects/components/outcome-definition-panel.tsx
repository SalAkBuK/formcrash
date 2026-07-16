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
  ReplayLocator,
} from '@formcrash/contracts';

import {
  approveCriticalAction,
  approveOutcomeCheck,
  closeOutcomeCapture,
  getCriticalAction,
  getOutcomeCapture,
  listOutcomeChecks,
  startOutcomeCapture,
} from '../api/projects';

export function OutcomeDefinitionPanel({
  journey,
  runtimeValues,
  confirmProduction,
  disabled,
}: {
  readonly journey: PersistedJourney;
  readonly runtimeValues: EphemeralRuntimeValues;
  readonly confirmProduction: boolean;
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
    ])
      .then(([action, savedChecks]) => {
        setCriticalAction(action);
        setChecks(savedChecks);
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

  const target = capture?.selectedTarget ?? null;
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
        </div>

        <div className="outcome-definition-step">
          <p className="eyebrow">Successful baseline</p>
          <p>
            FormCrash replays the journey once with generated safe identity
            values, keeps Chromium open, and enters element-selection mode.
          </p>
          <div className="guided-action-row">
            <button
              className="button button-primary button-compact"
              disabled={busy !== null || disabled || criticalAction === null}
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
              <label>
                Generated identity binding
                <select
                  aria-label={`${journey.name} generated identity binding`}
                  value={bindingExpression}
                  onChange={(event) => setBindingExpression(event.target.value)}
                >
                  <option value="">Select a generated value</option>
                  {target.generatedBindings.map((binding) => (
                    <option key={binding.expression} value={binding.expression}>
                      {binding.label} ({binding.template})
                    </option>
                  ))}
                </select>
              </label>
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
                  <strong>{check.description}</strong>
                  <span>{check.type.replaceAll('_', ' ')}</span>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </details>
  );
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
