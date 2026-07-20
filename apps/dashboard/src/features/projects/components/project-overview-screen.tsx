'use client';

import Link from 'next/link';
import { useEffect, useRef, useState } from 'react';
import type {
  AuthCaptureSession,
  ExternalRunSummary,
  ProjectAuthStatus,
  ProjectExecutionSettings,
} from '@formcrash/contracts';

import { StateMessage } from '../../../components/ui/state-message';
import {
  StatusBadge,
  type StatusTone,
} from '../../../components/ui/status-badge';
import { formatDuration, formatLocalDateTime } from '../../../lib/formatters';
import { getProject } from '../api/projects';
import {
  clearAuthentication,
  confirmAuthenticationCapture,
  continueWithoutAuthentication,
  getProjectSettings,
  startAuthenticationCapture,
  testAuthentication,
} from '../api/external-experiments';
import {
  loadProjectCrmData,
  scenarioSetupLabel,
  verdictLabel,
  type ProjectCrmData,
  type ScenarioLineage,
} from './crm-project-data';

export function ProjectOverviewScreen({
  projectId,
}: {
  readonly projectId: string;
}) {
  const [data, setData] = useState<ProjectCrmData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [authCapture, setAuthCapture] = useState<AuthCaptureSession | null>(
    null,
  );
  const [authBusy, setAuthBusy] = useState<string | null>(null);
  const [authMessage, setAuthMessage] = useState<string | null>(null);
  const [confirmPublicChoice, setConfirmPublicChoice] = useState(false);
  const authActionActive = useRef(false);
  const verifiedSavedAuthentication = useRef<string | null>(null);

  useEffect(() => {
    let active = true;
    setError(null);
    void getProject(projectId)
      .then((project) => loadProjectCrmData(project, 20))
      .then((next) => {
        if (active) setData(next);
      })
      .catch((reason: unknown) => {
        if (active) setError(messageOf(reason));
      });
    return () => {
      active = false;
    };
  }, [projectId]);

  const updateSettings = (settings: ProjectExecutionSettings): void => {
    setData((current) =>
      current === null
        ? current
        : { ...current, settings: { status: 'available', value: settings } },
    );
  };

  async function refreshAuthentication(): Promise<ProjectExecutionSettings> {
    const settings = await getProjectSettings(projectId);
    updateSettings(settings);
    return settings;
  }

  async function checkAccess(): Promise<void> {
    if (authActionActive.current) return;
    authActionActive.current = true;
    setAuthBusy('check');
    setAuthMessage(null);
    try {
      const result = await testAuthentication(projectId);
      await refreshAuthentication();
      setAuthMessage(result.message);
    } catch (reason: unknown) {
      setAuthMessage(messageOf(reason));
    } finally {
      authActionActive.current = false;
      setAuthBusy(null);
    }
  }

  async function startAuthCapture(): Promise<void> {
    if (authActionActive.current) return;
    authActionActive.current = true;
    setAuthBusy('capture');
    setAuthMessage(null);
    try {
      setAuthCapture(await startAuthenticationCapture(projectId));
    } catch (reason: unknown) {
      setAuthMessage(messageOf(reason));
    } finally {
      authActionActive.current = false;
      setAuthBusy(null);
    }
  }

  async function confirmAuthCapture(): Promise<void> {
    if (authActionActive.current || authCapture === null) return;
    authActionActive.current = true;
    setAuthBusy('confirm');
    setAuthMessage(null);
    try {
      const completed = await confirmAuthenticationCapture(
        projectId,
        authCapture.id,
      );
      setAuthCapture(completed);
      if (completed.status !== 'completed') {
        setAuthMessage(
          completed.errorMessage ??
            'Authentication state could not be saved locally.',
        );
        return;
      }
      const result = await testAuthentication(projectId);
      await refreshAuthentication();
      setAuthMessage(
        result.status === 'valid'
          ? 'Authentication saved. Your browser session is ready.'
          : result.message,
      );
    } catch (reason: unknown) {
      setAuthMessage(messageOf(reason));
    } finally {
      authActionActive.current = false;
      setAuthBusy(null);
    }
  }

  async function removeAuthentication(): Promise<void> {
    if (
      authActionActive.current ||
      !window.confirm('Clear saved authentication for this project?')
    )
      return;
    authActionActive.current = true;
    setAuthBusy('clear');
    try {
      updateSettings(await clearAuthentication(projectId));
      setAuthCapture(null);
      setAuthMessage('Saved authentication was cleared.');
    } catch (reason: unknown) {
      setAuthMessage(messageOf(reason));
    } finally {
      authActionActive.current = false;
      setAuthBusy(null);
    }
  }

  async function confirmContinueWithoutSignIn(): Promise<void> {
    if (authActionActive.current) return;
    authActionActive.current = true;
    setAuthBusy('continue');
    setAuthMessage(null);
    try {
      updateSettings(await continueWithoutAuthentication(projectId));
      setConfirmPublicChoice(false);
    } catch (reason: unknown) {
      setAuthMessage(messageOf(reason));
    } finally {
      authActionActive.current = false;
      setAuthBusy(null);
    }
  }

  useEffect(() => {
    const authentication =
      data?.settings.status === 'available'
        ? data.settings.value.authentication
        : null;
    if (
      authentication?.available !== true ||
      authentication.verification === 'valid' ||
      verifiedSavedAuthentication.current === projectId
    )
      return;
    verifiedSavedAuthentication.current = projectId;
    void checkAccess();
  }, [data, projectId]);

  if (error !== null)
    return <StateMessage variant="error">{error}</StateMessage>;
  if (data === null)
    return (
      <StateMessage variant="loading">Loading project overview…</StateMessage>
    );

  const scenarios =
    data.scenarios.status === 'available' ? data.scenarios.value : [];
  const runs = data.runs.status === 'available' ? data.runs.value : [];
  const primaryScenario = scenarios[0] ?? null;
  const action = dominantAction(projectId, primaryScenario);
  const latestRun = primaryScenario?.latestCompatibleRun ?? runs[0] ?? null;
  const settings =
    data.settings.status === 'available' ? data.settings.value : null;
  const variableCount = settings?.variables.length ?? null;
  const missingVariables =
    settings?.variables.filter((variable) => !variable.configured) ?? [];

  return (
    <main className="dashboard-shell crm-screen crm-overview-screen">
      <header className="crm-page-heading crm-record-heading">
        <div>
          <p className="eyebrow">Project record</p>
          <h1>Overview</h1>
          <p>
            {data.project.description ||
              `Operational workspace for ${safeOrigin(data.project.targetUrl)}.`}
          </p>
        </div>
        <Link className="button button-primary" href={action.href}>
          {action.label}
        </Link>
      </header>

      <section className="crm-status-strip" aria-label="Project status">
        <StatusFact
          label="Environment"
          tone={
            data.project.environment === 'production' ? 'warning' : 'neutral'
          }
          value={sentenceCase(data.project.environment)}
        />
        <StatusFact
          label="Authentication"
          tone={
            settings === null
              ? 'neutral'
              : authenticationState(settings.authentication, authCapture) ===
                    'connected' ||
                  authenticationState(settings.authentication, authCapture) ===
                    'user_confirmed_public'
                ? 'pass'
                : 'warning'
          }
          value={
            settings === null
              ? 'Unavailable'
              : authenticationLabel(
                  authenticationState(settings.authentication, authCapture),
                )
          }
        />
        <StatusFact
          label="Runtime variables"
          tone={
            variableCount === null
              ? 'neutral'
              : missingVariables.length === 0
                ? 'pass'
                : 'warning'
          }
          value={
            variableCount === null
              ? 'Unavailable'
              : missingVariables.length > 0
                ? `${missingVariables.length} missing`
                : `${variableCount} ready`
          }
        />
        <StatusFact
          label="Scenario setup"
          tone={setupTone(primaryScenario)}
          value={
            primaryScenario === null
              ? data.scenarios.status === 'unavailable'
                ? 'Unavailable'
                : 'Not recorded'
              : scenarioSetupLabel(primaryScenario.setupState)
          }
        />
        <StatusFact
          label="Latest compatible verdict"
          tone={runTone(latestRun)}
          value={verdictLabel(latestRun)}
        />
      </section>

      {settings === null ? null : (
        <AuthenticationOverviewCard
          authentication={settings.authentication}
          busy={authBusy}
          capture={authCapture}
          confirmingPublicChoice={confirmPublicChoice}
          message={authMessage}
          onCapture={() => void startAuthCapture()}
          onClear={() => void removeAuthentication()}
          onConfirm={() => void confirmAuthCapture()}
          onConfirmPublic={() => void confirmContinueWithoutSignIn()}
          onContinueWithoutSignIn={() => setConfirmPublicChoice(true)}
          onCancelPublic={() => setConfirmPublicChoice(false)}
          onTest={() => void checkAccess()}
        />
      )}

      <div className="crm-overview-layout">
        <div className="crm-overview-primary">
          <OverviewScenarios projectId={projectId} scenarios={scenarios} />
          <OverviewRuns runs={runs} />
        </div>
        <aside className="crm-readiness-rail" aria-labelledby="readiness-title">
          <div className="crm-rail-heading">
            <p className="eyebrow">Readiness</p>
            <h2 id="readiness-title">Project controls</h2>
          </div>
          <dl className="crm-rail-facts">
            <RailFact
              label="Target origin"
              value={safeOrigin(data.project.targetUrl)}
            />
            <RailFact
              label="Environment"
              value={sentenceCase(data.project.environment)}
            />
            <RailFact
              label="Authentication"
              value={
                settings === null
                  ? 'Unavailable'
                  : authenticationLabel(
                      authenticationState(settings.authentication, authCapture),
                    )
              }
            />
            <RailFact
              label="Runtime declarations"
              value={
                variableCount === null
                  ? 'Unavailable'
                  : `${variableCount} declared · ${missingVariables.length} missing`
              }
            />
            <RailFact
              label="Preparation hook"
              value={
                settings === null
                  ? 'Unavailable'
                  : settings.beforeRunHook === null
                    ? 'Not configured'
                    : 'Configured'
              }
            />
            <RailFact
              label="Cleanup hook"
              value={
                settings === null
                  ? 'Unavailable'
                  : settings.afterRunHook === null
                    ? 'Not configured'
                    : 'Configured'
              }
            />
            <RailFact
              label="Production boundary"
              value={
                data.project.environment === 'production'
                  ? 'Confirmation required for every execution'
                  : 'No production confirmation required'
              }
            />
            <RailFact
              label="Browser ownership"
              value="Exclusive · one browser workload at a time"
            />
          </dl>
          <Blockers
            data={data}
            missingVariables={missingVariables.map((variable) => variable.name)}
            scenario={primaryScenario}
          />
          <Link href={`/projects/${projectId}/settings`}>Review settings</Link>
        </aside>
      </div>
    </main>
  );
}

