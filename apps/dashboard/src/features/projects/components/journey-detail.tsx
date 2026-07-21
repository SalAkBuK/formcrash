'use client';

import { useCallback, useMemo, useState } from 'react';
import Link from 'next/link';
import type {
  AuthCaptureSession,
  CriticalAction,
  OutcomeCheck,
  PersistedJourney,
  Project,
  ProjectExecutionSettings,
  ReplayLocator,
  ReplayMode,
  ReplayPacing,
  ReplayResult,
} from '@formcrash/contracts';

import { CopyButton } from '../../../components/ui/copy-button';
import { DisclosurePanel } from '../../../components/ui/disclosure-panel';
import { StateMessage } from '../../../components/ui/state-message';
import {
  StatusBadge,
  type StatusTone,
} from '../../../components/ui/status-badge';
import { resolveApiUrl } from '../../../lib/api-client';
import {
  formatCount,
  formatLocalDateTime,
  sentenceCase,
} from '../../../lib/formatters';
import { journeyRuntimeRequirements } from '../models/journey-runtime';
import {
  describeOutcomeCheck,
  outcomeCheckTypeLabel,
} from '../models/outcome-check-presentation';
import {
  OutcomeDefinitionPanel,
  type OutcomeDefinitionState,
} from './outcome-definition-panel';

interface JourneyDetailProps {
  readonly authCapture: AuthCaptureSession | null;
  readonly authMessage: string | null;
  readonly authenticationRequired: boolean;
  readonly busy: string | null;
  readonly executionSettings: ProjectExecutionSettings | null;
  readonly journeys: readonly PersistedJourney[];
  readonly loading: boolean;
  readonly onAuthenticationConfirm: () => void;
  readonly onAuthenticationStart: () => void;
  readonly onDelete: (journey: PersistedJourney) => void;
  readonly onManageProjects?: () => void;
  readonly onOpenTest?: () => void;
  readonly onProductionConfirmationChange: (confirmed: boolean) => void;
  readonly onReplay: (journey: PersistedJourney) => void;
  readonly onReplayModeChange: (mode: ReplayMode) => void;
  readonly onReplayPacingChange: (pacing: ReplayPacing) => void;
  readonly onRuntimeValueChange: (
    journeyId: string,
    variableName: string,
    value: string,
  ) => void;
  readonly onSelectionChange: (journeyId: string) => void;
  readonly productionReplayConfirmed: boolean;
  readonly project: Project;
  readonly replayMode: ReplayMode;
  readonly replayPacing: ReplayPacing;
  readonly replayResult: ReplayResult | null;
  readonly replayValues: Readonly<
    Record<string, Readonly<Record<string, string>>>
  >;
  readonly selectedJourneyId: string | null;
  readonly view?: 'overview' | 'sequence' | 'outcomes' | 'replay';
}

const emptyDefinition: OutcomeDefinitionState = {
  checks: [],
  criticalAction: null,
  error: null,
  loading: true,
};

