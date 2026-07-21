'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import type {
  AuthCaptureSession,
  AuthValidationResult,
  ProjectExecutionSettings,
} from '@formcrash/contracts';

import { StateMessage } from '../../../components/ui/state-message';
import {
  cancelAuthenticationCapture,
  confirmAuthenticationCapture,
  continueWithoutAuthentication,
  getProjectSettings,
  startAuthenticationCapture,
  testAuthentication,
} from '../api/external-experiments';

export type PendingProtectedOperation =
  | { readonly kind: 'startRecording'; readonly projectId: string }
  | {
      readonly kind: 'replayJourney';
      readonly projectId: string;
      readonly journeyId: string;
    }
  | {
      readonly kind: 'startRequestDiscovery';
      readonly projectId: string;
      readonly journeyId: string;
      readonly targetStepId: string;
    }
  | {
      readonly kind: 'startOutcomeBaseline';
      readonly projectId: string;
      readonly journeyId: string;
    }
  | {
      readonly kind: 'runExperiment';
      readonly projectId: string;
      readonly experimentVersionId?: string;
      readonly journeyId?: string;
    };

type RecoveryReason =
  'not_configured' | 'required' | 'expired' | 'verification_failed';

export interface AuthenticationGate {
  readonly busy: boolean;
  readonly capture: AuthCaptureSession | null;
  readonly error: string | null;
  readonly pending: PendingProtectedOperation | null;
  readonly readyToRetry: boolean;
  readonly reason: RecoveryReason | null;
  readonly ensure: (operation: PendingProtectedOperation) => Promise<boolean>;
  readonly recheck: () => Promise<void>;
  readonly requireRecovery: (
    operation: PendingProtectedOperation,
    reason?: Extract<RecoveryReason, 'required' | 'expired'>,
  ) => void;
  readonly startCapture: () => Promise<void>;
  readonly confirmCapture: () => Promise<void>;
  readonly continueWithoutSignIn: () => Promise<void>;
  readonly cancel: () => Promise<void>;
  readonly complete: () => void;
}