function AuthenticationOverviewCard({
  authentication,
  busy,
  capture,
  confirmingPublicChoice,
  message,
  onCapture,
  onClear,
  onConfirm,
  onConfirmPublic,
  onContinueWithoutSignIn,
  onCancelPublic,
  onTest,
}: {
  readonly authentication: ProjectAuthStatus;
  readonly busy: string | null;
  readonly capture: AuthCaptureSession | null;
  readonly confirmingPublicChoice: boolean;
  readonly message: string | null;
  readonly onCapture: () => void;
  readonly onClear: () => void;
  readonly onConfirm: () => void;
  readonly onConfirmPublic: () => void;
  readonly onContinueWithoutSignIn: () => void;
  readonly onCancelPublic: () => void;
  readonly onTest: () => void;
}) {
  const state = authenticationState(authentication, capture);
  const connected = state === 'connected';
  const expired = state === 'expired';
  const required = state === 'authentication_required';
  const userConfirmedPublic = state === 'user_confirmed_public';
  return (
    <section
      aria-labelledby="project-authentication-title"
      className="panel crm-authentication-card"
    >
      <div>
        <p className="eyebrow">Project prerequisite</p>
        <h2 id="project-authentication-title">Authentication</h2>
        <StatusBadge
          tone={
            connected || userConfirmedPublic
              ? 'pass'
              : expired || required || state === 'verification_failed'
                ? 'warning'
                : 'neutral'
          }
        >
          {authenticationLabel(state)}
        </StatusBadge>
      </div>
      <div>
        {state === 'not_configured' ? (
          <p>Does the journey you want to test require sign-in?</p>
        ) : null}
        <p>{authenticationDescription(state)}</p>
        {connected ? (
          <p>
            Last verified:{' '}
            {formatLocalDateTime(
              authentication.lastCheckedAt ?? authentication.capturedAt,
            )}
          </p>
        ) : null}
        {message === null ? null : <p className="technical-note">{message}</p>}
        {confirmingPublicChoice ? (
          <StateMessage variant="warning">
            <strong>Continue without sign-in?</strong>
            <p>
              Choose this when the complete journey you want to record is
              publicly accessible. If FormCrash reaches a login page later, you
              can capture a signed-in session then.
            </p>
            <div className="guided-action-row">
              <button
                className="button button-primary button-compact"
                disabled={busy !== null}
                onClick={onConfirmPublic}
                type="button"
              >
                {busy === 'continue'
                  ? 'Saving choice…'
                  : 'Continue without sign-in'}
              </button>
              <button
                className="button button-secondary button-compact"
                disabled={busy !== null}
                onClick={onCancelPublic}
                type="button"
              >
                Cancel
              </button>
            </div>
          </StateMessage>
        ) : null}
        <div className="crm-form-actions">
          {capture?.status === 'awaiting_confirmation' ? (
            <button
              className="button button-primary"
              disabled={busy !== null}
              onClick={onConfirm}
              type="button"
            >
              {busy === 'confirm' ? 'Saving…' : 'Save signed-in session'}
            </button>
          ) : connected ? (
            <>
              <button
                className="button button-secondary"
                disabled={busy !== null}
                onClick={onTest}
                type="button"
              >
                {busy === 'check' ? 'Testing…' : 'Test session'}
              </button>
              <button
                className="button button-secondary"
                disabled={busy !== null}
                onClick={onCapture}
                type="button"
              >
                Replace sign-in
              </button>
              <button
                className="button button-destructive"
                disabled={busy !== null}
                onClick={onClear}
                type="button"
              >
                Clear
              </button>
            </>
          ) : (
            <>
              <button
                className="button button-primary"
                disabled={busy !== null}
                onClick={onCapture}
                type="button"
              >
                {busy === 'capture'
                  ? 'Opening browser…'
                  : expired
                    ? 'Capture sign-in again'
                    : 'Capture sign-in'}
              </button>
              {!expired ? (
                <button
                  className="button button-secondary"
                  disabled={busy !== null}
                  onClick={onContinueWithoutSignIn}
                  type="button"
                >
                  Continue without sign-in
                </button>
              ) : null}
              {userConfirmedPublic ? (
                <button
                  className="button button-secondary"
                  disabled={busy !== null}
                  onClick={onTest}
                  type="button"
                >
                  {busy === 'check'
                    ? 'Checking access…'
                    : 'Check target access'}
                </button>
              ) : null}
            </>
          )}
        </div>
      </div>
    </section>
  );
}