export function JourneyDetail(props: JourneyDetailProps) {
  const journey =
    props.journeys.find((item) => item.id === props.selectedJourneyId) ??
    props.journeys[0] ??
    null;
  const [definition, setDefinition] =
    useState<OutcomeDefinitionState>(emptyDefinition);
  const [definitionJourneyId, setDefinitionJourneyId] = useState<string | null>(
    null,
  );
  const [outcomeExpanded, setOutcomeExpanded] = useState(false);
  const view = props.view ?? 'overview';

  const currentDefinition =
    journey !== null && definitionJourneyId === journey.id
      ? definition
      : emptyDefinition;
  const names = useMemo(
    () => [...new Set(props.journeys.map((item) => item.name))],
    [props.journeys],
  );
  const versions =
    journey === null
      ? []
      : props.journeys.filter((item) => item.name === journey.name);
  const handleDefinitionStateChange = useCallback(
    (state: OutcomeDefinitionState) => {
      if (journey === null) return;
      setDefinitionJourneyId(journey.id);
      setDefinition(state);
    },
    [journey?.id],
  );

  if (props.loading) {
    return (
      <section
        className="journey-detail-shell"
        aria-labelledby="journey-detail-title"
      >
        <h2 className="visually-hidden" id="journey-detail-title">
          Journey detail
        </h2>
        <StateMessage variant="loading">
          Loading saved journey data…
        </StateMessage>
      </section>
    );
  }

  if (journey === null) {
    return (
      <section
        className="panel journey-detail-empty"
        aria-labelledby="journey-detail-title"
      >
        <p className="eyebrow">Journey detail</p>
        <h2 id="journey-detail-title">No saved journey</h2>
        <p>
          Record a normal browser path before selecting a Critical Action or
          approving an expected outcome.
        </p>
        <a
          className="button button-primary journey-primary-action"
          href="#recording-workspace"
        >
          Record journey
        </a>
      </section>
    );
  }

  const requirements = journeyRuntimeRequirements(
    journey,
    props.executionSettings,
  );
  const values = props.replayValues[journey.id] ?? {};
  const missingRequirements = requirements.filter(
    (requirement) => (values[requirement.name] ?? '').trim() === '',
  );
  const criticalStep =
    currentDefinition.criticalAction === null
      ? null
      : (journey.steps.find(
          (step) => step.id === currentDefinition.criticalAction?.stepId,
        ) ?? null);
  const criticalStepIndex =
    criticalStep === null
      ? -1
      : journey.steps.findIndex((step) => step.id === criticalStep.id);
  const traceMissing =
    journey.replayFormat === 'hybrid-v2' && journey.trace == null;
  const productionConfirmationMissing =
    props.project.environment === 'production' &&
    !props.productionReplayConfirmed;
  const replayBlocked =
    props.busy !== null ||
    traceMissing ||
    missingRequirements.length > 0 ||
    productionConfirmationMissing;

  function selectJourneyName(name: string): void {
    const next = props.journeys.find((item) => item.name === name);
    if (next !== undefined) props.onSelectionChange(next.id);
  }

  function openOutcomeConfiguration(): void {
    setOutcomeExpanded(true);
    window.requestAnimationFrame(() => {
      document
        .getElementById('journey-outcome-configuration')
        ?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    });
  }

  const primaryAction = nextAction({
    authenticationRequired: props.authenticationRequired,
    busy: props.busy,
    checks: currentDefinition.checks,
    criticalAction: currentDefinition.criticalAction,
    definitionLoading: currentDefinition.loading,
    missingRuntime: missingRequirements.length > 0,
    onAuthenticationStart: props.onAuthenticationStart,
    onManageProjects: props.onManageProjects ?? (() => undefined),
    onOpenOutcome: openOutcomeConfiguration,
    onReplay: () => props.onReplay(journey),
    productionConfirmationMissing,
    replayBlocked,
    traceMissing,
  });

  return (
    <section
      className="journey-detail-shell"
      aria-labelledby="journey-detail-title"
    >
      <header className="journey-detail-header">
        <nav aria-label="Breadcrumb" className="journey-breadcrumbs">
          <span>Projects</span>
          <span aria-hidden="true">/</span>
          <span title={props.project.name}>{props.project.name}</span>
          <span aria-hidden="true">/</span>
          <span aria-current="page">Journey</span>
        </nav>

        <div className="journey-header-row">
          <div className="journey-identity">
            <p className="eyebrow">Saved journey</p>
            <h2 id="journey-detail-title" title={journey.name}>
              {journey.name}
            </h2>
            <p className="journey-target-context">
              <span>{props.project.name}</span>
              <code title={props.project.targetUrl}>
                {props.project.targetUrl}
              </code>
            </p>
            <div className="journey-status-line">
              <StatusBadge tone="pass">Saved</StatusBadge>
              <StatusBadge
                tone={
                  journey.replayFormat === 'hybrid-v2' ? 'browser' : 'neutral'
                }
              >
                {recordingFormat(journey)}
              </StatusBadge>
              <span>{formatCount(journey.steps.length, 'step')}</span>
            </div>
          </div>

          <div className="journey-next-action">
            <span>Next action</span>
            <button
              className="button button-primary"
              onClick={props.onOpenTest}
              type="button"
            >
              Configure test
            </button>
            {primaryAction}
            {traceMissing ? null : (
              <button
                className="button button-secondary"
                onClick={props.onManageProjects}
                type="button"
              >
                Record new version
              </button>
            )}
            <small>
              Recording again creates a new version. This historical version
              remains unchanged.
            </small>
          </div>
        </div>

        <div className="journey-version-bar">
          <label>
            Journey
            <select
              aria-label="Saved journey"
              value={journey.name}
              onChange={(event) => selectJourneyName(event.target.value)}
            >
              {names.map((name) => (
                <option key={name} value={name}>
                  {name}
                </option>
              ))}
            </select>
          </label>
          <label>
            Immutable version
            <select
              aria-label="Journey version"
              value={journey.id}
              onChange={(event) => props.onSelectionChange(event.target.value)}
            >
              {versions.map((version) => (
                <option key={version.id} value={version.id}>
                  Version {version.version} ·{' '}
                  {formatLocalDateTime(version.createdAt)}
                </option>
              ))}
            </select>
          </label>
          <div className="journey-version-note">
            <strong>Version {journey.version}</strong>
            <span>Created {formatLocalDateTime(journey.createdAt)}</span>
            <small>
              Experiments reference this exact immutable journey version.
            </small>
          </div>
        </div>
      </header>

      <nav aria-label="Journey sections" className="crm-record-tabs">
        <Link
          aria-current={view === 'overview' ? 'page' : undefined}
          href={`/projects/${props.project.id}/journeys/${journey.id}`}
        >
          Overview
        </Link>
        <Link
          aria-current={view === 'sequence' ? 'page' : undefined}
          href={`/projects/${props.project.id}/journeys/${journey.id}/sequence`}
        >
          Sequence
        </Link>
        <Link
          aria-current={view === 'outcomes' ? 'page' : undefined}
          href={`/projects/${props.project.id}/journeys/${journey.id}/outcomes`}
        >
          Outcomes
        </Link>
        <Link
          aria-current={view === 'replay' ? 'page' : undefined}
          href={`/projects/${props.project.id}/journeys/${journey.id}/replay`}
        >
          Replay
        </Link>
      </nav>

      <div className="journey-detail-grid">
        <div className="journey-detail-primary-column">
          {view === 'overview' || view === 'sequence' ? (
            <section
              className="journey-sequence"
              aria-labelledby="recorded-sequence-title"
            >
              <div className="journey-section-heading">
                <div>
                  <p className="eyebrow">Recorded sequence</p>
                  <h3 id="recorded-sequence-title">What will replay</h3>
                  <p>
                    Readable intent leads; locators and recorded fingerprints
                    stay collapsed.
                  </p>
                </div>
                <StatusBadge tone="neutral">
                  {formatCount(journey.steps.length, 'step')}
                </StatusBadge>
              </div>
              <ol className="recorded-step-list">
                {journey.steps.map((step, index) => {
                  const isCritical =
                    step.id === currentDefinition.criticalAction?.stepId;
                  const valueIdentities = safeValueIdentities(step);
                  const locatorWarning = step.locator?.strategy === 'css';
                  return (
                    <li
                      className={`recorded-step-row${isCritical ? ' recorded-step-critical' : ''}`}
                      key={step.id}
                    >
                      <span className="recorded-step-number" aria-hidden="true">
                        {String(index + 1).padStart(2, '0')}
                      </span>
                      <div className="recorded-step-content">
                        <div className="recorded-step-heading">
                          <div>
                            <span className="recorded-step-type">
                              {sentenceCase(step.type)}
                            </span>
                            <h4>{step.name}</h4>
                          </div>
                          {isCritical ? (
                            <StatusBadge tone="disruption">
                              Critical Action
                            </StatusBadge>
                          ) : null}
                        </div>
                        <p>
                          {describeStep(step.type, describeTarget(step))}
                          <span className="recorded-step-path">
                            {safePathname(step.url)}
                          </span>
                        </p>
                        <div className="recorded-step-flags">
                          {valueIdentities.map((identity) => (
                            <code key={identity}>{identity}</code>
                          ))}
                          {locatorWarning ? (
                            <span className="journey-inline-warning">
                              Brittle CSS locator
                            </span>
                          ) : null}
                          {step.sensitive ? <span>Value redacted</span> : null}
                        </div>
                        <details className="recorded-step-detail">
                          <summary>Technical step detail</summary>
                          <dl>
                            <div>
                              <dt>Step ID</dt>
                              <dd>
                                <code>{step.id}</code>
                              </dd>
                            </div>
                            <div>
                              <dt>Replay locator</dt>
                              <dd>
                                <code>{formatLocator(step.locator)}</code>
                              </dd>
                            </div>
                            <div>
                              <dt>Target</dt>
                              <dd>{describeTarget(step)}</dd>
                            </div>
                            <div>
                              <dt>Page context</dt>
                              <dd>
                                <code>{safePathname(step.url)}</code>
                              </dd>
                            </div>
                            <div>
                              <dt>Recorded offset</dt>
                              <dd>
                                <code>{step.timestamp} ms</code>
                              </dd>
                            </div>
                          </dl>
                          <p>
                            Hybrid target candidates, geometry, frame identity,
                            and postconditions are used by replay where
                            available but are not exposed by the saved-step
                            summary contract.
                          </p>
                        </details>
                      </div>
                    </li>
                  );
                })}
              </ol>
            </section>
          ) : null}

          {view === 'overview' || view === 'outcomes' ? (
            <details className="journey-secondary-configuration" open>
              <summary>Critical Action and Outcome Check summary</summary>
              <section
                className={`critical-action-card${criticalStep === null ? ' critical-action-missing' : ''}`}
                aria-labelledby="critical-action-title"
              >
                <div className="journey-section-heading">
                  <div>
                    <p className="eyebrow">Controlled action</p>
                    <h3 id="critical-action-title">Critical Action</h3>
                  </div>
                  <StatusBadge
                    tone={criticalStep === null ? 'warning' : 'disruption'}
                  >
                    {criticalStep === null ? 'Not selected' : 'Configured'}
                  </StatusBadge>
                </div>
                {criticalStep === null ? (
                  <div className="journey-incomplete-state">
                    <strong>
                      No Critical Action is approved for this version.
                    </strong>
                    <p>
                      Select the saved click or submit that future experiments
                      may repeat.
                    </p>
                    <button
                      className="button button-secondary"
                      onClick={openOutcomeConfiguration}
                      type="button"
                    >
                      Select Critical Action
                    </button>
                  </div>
                ) : (
                  <div className="critical-action-summary">
                    <span className="critical-action-step">
                      Step {criticalStepIndex + 1}
                    </span>
                    <div>
                      <h4>{currentDefinition.criticalAction?.label}</h4>
                      <p>
                        {sentenceCase(criticalStep.type)} ·{' '}
                        {describeTarget(criticalStep)}
                      </p>
                      <small>
                        Locked to journey version {journey.version}. This action
                        is compatible with controlled repeated-action recipes.
                      </small>
                    </div>
                  </div>
                )}
              </section>

              <section
                className="outcome-check-summary"
                aria-labelledby="outcome-checks-title"
              >
                <div className="journey-section-heading">
                  <div>
                    <p className="eyebrow">Approved expectation</p>
                    <h3 id="outcome-checks-title">Outcome Checks</h3>
                  </div>
                  <StatusBadge
                    tone={
                      currentDefinition.checks.length > 0 ? 'pass' : 'warning'
                    }
                  >
                    {currentDefinition.loading
                      ? 'Checking…'
                      : currentDefinition.checks.length > 0
                        ? formatCount(
                            currentDefinition.checks.length,
                            'configured check',
                          )
                        : 'Not configured'}
                  </StatusBadge>
                </div>
                {currentDefinition.loading ? (
                  <StateMessage variant="loading">
                    Loading Critical Action and Outcome Checks…
                  </StateMessage>
                ) : currentDefinition.checks.length === 0 ? (
                  <div className="journey-incomplete-state">
                    <strong>
                      No approved Outcome Check exists for this version.
                    </strong>
                    <p>
                      FormCrash cannot produce an outcome-first conclusion until
                      you approve an expected browser outcome. Absence is
                      incomplete setup, not a failed outcome.
                    </p>
                    <button
                      className="button button-secondary"
                      onClick={openOutcomeConfiguration}
                      type="button"
                    >
                      Define expected outcome
                    </button>
                  </div>
                ) : (
                  <ul className="journey-outcome-list">
                    {currentDefinition.checks.map((check) => (
                      <li key={check.id}>
                        <StatusBadge tone="pass">Ready</StatusBadge>
                        <div>
                          <strong>{describeOutcomeCheck(check)}</strong>
                          <span>{outcomeCheckTypeLabel(check.type)}</span>
                          <code>{outcomeExpectedCondition(check)}</code>
                          <small>
                            Required for the aggregate outcome · approved
                            manually
                          </small>
                        </div>
                      </li>
                    ))}
                  </ul>
                )}
              </section>

              <OutcomeDefinitionPanel
                confirmProduction={!productionConfirmationMissing}
                disabled={props.busy !== null || missingRequirements.length > 0}
                environment={props.project.environment}
                expanded={outcomeExpanded}
                journey={journey}
                onExpandedChange={setOutcomeExpanded}
                onStateChange={handleDefinitionStateChange}
                runtimeValues={nonEmptyValues(values)}
              />
            </details>
          ) : null}
        </div>

        {view === 'overview' || view === 'replay' ? (
          <aside
            className="journey-detail-rail"
            aria-label="Journey configuration and evidence"
          >
            <JourneyReadiness
              authenticationRequired={props.authenticationRequired}
              checks={currentDefinition.checks}
              criticalAction={currentDefinition.criticalAction}
              definitionLoading={currentDefinition.loading}
              executionSettings={props.executionSettings}
              journey={journey}
              missingRuntimeCount={missingRequirements.length}
            />

            <section
              className="journey-configuration-card"
              id="journey-replay-configuration"
            >
              <div className="journey-section-heading">
                <div>
                  <p className="eyebrow">Replay configuration</p>
                  <h3>Behavior and pacing</h3>
                </div>
              </div>
              <label>
                Replay mode
                <select
                  aria-label="Replay mode"
                  value={props.replayMode}
                  onChange={(event) =>
                    props.onReplayModeChange(event.target.value as ReplayMode)
                  }
                >
                  <option value="adaptive">Adaptive</option>
                  <option value="strict">Strict</option>
                </select>
              </label>
              <p className="journey-field-help">
                {props.replayMode === 'adaptive'
                  ? 'Safely ranks recorded semantic strategies and verifies resulting state.'
                  : 'Uses the recorded strategy without adaptive locator recovery.'}
              </p>
              <label>
                Replay pacing
                <select
                  aria-label="Replay pacing"
                  value={props.replayPacing}
                  onChange={(event) =>
                    props.onReplayPacingChange(
                      event.target.value as ReplayPacing,
                    )
                  }
                >
                  <option value="recorded">Recorded</option>
                  <option value="deliberate">Deliberate</option>
                  <option value="fast">Fast</option>
                </select>
              </label>
              <p className="journey-field-help">
                {pacingDescription(props.replayPacing)}
              </p>
              <p className="technical-note">
                Repeated-action injection timing is controlled separately and is
                never changed by normal replay pacing.
              </p>
              {props.project.environment === 'production' ? (
                <label className="production-confirmation">
                  <input
                    checked={props.productionReplayConfirmed}
                    onChange={(event) =>
                      props.onProductionConfirmationChange(event.target.checked)
                    }
                    type="checkbox"
                  />{' '}
                  I understand replay can change real production data.
                </label>
              ) : null}
              {!traceMissing &&
              (currentDefinition.loading ||
                currentDefinition.criticalAction === null ||
                currentDefinition.checks.length === 0 ||
                missingRequirements.length > 0 ||
                props.authenticationRequired ||
                productionConfirmationMissing) ? (
                <button
                  className="button button-secondary"
                  disabled={replayBlocked}
                  onClick={() => props.onReplay(journey)}
                  type="button"
                >
                  {props.busy === `replay-${journey.id}`
                    ? 'Replaying…'
                    : 'Replay'}
                </button>
              ) : null}
            </section>

            <section
              className="journey-configuration-card"
              id="journey-runtime-data"
            >
              <div className="journey-section-heading">
                <div>
                  <p className="eyebrow">Runtime data</p>
                  <h3>Required values</h3>
                </div>
                <StatusBadge
                  tone={missingRequirements.length > 0 ? 'warning' : 'pass'}
                >
                  {missingRequirements.length > 0
                    ? `${missingRequirements.length} missing`
                    : 'Ready'}
                </StatusBadge>
              </div>
              {requirements.length === 0 ? (
                <p>
                  No unresolved runtime values are required for this journey.
                </p>
              ) : (
                <div className="journey-runtime-fields">
                  {requirements.map((requirement) => {
                    const present =
                      (values[requirement.name] ?? '').trim() !== '';
                    return (
                      <label key={requirement.name}>
                        <span>
                          {requirement.label}
                          <StatusBadge tone={present ? 'pass' : 'warning'}>
                            {present ? 'Present' : 'Missing'}
                          </StatusBadge>
                        </span>
                        <input
                          aria-label={`${journey.name} ${requirement.name}`}
                          autoComplete="off"
                          placeholder={requirement.name}
                          type={requirement.secret ? 'password' : 'text'}
                          value={values[requirement.name] ?? ''}
                          onChange={(event) =>
                            props.onRuntimeValueChange(
                              journey.id,
                              requirement.name,
                              event.target.value,
                            )
                          }
                        />
                        <code>{`{{var.${requirement.name}}}`}</code>
                      </label>
                    );
                  })}
                </div>
              )}
              <p className="technical-note">
                Secret values remain masked and are sent ephemerally. Protected
                environment contents and saved authentication data are never
                shown.
              </p>
            </section>

            <AuthenticationCard
              authCapture={props.authCapture}
              authMessage={props.authMessage}
              authenticationRequired={props.authenticationRequired}
              busy={props.busy}
              onConfirm={props.onAuthenticationConfirm}
              onStart={props.onAuthenticationStart}
              settings={props.executionSettings}
            />

            <TraceCard journey={journey} />
          </aside>
        ) : null}
      </div>

      {(view === 'overview' || view === 'replay') &&
      props.authMessage !== null &&
      !props.authenticationRequired ? (
        <StateMessage>{props.authMessage}</StateMessage>
      ) : null}
      {(view === 'overview' || view === 'replay') &&
      props.replayResult !== null ? (
        <ReplaySummary result={props.replayResult} />
      ) : null}

      {view === 'overview' || view === 'sequence' ? (
        <DisclosurePanel
          description="Review explicit browser boundaries and saved recording warnings."
          title="Limitations and recording warnings"
        >
          {journey.recordingMetadata.warningCount > 0 ? (
            <StateMessage variant="warning">
              {formatCount(
                journey.recordingMetadata.warningCount,
                'recording warning',
              )}{' '}
              was saved with this version. The current journey summary does not
              expose individual warning codes.
            </StateMessage>
          ) : (
            <p>No recording warnings were saved with this journey version.</p>
          )}
          <ul className="journey-boundary-list">
            <li>Live CAPTCHA or human verification is not bypassed.</li>
            <li>
              Closed Shadow DOM, browser or OS chrome, and unsupported file
              uploads remain outside replay.
            </li>
            <li>
              Third-party payment authorization and unallowlisted cross-origin
              frames remain unsupported.
            </li>
          </ul>
          <p>
            For CAPTCHA on an application you own, use official provider test
            keys, a staging-only bypass, WAF allowlisting, or an allowlisted
            test account. These boundaries are technical limitations, not failed
            Outcome Checks.
          </p>
        </DisclosurePanel>
      ) : null}

      <div className="journey-detail-footer-actions">
        <button
          className="button button-secondary"
          onClick={props.onOpenTest}
          type="button"
        >
          New test
        </button>
        <button
          className="button button-destructive"
          disabled={props.busy !== null}
          onClick={() => props.onDelete(journey)}
          type="button"
        >
          {props.busy === `delete-journey-${journey.id}`
            ? 'Deleting…'
            : `Delete version ${journey.version}`}
        </button>
      </div>
    </section>
  );
}