export function useAuthenticationGate({
  projectId,
  onSettingsChange,
}: {
  readonly projectId: string;
  readonly onSettingsChange?: (settings: ProjectExecutionSettings) => void;
}): AuthenticationGate {
  const [pending, setPending] = useState<PendingProtectedOperation | null>(
    null,
  );
  const [reason, setReason] = useState<RecoveryReason | null>(null);
  const [capture, setCapture] = useState<AuthCaptureSession | null>(null);
  const [readyToRetry, setReadyToRetry] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const actionActive = useRef(false);
  const activeProjectId = useRef(projectId);

  useEffect(() => {
    if (activeProjectId.current === projectId) return;
    activeProjectId.current = projectId;
    setPending(null);
    setReason(null);
    setCapture(null);
    setReadyToRetry(false);
    setError(null);
  }, [projectId]);

  const refreshSettings = useCallback(async () => {
    const settings = await getProjectSettings(projectId);
    onSettingsChange?.(settings);
    return settings;
  }, [onSettingsChange, projectId]);

  const ensure = useCallback(
    async (operation: PendingProtectedOperation): Promise<boolean> => {
      if (actionActive.current) return false;
      actionActive.current = true;
      setBusy(true);
      setError(null);
      try {
        const validation = await testAuthentication(projectId);
        const settings = await refreshSettings();
        if (accessAllowed(validation, settings)) {
          setPending(null);
          setReason(null);
          setReadyToRetry(false);
          return true;
        }
        setPending(operation);
        setReason(recoveryReason(validation, settings));
        setReadyToRetry(false);
        return false;
      } catch (cause: unknown) {
        setPending(operation);
        setReason('verification_failed');
        setReadyToRetry(false);
        setError(messageOf(cause));
        return false;
      } finally {
        actionActive.current = false;
        setBusy(false);
      }
    },
    [projectId, refreshSettings],
  );

  const requireRecovery = useCallback(
    (
      operation: PendingProtectedOperation,
      nextReason: 'required' | 'expired' = 'expired',
    ) => {
      setPending(operation);
      setReason(nextReason);
      setCapture(null);
      setReadyToRetry(false);
      setError(null);
    },
    [],
  );

  const recheck = useCallback(async () => {
    if (actionActive.current || pending === null) return;
    actionActive.current = true;
    setBusy(true);
    setError(null);
    try {
      const validation = await testAuthentication(projectId);
      const settings = await refreshSettings();
      if (accessAllowed(validation, settings)) {
        setReason(null);
        setReadyToRetry(true);
      } else {
        setReason(recoveryReason(validation, settings));
        setReadyToRetry(false);
        if (validation.outcome === 'target_unavailable') {
          setError(validation.message);
        }
      }
    } catch (cause: unknown) {
      setReason('verification_failed');
      setError(messageOf(cause));
    } finally {
      actionActive.current = false;
      setBusy(false);
    }
  }, [pending, projectId, refreshSettings]);

  const startCapture = useCallback(async () => {
    if (actionActive.current) return;
    actionActive.current = true;
    setBusy(true);
    setError(null);
    try {
      setCapture(await startAuthenticationCapture(projectId));
    } catch (cause: unknown) {
      setError(messageOf(cause));
    } finally {
      actionActive.current = false;
      setBusy(false);
    }
  }, [projectId]);

  const confirmCapture = useCallback(async () => {
    if (actionActive.current || capture === null) return;
    actionActive.current = true;
    setBusy(true);
    setError(null);
    try {
      const completed = await confirmAuthenticationCapture(
        projectId,
        capture.id,
      );
      setCapture(completed);
      if (completed.status !== 'completed') {
        setError(
          completed.errorMessage ??
            'Authentication state could not be saved locally.',
        );
        return;
      }
      const validation = await testAuthentication(projectId);
      const settings = await refreshSettings();
      if (
        !accessAllowed(validation, settings) ||
        validation.outcome !== 'authenticated'
      ) {
        setReason(recoveryReason(validation, settings));
        setError(validation.message);
        return;
      }
      setReadyToRetry(true);
      setReason(null);
    } catch (cause: unknown) {
      setError(messageOf(cause));
    } finally {
      actionActive.current = false;
      setBusy(false);
    }
  }, [capture, projectId, refreshSettings]);

  const continueWithoutSignIn = useCallback(async () => {
    if (actionActive.current || pending === null) return;
    actionActive.current = true;
    setBusy(true);
    setError(null);
    try {
      const settings = await continueWithoutAuthentication(projectId);
      onSettingsChange?.(settings);
      setReadyToRetry(true);
      setReason(null);
    } catch (cause: unknown) {
      setError(messageOf(cause));
    } finally {
      actionActive.current = false;
      setBusy(false);
    }
  }, [onSettingsChange, pending, projectId]);

  const cancel = useCallback(async () => {
    if (actionActive.current) return;
    actionActive.current = true;
    setBusy(true);
    try {
      if (capture?.status === 'awaiting_confirmation') {
        await cancelAuthenticationCapture(projectId, capture.id);
      }
    } catch (cause: unknown) {
      setError(messageOf(cause));
      return;
    } finally {
      actionActive.current = false;
      setBusy(false);
    }
    setPending(null);
    setReason(null);
    setCapture(null);
    setReadyToRetry(false);
    setError(null);
  }, [capture, projectId]);

  const complete = useCallback(() => {
    setPending(null);
    setReason(null);
    setCapture(null);
    setReadyToRetry(false);
    setError(null);
  }, []);

  return {
    busy,
    capture,
    error,
    pending,
    readyToRetry,
    reason,
    ensure,
    recheck,
    requireRecovery,
    startCapture,
    confirmCapture,
    continueWithoutSignIn,
    cancel,
    complete,
  };
}