type AuthenticationPresentationState =
  | 'not_configured'
  | 'capture_in_progress'
  | 'connected'
  | 'expired'
  | 'user_confirmed_public'
  | 'authentication_required'
  | 'verification_failed';

function authenticationState(
  authentication: ProjectAuthStatus,
  capture: AuthCaptureSession | null,
): AuthenticationPresentationState {
  if (capture?.status === 'awaiting_confirmation') return 'capture_in_progress';
  if (authentication.verification === 'expired') return 'expired';
  if (
    authentication.verification === 'failed' ||
    authentication.verification === 'inconclusive'
  )
    return 'verification_failed';
  if (authentication.available && authentication.verification === 'valid')
    return 'connected';
  if (authentication.requirement === 'user_confirmed_public')
    return 'user_confirmed_public';
  if (authentication.requirement === 'required')
    return 'authentication_required';
  if (authentication.available) return 'connected';
  return 'not_configured';
}

function authenticationLabel(state: AuthenticationPresentationState): string {
  if (state === 'connected') return 'Signed in';
  if (state === 'expired') return 'Sign-in expired';
  if (state === 'user_confirmed_public') return 'Continuing without sign-in';
  if (state === 'authentication_required') return 'Sign-in required';
  if (state === 'verification_failed') return 'Could not verify session';
  if (state === 'capture_in_progress') return 'Capture in progress';
  return 'Not configured';
}