function JourneyReadiness({
  authenticationRequired,
  checks,
  criticalAction,
  definitionLoading,
  executionSettings,
  journey,
  missingRuntimeCount,
}: {
  readonly authenticationRequired: boolean;
  readonly checks: readonly OutcomeCheck[];
  readonly criticalAction: CriticalAction | null;
  readonly definitionLoading: boolean;
  readonly executionSettings: ProjectExecutionSettings | null;
  readonly journey: PersistedJourney;
  readonly missingRuntimeCount: number;
}) {
  const trace = tracePresentation(journey);
  const items: readonly Readonly<{
    label: string;
    tone: StatusTone;
    value: string;
  }>[] = [
    {
      label: 'Trace',
      tone: trace.tone,
      value: trace.short,
    },
    {
      label: 'Authentication',
      tone: authenticationRequired
        ? 'failure'
        : executionSettings?.authentication.available === true
          ? 'pass'
          : 'neutral',
      value: authenticationRequired
        ? 'Needs replacement'
        : authenticationLabel(executionSettings),
    },
    {
      label: 'Runtime values',
      tone: missingRuntimeCount > 0 ? 'warning' : 'pass',
      value:
        missingRuntimeCount > 0 ? `${missingRuntimeCount} required` : 'Ready',
    },
    {
      label: 'Critical Action',
      tone: definitionLoading
        ? 'neutral'
        : criticalAction === null
          ? 'warning'
          : 'disruption',
      value: definitionLoading
        ? 'Checking…'
        : criticalAction === null
          ? 'Not selected'
          : 'Configured',
    },
    {
      label: 'Outcome Checks',
      tone: definitionLoading
        ? 'neutral'
        : checks.length === 0
          ? 'warning'
          : 'pass',
      value: definitionLoading
        ? 'Checking…'
        : checks.length === 0
          ? 'Not configured'
          : `${checks.length} ready`,
    },
  ];
  return (
    <section
      className="journey-readiness"
      aria-labelledby="journey-readiness-title"
    >
      <div>
        <p className="eyebrow">Journey readiness</p>
        <h3 id="journey-readiness-title">Replay prerequisites</h3>
      </div>
      <ul>
        {items.map((item) => (
          <li key={item.label}>
            <span>{item.label}</span>
            <StatusBadge tone={item.tone}>{item.value}</StatusBadge>
          </li>
        ))}
      </ul>
    </section>
  );
}