export function AuthenticationRecoveryPanel({
  gate,
  onRetry,
}: {
  readonly gate: AuthenticationGate;
  readonly onRetry: (operation: PendingProtectedOperation) => void;
}) {
  const [confirmingPublicChoice, setConfirmingPublicChoice] = useState(false);
  useEffect(() => {
    if (gate.pending === null) setConfirmingPublicChoice(false);
  }, [gate.pending]);
  if (gate.pending === null) return null;
  const awaitingConfirmation = gate.capture?.status === 'awaiting_confirmation';
  const authenticationSaved = gate.capture?.status === 'completed';
  const heading = gate.readyToRetry
    ? authenticationSaved
      ? 'Authentication saved'
      : 'Ready to continue'
    : gate.reason === 'expired'
      ? 'Authentication expired'
      : gate.reason === 'verification_failed'
        ? 'Authentication check failed'
        : gate.reason === 'not_configured'
          ? 'Choose authentication setup'
          : 'Sign-in required';
  const message = gate.readyToRetry
    ? authenticationSaved
      ? 'Your browser session is ready.'
      : 'You chose to continue without sign-in for this journey.'
    : gate.reason === 'expired'
      ? gate.pending.kind === 'startRecording'
        ? 'Recording stopped when FormCrash reached the login page. The incomplete steps were discarded. Sign in again and recapture fresh session tokens before recording the journey again.'
        : 'FormCrash reached the login page instead of the recorded application state. Capture a new sign-in session before continuing.'
      : gate.reason === 'verification_failed'
        ? 'FormCrash could not confirm whether the target is accessible. Check the target and try again.'
        : gate.reason === 'not_configured'
          ? 'Capture a signed-in browser session when this journey requires an account, or continue without one for a public flow.'
          : 'This application redirected FormCrash to a login page. Sign in once so FormCrash can save the browser session. Your credentials will not be stored.';

  return (
    <StateMessage variant={gate.readyToRetry ? 'neutral' : 'warning'}>
      <strong>{heading}</strong>
      <p>{message}</p>
      {gate.error === null ? null : <p>{gate.error}</p>}
      {confirmingPublicChoice ? (
        <StateMessage variant="warning">
          <strong>Continue without sign-in?</strong>
          <p>
            Choose this when the complete journey you want to record is publicly
            accessible. If FormCrash reaches a login page later, you can capture
            a signed-in session then.
          </p>
          <div className="guided-action-row">
            <button
              className="button button-primary button-compact"
              disabled={gate.busy}
              onClick={() => {
                setConfirmingPublicChoice(false);
                void gate.continueWithoutSignIn();
              }}
              type="button"
            >
              Continue without sign-in
            </button>
            <button
              className="button button-secondary button-compact"
              disabled={gate.busy}
              onClick={() => setConfirmingPublicChoice(false)}
              type="button"
            >
              Cancel
            </button>
          </div>
        </StateMessage>
      ) : null}
      <div className="guided-action-row">
        {gate.readyToRetry ? (
          <button
            className="button button-primary button-compact"
            disabled={gate.busy}
            onClick={() => onRetry(gate.pending!)}
            type="button"
          >
            {retryLabel(gate.pending)}
          </button>
        ) : awaitingConfirmation ? (
          <button
            className="button button-primary button-compact"
            disabled={gate.busy}
            onClick={() => void gate.confirmCapture()}
            type="button"
          >
            {gate.busy ? 'Saving session…' : 'Save signed-in session'}
          </button>
        ) : gate.reason === 'verification_failed' ? (
          <button
            className="button button-primary button-compact"
            disabled={gate.busy}
            onClick={() => void gate.recheck()}
            type="button"
          >
            {gate.busy ? 'Checking access…' : 'Check access again'}
          </button>
        ) : (
          <>
            <button
              className="button button-primary button-compact"
              disabled={gate.busy}
              onClick={() => void gate.startCapture()}
              type="button"
            >
              {gate.busy
                ? 'Opening browser…'
                : gate.reason === 'expired'
                  ? 'Capture sign-in again'
                  : 'Capture sign-in'}
            </button>
            {gate.reason === 'not_configured' ? (
              <button
                className="button button-secondary button-compact"
                disabled={gate.busy}
                onClick={() => setConfirmingPublicChoice(true)}
                type="button"
              >
                Continue without sign-in
              </button>
            ) : null}
          </>
        )}
        <button
          className="button button-secondary button-compact"
          disabled={gate.busy}
          onClick={() => {
            setConfirmingPublicChoice(false);
            void gate.cancel();
          }}
          type="button"
        >
          Cancel
        </button>
      </div>
    </StateMessage>
  );
}

function accessAllowed(
  result: AuthValidationResult,
  settings: ProjectExecutionSettings,
): boolean {
  if (result.status !== 'valid') return false;
  if (result.outcome === 'authenticated') return true;
  if (
    result.outcome === 'target_accessible' ||
    result.outcome === 'public' ||
    result.outcome === undefined
  ) {
    return (
      settings.authentication.requirement === 'user_confirmed_public' ||
      settings.authentication.available
    );
  }
  return false;
}

function recoveryReason(
  result: AuthValidationResult,
  settings: ProjectExecutionSettings,
): RecoveryReason {
  if (result.outcome === 'authentication_expired') return 'expired';
  if (
    result.status === 'valid' &&
    (result.outcome === 'target_accessible' || result.outcome === 'public') &&
    settings.authentication.requirement !== 'user_confirmed_public'
  )
    return 'not_configured';
  if (
    result.outcome === 'authentication_required' ||
    result.status === 'invalid'
  )
    return 'required';
  return 'verification_failed';
}

function retryLabel(operation: PendingProtectedOperation): string {
  if (operation.kind === 'startRecording') return 'Start recording';
  if (operation.kind === 'replayJourney') return 'Retry replay';
  if (operation.kind === 'startRequestDiscovery')
    return 'Retry request discovery';
  if (operation.kind === 'startOutcomeBaseline')
    return 'Retry outcome baseline';
  return 'Retry experiment';
}

function messageOf(reason: unknown): string {
  return reason instanceof Error
    ? reason.message
    : 'Authentication setup could not be completed.';
}