function authenticationDescription(
  state: AuthenticationPresentationState,
): string {
  if (state === 'connected')
    return 'FormCrash will use this saved browser session for protected journeys.';
  if (state === 'user_confirmed_public')
    return 'You chose to continue without a saved browser session. Capture sign-in at any time if a protected step requires it.';
  if (state === 'authentication_required')
    return 'Required before FormCrash can record or replay protected journeys.';
  if (state === 'expired')
    return 'FormCrash reached the login page instead of the application.';
  if (state === 'capture_in_progress')
    return 'Sign in inside the visible Chromium window, then save the session.';
  if (state === 'verification_failed')
    return 'FormCrash could not verify target access. Retry the bounded access check.';
  return 'Capture a signed-in browser session when the journey you want to test requires an account. You can continue without one for public flows.';
}

function OverviewScenarios({
  projectId,
  scenarios,
}: {
  readonly projectId: string;
  readonly scenarios: readonly ScenarioLineage[];
}) {
  return (
    <section
      className="panel crm-record-panel"
      aria-labelledby="recent-scenarios"
    >
      <div className="section-heading-row">
        <div>
          <p className="eyebrow">Recent records</p>
          <h2 id="recent-scenarios">Scenarios</h2>
        </div>
        <Link href={`/projects/${projectId}/scenarios`}>View all</Link>
      </div>
      {scenarios.length === 0 ? (
        <div className="empty-state crm-compact-empty">
          <h3>No Scenarios recorded</h3>
          <p>Record a successful browser flow to begin setup.</p>
        </div>
      ) : (
        <div className="crm-table-wrap">
          <table className="crm-table crm-overview-table">
            <thead>
              <tr>
                <th scope="col">Scenario</th>
                <th scope="col">Version</th>
                <th scope="col">Setup</th>
                <th scope="col">Latest verdict</th>
                <th aria-label="Actions" scope="col" />
              </tr>
            </thead>
            <tbody>
              {scenarios.slice(0, 5).map((scenario) => (
                <tr key={scenario.selectedJourney.id}>
                  <td data-label="Scenario">
                    <Link
                      className="crm-primary-link"
                      href={`/projects/${projectId}/journeys/${scenario.selectedJourney.id}`}
                    >
                      <strong>{scenario.name}</strong>
                      <span>{formatLocalDateTime(scenario.updatedAt)}</span>
                    </Link>
                  </td>
                  <td data-label="Version">
                    v{scenario.selectedJourney.version}
                  </td>
                  <td data-label="Setup">
                    <StatusBadge tone={setupTone(scenario)}>
                      {scenarioSetupLabel(scenario.setupState)}
                    </StatusBadge>
                  </td>
                  <td data-label="Latest verdict">
                    <StatusBadge tone={runTone(scenario.latestCompatibleRun)}>
                      {scenario.runDataAvailable
                        ? verdictLabel(scenario.latestCompatibleRun)
                        : 'Unavailable'}
                    </StatusBadge>
                  </td>
                  <td data-label="Actions">
                    <Link
                      className="button button-secondary button-compact"
                      href={`/projects/${projectId}/journeys/${scenario.selectedJourney.id}`}
                    >
                      Open
                    </Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

function OverviewRuns({
  runs,
}: {
  readonly runs: readonly ExternalRunSummary[];
}) {
  return (
    <section className="panel crm-record-panel" aria-labelledby="recent-runs">
      <div className="section-heading-row">
        <div>
          <p className="eyebrow">Persisted evidence</p>
          <h2 id="recent-runs">Recent Runs</h2>
        </div>
      </div>
      {runs.length === 0 ? (
        <div className="empty-state crm-compact-empty">
          <h3>No Run evidence</h3>
          <p>A completed Scenario Run will appear here.</p>
        </div>
      ) : (
        <div className="crm-table-wrap">
          <table className="crm-table crm-overview-table">
            <thead>
              <tr>
                <th scope="col">Scenario</th>
                <th scope="col">Verdict</th>
                <th scope="col">Started</th>
                <th scope="col">Duration</th>
                <th aria-label="Actions" scope="col" />
              </tr>
            </thead>
            <tbody>
              {runs.slice(0, 5).map((run) => (
                <tr key={run.runId}>
                  <td data-label="Scenario">
                    <strong>{run.journeyName}</strong>
                    <span className="crm-cell-detail">
                      {run.experimentName}
                    </span>
                  </td>
                  <td data-label="Verdict">
                    <StatusBadge tone={runTone(run)}>
                      {verdictLabel(run)}
                    </StatusBadge>
                  </td>
                  <td data-label="Started">
                    {formatLocalDateTime(run.startedAt)}
                  </td>
                  <td data-label="Duration">
                    {formatDuration(run.durationMs)}
                  </td>
                  <td data-label="Actions">
                    <Link
                      className="button button-secondary button-compact"
                      href={`/external-runs/${run.runId}`}
                    >
                      Inspect
                    </Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

function StatusFact({
  label,
  tone,
  value,
}: {
  readonly label: string;
  readonly tone: StatusTone;
  readonly value: string;
}) {
  return (
    <div>
      <span>{label}</span>
      <StatusBadge tone={tone}>{value}</StatusBadge>
    </div>
  );
}

function RailFact({
  label,
  value,
}: {
  readonly label: string;
  readonly value: string;
}) {
  return (
    <div>
      <dt>{label}</dt>
      <dd>{value}</dd>
    </div>
  );
}

function Blockers({
  data,
  missingVariables,
  scenario,
}: {
  readonly data: ProjectCrmData;
  readonly missingVariables: readonly string[];
  readonly scenario: ScenarioLineage | null;
}) {
  const blockers: string[] = [];
  if (data.scenarios.status === 'unavailable') {
    blockers.push('Scenario readiness is unavailable.');
  } else if (scenario === null) {
    blockers.push('Record the first Scenario.');
  } else if (scenario.setupState !== 'ready') {
    blockers.push(scenarioSetupLabel(scenario.setupState));
  }
  if (missingVariables.length > 0) {
    blockers.push(`Missing runtime variables: ${missingVariables.join(', ')}`);
  }
  if (
    data.project.environment === 'production' &&
    data.settings.status === 'available' &&
    data.settings.value.afterRunHook === null
  ) {
    blockers.push('No cleanup hook is configured for this production target.');
  }

  return (
    <section className="crm-rail-blockers" aria-labelledby="blockers-title">
      <h3 id="blockers-title">Relevant blockers</h3>
      {blockers.length === 0 ? (
        <p>No known project-level blockers.</p>
      ) : (
        <ul>
          {blockers.map((blocker) => (
            <li key={blocker}>{blocker}</li>
          ))}
        </ul>
      )}
    </section>
  );
}

export function dominantAction(
  projectId: string,
  scenario: ScenarioLineage | null,
): Readonly<{ href: string; label: string }> {
  if (scenario === null) {
    return {
      href: `/projects/${projectId}/journeys/new`,
      label: 'Record Scenario',
    };
  }
  if (
    scenario.setupState === 'critical_action_needed' ||
    scenario.setupState === 'outcome_checks_needed' ||
    scenario.setupState === 'unavailable'
  ) {
    return {
      href: `/projects/${projectId}/journeys/${scenario.selectedJourney.id}/outcomes`,
      label: 'Complete Setup',
    };
  }
  if (scenario.setupState === 'configuration_needed') {
    return {
      href: `/projects/${projectId}/tests/new?journeyId=${scenario.selectedJourney.id}&step=outcome`,
      label: 'Configure Test',
    };
  }
  const configuration = scenario.configurations[0];
  return configuration === undefined
    ? {
        href: `/projects/${projectId}/tests/new?journeyId=${scenario.selectedJourney.id}&step=outcome`,
        label: 'Configure Test',
      }
    : {
        href: `/projects/${projectId}/tests/${configuration.id}`,
        label: 'Run Scenario Again',
      };
}

function setupTone(scenario: ScenarioLineage | null): StatusTone {
  if (scenario === null || scenario.setupState === 'unavailable')
    return 'neutral';
  return scenario.setupState === 'ready' ? 'pass' : 'warning';
}

function runTone(run: ExternalRunSummary | null): StatusTone {
  if (run === null) return 'neutral';
  if (run.status === 'runner_error' || run.outcomeAggregate === 'failed')
    return 'failure';
  if (run.outcomeAggregate === 'passed') return 'pass';
  if (run.outcomeAggregate === 'could_not_verify') return 'warning';
  return 'neutral';
}

function safeOrigin(value: string): string {
  try {
    return new URL(value).origin;
  } catch {
    return value;
  }
}

function sentenceCase(value: string): string {
  return `${value.slice(0, 1).toUpperCase()}${value.slice(1)}`;
}

function messageOf(reason: unknown): string {
  return reason instanceof Error
    ? reason.message
    : 'The overview could not be loaded.';
}