function AuthenticationCard({
  authCapture,
  authMessage,
  authenticationRequired,
  busy,
  onConfirm,
  onStart,
  settings,
}: {
  readonly authCapture: AuthCaptureSession | null;
  readonly authMessage: string | null;
  readonly authenticationRequired: boolean;
  readonly busy: string | null;
  readonly onConfirm: () => void;
  readonly onStart: () => void;
  readonly settings: ProjectExecutionSettings | null;
}) {
  const available = settings?.authentication.available === true;
  return (
    <section className="journey-configuration-card">
      <div className="journey-section-heading">
        <div>
          <p className="eyebrow">Authentication</p>
          <h3>Saved browser state</h3>
        </div>
        <StatusBadge
          tone={
            authenticationRequired ? 'failure' : available ? 'pass' : 'neutral'
          }
        >
          {authenticationRequired
            ? 'Needs replacement'
            : authenticationLabel(settings)}
        </StatusBadge>
      </div>
      <p>
        {authenticationRequired
          ? (authMessage ??
            'Replay detected that the saved sign-in state is no longer usable.')
          : available
            ? `Captured ${formatLocalDateTime(settings?.authentication.capturedAt ?? null)}. FormCrash can restore it without exposing cookies or tokens.`
            : settings?.authentication.configured === true
              ? (settings.authentication.missingReason ??
                'Authentication is configured, but saved state is unavailable.')
              : 'This project has no saved authentication. The contract does not declare whether this journey requires sign-in.'}
      </p>
      {authenticationRequired ? (
        <div className="journey-card-actions">
          <button
            className="button button-secondary"
            disabled={busy !== null}
            onClick={onStart}
            type="button"
          >
            {busy === 'replay-auth-start'
              ? 'Launching sign-in…'
              : 'Sign in again'}
          </button>
          {authCapture?.status === 'awaiting_confirmation' ? (
            <button
              className="button button-primary"
              disabled={busy !== null}
              onClick={onConfirm}
              type="button"
            >
              {busy === 'replay-auth-confirm'
                ? 'Saving session…'
                : 'I am signed in — save session'}
            </button>
          ) : null}
        </div>
      ) : null}
      {authCapture !== null ? (
        <small>Capture status: {sentenceCase(authCapture.status)}</small>
      ) : null}
    </section>
  );
}

function TraceCard({ journey }: { readonly journey: PersistedJourney }) {
  const trace = tracePresentation(journey);
  return (
    <section className="journey-configuration-card journey-trace-card">
      <div className="journey-section-heading">
        <div>
          <p className="eyebrow">Recording evidence</p>
          <h3>Trace and environment</h3>
        </div>
        <StatusBadge tone={trace.tone}>{trace.short}</StatusBadge>
      </div>
      <p>{trace.detail}</p>
      {journey.trace !== null && journey.trace !== undefined ? (
        <dl className="journey-technical-facts">
          <div>
            <dt>Format</dt>
            <dd>hybrid-v2</dd>
          </div>
          <div>
            <dt>Interactions</dt>
            <dd>{journey.trace.interactionCount}</dd>
          </div>
          <div>
            <dt>Raw events</dt>
            <dd>{journey.trace.eventCount}</dd>
          </div>
          <div>
            <dt>Pages / frames</dt>
            <dd>
              {journey.trace.pageCount} / {journey.trace.frameCount}
            </dd>
          </div>
          <div>
            <dt>Artifact size</dt>
            <dd>{formatBytes(journey.trace.sizeBytes)}</dd>
          </div>
          <div>
            <dt>Integrity</dt>
            <dd>Verified when opened for replay</dd>
          </div>
        </dl>
      ) : null}
      <p className="technical-note">
        FormCrash restores recorded browser environment settings where
        supported. Viewport, locale, timezone, color scheme, browser version,
        and user-agent detail are not exposed by the current Journey Detail
        contract.
      </p>
      {journey.trace !== null && journey.trace !== undefined ? (
        <div className="journey-checksum">
          <span>Trace checksum</span>
          <code>{journey.trace.checksumSha256.slice(0, 16)}…</code>
          <CopyButton
            label="Copy trace checksum"
            value={journey.trace.checksumSha256}
          />
        </div>
      ) : null}
      {journey.trace?.videoCaptured === true ? (
        <details className="journey-video-panel">
          <summary>View recording video</summary>
          <p className="state-message state-message-warning">
            Recording video can contain visible test data. Review it only in a
            controlled environment.
          </p>
          <video
            controls
            preload="metadata"
            src={resolveApiUrl(`/api/journeys/${journey.id}/trace/videos/0`)}
          >
            Recorded Chromium video is unavailable in this browser.
          </video>
        </details>
      ) : (
        <p className="journey-video-unavailable">
          Recording video unavailable. This does not imply recording failure.
        </p>
      )}
    </section>
  );
}

function ReplaySummary({ result }: { readonly result: ReplayResult }) {
  return (
    <section
      className={`replay-result replay-${result.status}`}
      role="status"
      aria-labelledby="replay-summary-title"
    >
      <h3 id="replay-summary-title">Replay {result.status}</h3>
      <p>
        {result.failedStep === null
          ? 'Every persisted journey step completed.'
          : `Step ${result.failedStep.stepNumber}, “${result.failedStep.stepName}”, did not complete.`}
      </p>
      {result.failedStep?.technicalMessage ? (
        <p>{result.failedStep.technicalMessage}</p>
      ) : null}
      {result.failedStep !== null ? (
        <details>
          <summary>Replay diagnostics</summary>
          <dl className="replay-diagnostics">
            <div>
              <dt>Locator</dt>
              <dd>
                <code>{formatLocator(result.failedStep.locator)}</code>
              </dd>
            </div>
            <div>
              <dt>Browser path</dt>
              <dd>
                <code>
                  {result.failedStep.currentUrl === null
                    ? 'Unavailable'
                    : safePathname(result.failedStep.currentUrl)}
                </code>
              </dd>
            </div>
            <div>
              <dt>Frame</dt>
              <dd>
                <code>
                  {result.failedStep.pageId ?? 'page-1'}
                  {(result.failedStep.framePath ?? []).length > 0
                    ? ` / ${result.failedStep.framePath?.join(' / ')}`
                    : ''}
                </code>
              </dd>
            </div>
            <div>
              <dt>Side effect observed</dt>
              <dd>
                {result.failedStep.sideEffectObserved === true
                  ? 'Yes — FormCrash did not retry'
                  : 'No'}
              </dd>
            </div>
          </dl>
        </details>
      ) : null}
    </section>
  );
}

function nextAction(input: {
  readonly authenticationRequired: boolean;
  readonly busy: string | null;
  readonly checks: readonly OutcomeCheck[];
  readonly criticalAction: CriticalAction | null;
  readonly definitionLoading: boolean;
  readonly missingRuntime: boolean;
  readonly onAuthenticationStart: () => void;
  readonly onManageProjects: () => void;
  readonly onOpenOutcome: () => void;
  readonly onReplay: () => void;
  readonly productionConfirmationMissing: boolean;
  readonly replayBlocked: boolean;
  readonly traceMissing: boolean;
}) {
  if (input.definitionLoading) {
    return (
      <button
        className="button button-primary journey-primary-action"
        disabled
        type="button"
      >
        Checking readiness…
      </button>
    );
  }
  if (input.traceMissing) {
    return (
      <button
        className="button button-primary journey-primary-action"
        onClick={input.onManageProjects}
        type="button"
      >
        Record new version
      </button>
    );
  }
  if (input.criticalAction === null) {
    return (
      <button
        className="button button-primary journey-primary-action"
        onClick={input.onOpenOutcome}
        type="button"
      >
        Select Critical Action
      </button>
    );
  }
  if (input.checks.length === 0) {
    return (
      <button
        className="button button-primary journey-primary-action"
        onClick={input.onOpenOutcome}
        type="button"
      >
        Define expected outcome
      </button>
    );
  }
  if (input.missingRuntime) {
    return (
      <a
        className="button button-primary journey-primary-action"
        href="#journey-runtime-data"
      >
        Provide required test data
      </a>
    );
  }
  if (input.authenticationRequired) {
    return (
      <button
        className="button button-primary journey-primary-action"
        disabled={input.busy !== null}
        onClick={input.onAuthenticationStart}
        type="button"
      >
        Replace authentication
      </button>
    );
  }
  if (input.productionConfirmationMissing) {
    return (
      <a
        className="button button-primary journey-primary-action"
        href="#journey-replay-configuration"
      >
        Confirm production replay
      </a>
    );
  }
  return (
    <button
      className="button button-primary journey-primary-action"
      disabled={input.replayBlocked}
      onClick={input.onReplay}
      type="button"
    >
      {input.busy?.startsWith('replay-') === true
        ? 'Replaying…'
        : 'Replay journey'}
    </button>
  );
}

function recordingFormat(journey: PersistedJourney): string {
  return journey.replayFormat === 'hybrid-v2' ? 'hybrid-v2' : 'semantic-v1';
}

function tracePresentation(journey: PersistedJourney): Readonly<{
  detail: string;
  short: string;
  tone: StatusTone;
}> {
  if (journey.replayFormat !== 'hybrid-v2') {
    return {
      detail:
        'This historical semantic-v1 journey replays semantic steps without a hybrid trace artifact. It remains supported and is not corrupt.',
      short: 'Semantic compatible',
      tone: 'neutral',
    };
  }
  if (journey.trace == null) {
    return {
      detail:
        'The hybrid trace reference is missing. Replay cannot safely continue; record a new immutable version.',
      short: 'Trace missing',
      tone: 'failure',
    };
  }
  if (journey.trace.truncated) {
    return {
      detail:
        'A bounded hybrid trace reference is available, but recording limits truncated the artifact. Replay verifies its checksum when opening it.',
      short: 'Trace truncated',
      tone: 'warning',
    };
  }
  return {
    detail:
      'A hybrid trace reference is available. FormCrash verifies its checksum and parses the immutable artifact before replay; this list response does not pre-validate the local file.',
    short: 'Trace available',
    tone: 'browser',
  };
}

function authenticationLabel(
  settings: ProjectExecutionSettings | null,
): string {
  if (settings === null) return 'Checking…';
  if (settings.authentication.available) return 'Captured';
  if (settings.authentication.configured) return 'State unavailable';
  return 'Not configured';
}

function describeTarget(step: PersistedJourney['steps'][number]): string {
  return (
    step.fingerprint?.label ??
    step.fingerprint?.accessibleName ??
    step.fingerprint?.name ??
    step.fingerprint?.tagName ??
    (step.type === 'navigate' ? 'page' : 'recorded control')
  );
}

function describeStep(
  type: PersistedJourney['steps'][number]['type'],
  target: string,
): string {
  const verbs: Record<PersistedJourney['steps'][number]['type'], string> = {
    checkbox: 'Set',
    click: 'Activate',
    fill: 'Enter data in',
    navigate: 'Open',
    radio: 'Choose',
    select: 'Select from',
    submit: 'Submit',
  };
  return `${verbs[type]} ${target}.`;
}

function safeValueIdentities(
  step: PersistedJourney['steps'][number],
): readonly string[] {
  if (step.value?.kind === 'sensitive')
    return [`{{var.${step.value.variableName}}}`];
  if (step.value?.kind !== 'safe') return [];
  return [
    ...step.value.value.matchAll(
      /\{\{(?:unique\.[a-z]+|var\.[A-Z][A-Z0-9_]*)\}\}/gu,
    ),
  ].map((match) => match[0]);
}

function safePathname(url: string): string {
  try {
    return new URL(url).pathname || '/';
  } catch {
    return 'Recorded page';
  }
}

function formatLocator(locator: ReplayLocator | null): string {
  if (locator === null) return 'Direct navigation';
  if (locator.strategy === 'role')
    return `role=${locator.role}, name=${JSON.stringify(locator.name)}`;
  return `${locator.strategy}=${JSON.stringify(locator.value)}`;
}

function outcomeExpectedCondition(check: OutcomeCheck): string {
  if (check.type === 'matching_item_appears_exactly_once')
    return `Exactly one match for ${check.binding.template}`;
  if (check.type === 'final_pathname_matches') return check.expectedPathname;
  return 'Approved captured element is visible';
}

function pacingDescription(pacing: ReplayPacing): string {
  if (pacing === 'recorded')
    return 'Preserves recorded pauses with the existing five-second cap.';
  if (pacing === 'deliberate') return 'Waits one second before normal actions.';
  return 'Adds no presentation delay.';
}

function formatBytes(value: number): string {
  if (value < 1024) return `${value} B`;
  if (value < 1024 * 1024) return `${(value / 1024).toFixed(1)} KiB`;
  return `${(value / (1024 * 1024)).toFixed(1)} MiB`;
}

function nonEmptyValues(
  values: Readonly<Record<string, string>>,
): Readonly<Record<string, string>> {
  return Object.fromEntries(
    Object.entries(values).filter(([, value]) => value.trim() !== ''),
  );
}
