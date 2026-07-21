'use client';

import Link from 'next/link';
import { useMemo } from 'react';
import type {
  ExternalTestSummary,
  PersistedJourney,
  Project,
  ProjectExecutionSettings,
  ReplayMode,
  ReplayPacing,
  ReplayResult,
} from '@formcrash/contracts';

import { StateMessage } from '../../../components/ui/state-message';
import { StatusBadge } from '../../../components/ui/status-badge';
import {
  formatCount,
  formatLocalDateTime,
  sentenceCase,
} from '../../../lib/formatters';
import { journeyRuntimeRequirements } from '../models/journey-runtime';
import {
  hasEvaluatedNetworkCoverage,
  testSuiteCheckLabel,
  testSuiteRecipeLabel,
  testSuiteSortOrder,
} from '../models/test-coverage';

export type SavedJourneyView = 'overview' | 'sequence' | 'replay';

interface Props {
  readonly busy: string | null;
  readonly executionSettings: ProjectExecutionSettings | null;
  readonly journeys: readonly PersistedJourney[];
  readonly onDelete: (journey: PersistedJourney) => void;
  readonly onOpenTest: () => void;
  readonly onProductionAcknowledgementChange: (acknowledged: boolean) => void;
  readonly onRecordNewVersion: () => void;
  readonly onReplay: (journey: PersistedJourney) => void;
  readonly onRunTest: (test: ExternalTestSummary) => void;
  readonly onReplayModeChange: (mode: ReplayMode) => void;
  readonly onReplayPacingChange: (pacing: ReplayPacing) => void;
  readonly onRuntimeValueChange: (
    journeyId: string,
    variableName: string,
    value: string,
  ) => void;
  readonly onSelectionChange: (journeyId: string) => void;
  readonly productionReplayAcknowledged: boolean;
  readonly project: Project;
  readonly replayMode: ReplayMode;
  readonly replayPacing: ReplayPacing;
  readonly replayResult: ReplayResult | null;
  readonly replayValues: Readonly<
    Record<string, Readonly<Record<string, string>>>
  >;
  readonly selectedJourneyId: string;
  readonly tests: readonly ExternalTestSummary[];
  readonly view: SavedJourneyView;
}

export function SavedJourneyDetail(props: Props) {
  const tests = useMemo(
    () =>
      [...props.tests].sort(
        (left, right) =>
          testSuiteSortOrder(left.latestVersion) -
            testSuiteSortOrder(right.latestVersion) ||
          Date.parse(left.latestVersion.createdAt) -
            Date.parse(right.latestVersion.createdAt) ||
          left.name.localeCompare(right.name),
      ),
    [props.tests],
  );
  const journey =
    props.journeys.find((item) => item.id === props.selectedJourneyId) ?? null;
  if (journey === null) {
    return (
      <StateMessage variant="error">
        This saved journey version could not be found.
      </StateMessage>
    );
  }

  const names = [...new Set(props.journeys.map((item) => item.name))];
  const versions = props.journeys.filter((item) => item.name === journey.name);
  const requirements = journeyRuntimeRequirements(
    journey,
    props.executionSettings,
  );
  const values = props.replayValues[journey.id] ?? {};
  const missingRequirements = requirements.filter(
    (requirement) => (values[requirement.name] ?? '').trim() === '',
  );
  const traceMissing =
    journey.replayFormat === 'hybrid-v2' && journey.trace == null;
  const productionAcknowledgementMissing =
    props.project.environment === 'production' &&
    !props.productionReplayAcknowledged;
  const replayBlocked =
    props.busy !== null ||
    traceMissing ||
    missingRequirements.length > 0 ||
    productionAcknowledgementMissing;

  function selectJourneyName(name: string): void {
    const next = props.journeys.find((item) => item.name === name);
    if (next !== undefined) props.onSelectionChange(next.id);
  }

  return (
    <section
      className="journey-detail-shell"
      aria-labelledby="saved-journey-title"
    >
      <header className="journey-detail-header">
        <nav aria-label="Breadcrumb" className="journey-breadcrumbs">
          <span>Projects</span>
          <span aria-hidden="true">/</span>
          <span>{props.project.name}</span>
          <span aria-hidden="true">/</span>
          <span aria-current="page">Saved journey</span>
        </nav>

        <div className="journey-header-row">
          <div className="journey-identity">
            <p className="eyebrow">Saved journey</p>
            <h1 id="saved-journey-title">{journey.name}</h1>
            <p className="journey-target-context">
              <span>{props.project.name}</span>
              <code>{safeOrigin(props.project.targetUrl)}</code>
            </p>
            <div className="journey-status-line">
              <StatusBadge tone="pass">Saved</StatusBadge>
              <StatusBadge tone="neutral">
                Version {journey.version}
              </StatusBadge>
              <span>{formatCount(journey.steps.length, 'step')}</span>
            </div>
          </div>

          <div className="journey-next-action saved-journey-actions">
            <span>Use this recording</span>
            {tests.length === 0 ? (
              <button
                className="button button-primary"
                onClick={props.onOpenTest}
                type="button"
              >
                Configure test suite
              </button>
            ) : (
              <StatusBadge tone="pass">
                {formatCount(tests.length, 'test')} ready
              </StatusBadge>
            )}
            <button
              className="button button-secondary"
              onClick={props.onRecordNewVersion}
              type="button"
            >
              Record new version
            </button>
            <small>
              {tests.length === 0
                ? 'Configure this recording once to create its three reusable Tests.'
                : 'Run each Test directly from the suite below.'}
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
            Version
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
            <strong>Immutable recording</strong>
            <span>Created {formatLocalDateTime(journey.createdAt)}</span>
            <small>New recordings create a new version.</small>
          </div>
        </div>
      </header>

      <nav aria-label="Journey sections" className="crm-record-tabs">
        <Link
          aria-current={props.view === 'overview' ? 'page' : undefined}
          href={`/projects/${props.project.id}/journeys/${journey.id}`}
        >
          Overview
        </Link>
        <Link
          aria-current={props.view === 'sequence' ? 'page' : undefined}
          href={`/projects/${props.project.id}/journeys/${journey.id}/sequence`}
        >
          Steps
        </Link>
        <Link
          aria-current={props.view === 'replay' ? 'page' : undefined}
          href={`/projects/${props.project.id}/journeys/${journey.id}/replay`}
        >
          Replay
        </Link>
      </nav>

      {props.view === 'overview' ? (
        <div className="journey-detail-grid">
          <div className="journey-detail-primary-column">
            <section className="panel journey-configuration-card">
              <div className="journey-section-heading">
                <div>
                  <p className="eyebrow">Recording summary</p>
                  <h2>What this journey contains</h2>
                </div>
                <StatusBadge tone={traceMissing ? 'warning' : 'pass'}>
                  {traceMissing ? 'Trace unavailable' : 'Ready to replay'}
                </StatusBadge>
              </div>
              <dl className="crm-metadata-rows">
                <div>
                  <dt>Starts at</dt>
                  <dd>
                    <code>{safePathname(journey.steps[0]?.url)}</code>
                  </dd>
                </div>
                <div>
                  <dt>Finishes at</dt>
                  <dd>
                    <code>{safePathname(journey.steps.at(-1)?.url)}</code>
                  </dd>
                </div>
                <div>
                  <dt>Recorded steps</dt>
                  <dd>{journey.steps.length}</dd>
                </div>
                <div>
                  <dt>Replay format</dt>
                  <dd>{journey.replayFormat}</dd>
                </div>
                <div>
                  <dt>Recording warnings</dt>
                  <dd>{journey.recordingMetadata.warningCount}</dd>
                </div>
              </dl>
            </section>

            <section
              aria-labelledby="journey-tests-title"
              className="panel journey-configuration-card"
            >
              <div className="journey-section-heading">
                <div>
                  <p className="eyebrow">Reusable test suite</p>
                  <h2 id="journey-tests-title">Tests using this journey</h2>
                  <p>
                    Compare the three repeated-action recipes and run any one
                    without changing the saved recording.
                  </p>
                </div>
                <StatusBadge tone={tests.length > 0 ? 'pass' : 'neutral'}>
                  {formatCount(tests.length, 'test')}
                </StatusBadge>
              </div>

              {tests.length === 0 ? (
                <div className="empty-state">
                  <p>No tests use this journey version yet.</p>
                  <button
                    className="button button-primary"
                    onClick={props.onOpenTest}
                    type="button"
                  >
                    Configure test suite
                  </button>
                </div>
              ) : (
                <div className="crm-table-wrap journey-test-suite-table-wrap">
                  <table className="crm-table journey-test-suite-table">
                    <thead>
                      <tr>
                        <th>Test</th>
                        <th>Recipe</th>
                        <th>Checks</th>
                        <th>Latest result</th>
                        <th>Actions</th>
                      </tr>
                    </thead>
                    <tbody>
                      {tests.map((test) => {
                        const version = test.latestVersion;
                        const testRequirements = journeyRuntimeRequirements(
                          version.journeySnapshot,
                          props.executionSettings,
                        );
                        const canRunHere = testRequirements.length === 0;
                        const result = latestRunPresentation(test);
                        return (
                          <tr key={test.testId}>
                            <td data-label="Test">
                              <Link
                                aria-label={`Open ${test.name} test details`}
                                className="journey-test-record-link"
                                href={`/projects/${props.project.id}/tests/${test.testId}`}
                              >
                                <span className="journey-test-record-title">
                                  <strong>{test.name}</strong>
                                  <span aria-hidden="true">→</span>
                                </span>
                                <small>
                                  Test record · Version {version.version}
                                </small>
                              </Link>
                            </td>
                            <td data-label="Recipe">
                              <strong>{testSuiteRecipeLabel(version)}</strong>
                              <small className="journey-test-cell-detail">
                                {version.triggerCount} triggers ·{' '}
                                {version.intervalMs} ms
                              </small>
                            </td>
                            <td data-label="Checks">
                              <strong>{testSuiteCheckLabel(version)}</strong>
                              <small className="journey-test-cell-detail">
                                {hasEvaluatedNetworkCoverage(version)
                                  ? 'Browser and approved request checks'
                                  : 'Browser checks'}
                              </small>
                            </td>
                            <td data-label="Latest result">
                              <StatusBadge tone={result.tone}>
                                {result.label}
                              </StatusBadge>
                              {result.startedAt === null ? null : (
                                <small className="journey-test-cell-detail">
                                  {formatLocalDateTime(result.startedAt)}
                                </small>
                              )}
                            </td>
                            <td data-label="Actions">
                              <div className="journey-test-actions">
                                <div className="journey-test-run-actions">
                                  {canRunHere ? (
                                    <button
                                      aria-label={`Run ${test.name}`}
                                      className="button button-primary button-compact"
                                      disabled={
                                        props.busy !== null ||
                                        productionAcknowledgementMissing
                                      }
                                      onClick={() => props.onRunTest(test)}
                                      type="button"
                                    >
                                      {props.busy === `run-test-${version.id}`
                                        ? 'Running…'
                                        : 'Run test'}
                                    </button>
                                  ) : (
                                    <Link
                                      className="button button-primary button-compact"
                                      href={`/projects/${props.project.id}/tests/${test.testId}`}
                                    >
                                      Enter values &amp; run
                                    </Link>
                                  )}
                                  {test.latestRun === null ? (
                                    <span
                                      aria-disabled="true"
                                      className="button button-secondary button-compact journey-test-run-details-disabled"
                                    >
                                      No run yet
                                    </span>
                                  ) : (
                                    <Link
                                      aria-label={`View latest run details for ${test.name}`}
                                      className="button button-secondary button-compact"
                                      href={`/external-runs/${test.latestRun.runId}`}
                                    >
                                      Run details
                                    </Link>
                                  )}
                                </div>
                                <Link
                                  className="journey-test-edit-link"
                                  href={`/projects/${props.project.id}/tests/${test.testId}#edit-test`}
                                >
                                  Edit test
                                </Link>
                              </div>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              )}

              {tests.length > 0 ? (
                <button
                  className="button button-secondary button-compact"
                  onClick={props.onOpenTest}
                  type="button"
                >
                  New test suite
                </button>
              ) : null}
              {productionAcknowledgementMissing && tests.length > 0 ? (
                <StateMessage variant="warning">
                  Save the production acknowledgement in Replay or Project
                  Settings to enable one-click runs.
                </StateMessage>
              ) : null}
            </section>
          </div>

          <aside
            className="journey-detail-rail"
            aria-label="Journey next steps"
          >
            <section className="panel journey-configuration-card">
              <p className="eyebrow">Next step</p>
              <h2>Turn this recording into a test</h2>
              <p>
                Choose the Critical Action, capture the expected result, and run
                comparisons from one dedicated test flow.
              </p>
            </section>
            <section className="panel journey-configuration-card">
              <p className="eyebrow">Record boundary</p>
              <h2>Saved means immutable</h2>
              <p>
                This version does not change when you configure a test or record
                another version.
              </p>
            </section>
          </aside>
        </div>
      ) : null}

      {props.view === 'sequence' ? <JourneySteps journey={journey} /> : null}

      {props.view === 'replay' ? (
        <ReplayWorkspace
          {...props}
          journey={journey}
          missingRequirements={missingRequirements}
          productionAcknowledgementMissing={productionAcknowledgementMissing}
          replayBlocked={replayBlocked}
          requirements={requirements}
          traceMissing={traceMissing}
          values={values}
        />
      ) : null}

      <div className="journey-detail-footer-actions">
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

function JourneySteps({ journey }: { readonly journey: PersistedJourney }) {
  return (
    <section className="journey-sequence" aria-labelledby="journey-steps-title">
      <div className="journey-section-heading">
        <div>
          <p className="eyebrow">Recorded sequence</p>
          <h2 id="journey-steps-title">Journey steps</h2>
          <p>These steps replay in order. Technical locators stay collapsed.</p>
        </div>
        <StatusBadge tone="neutral">
          {formatCount(journey.steps.length, 'step')}
        </StatusBadge>
      </div>
      <ol className="recorded-step-list">
        {journey.steps.map((step, index) => (
          <li className="recorded-step-row" key={step.id}>
            <span className="recorded-step-number" aria-hidden="true">
              {String(index + 1).padStart(2, '0')}
            </span>
            <div className="recorded-step-content">
              <div className="recorded-step-heading">
                <div>
                  <span className="recorded-step-type">
                    {sentenceCase(step.type)}
                  </span>
                  <h3>{step.name}</h3>
                </div>
              </div>
              <p>
                {describeTarget(step)}
                <span className="recorded-step-path">
                  {safePathname(step.url)}
                </span>
              </p>
              <details className="recorded-step-detail">
                <summary>Technical locator</summary>
                <code>{formatLocator(step.locator)}</code>
              </details>
            </div>
          </li>
        ))}
      </ol>
    </section>
  );
}

function ReplayWorkspace(
  props: Props & {
    readonly journey: PersistedJourney;
    readonly missingRequirements: readonly { readonly name: string }[];
    readonly productionAcknowledgementMissing: boolean;
    readonly replayBlocked: boolean;
    readonly requirements: readonly {
      readonly label: string;
      readonly name: string;
      readonly secret: boolean;
    }[];
    readonly traceMissing: boolean;
    readonly values: Readonly<Record<string, string>>;
  },
) {
  return (
    <div className="journey-detail-grid">
      <div className="journey-detail-primary-column">
        <section className="panel journey-configuration-card">
          <div className="journey-section-heading">
            <div>
              <p className="eyebrow">Normal replay</p>
              <h2>Replay the saved path</h2>
              <p>
                This verifies the recording itself. It does not configure or run
                a test.
              </p>
            </div>
            <StatusBadge tone={props.replayBlocked ? 'warning' : 'pass'}>
              {props.replayBlocked ? 'Needs attention' : 'Ready'}
            </StatusBadge>
          </div>

          <div className="outcome-form-grid">
            <label>
              Replay behavior
              <select
                value={props.replayMode}
                onChange={(event) =>
                  props.onReplayModeChange(event.target.value as ReplayMode)
                }
              >
                <option value="adaptive">Adaptive recovery</option>
                <option value="strict">Strict recorded target</option>
              </select>
            </label>
            <label>
              Pacing
              <select
                value={props.replayPacing}
                onChange={(event) =>
                  props.onReplayPacingChange(event.target.value as ReplayPacing)
                }
              >
                <option value="recorded">Recorded</option>
                <option value="deliberate">Deliberate</option>
                <option value="fast">Fast</option>
              </select>
            </label>
          </div>

          {props.requirements.length > 0 ? (
            <div className="journey-runtime-fields">
              {props.requirements.map((requirement) => (
                <label key={requirement.name}>
                  {requirement.label}
                  <input
                    autoComplete="off"
                    type={requirement.secret ? 'password' : 'text'}
                    value={props.values[requirement.name] ?? ''}
                    onChange={(event) =>
                      props.onRuntimeValueChange(
                        props.journey.id,
                        requirement.name,
                        event.target.value,
                      )
                    }
                  />
                </label>
              ))}
            </div>
          ) : (
            <p>No additional runtime values are required.</p>
          )}

          {props.project.environment === 'production' ? (
            <div className="production-confirmation">
              <label>
                <input
                  checked={props.productionReplayAcknowledged}
                  disabled={props.busy === 'production-replay-acknowledgement'}
                  onChange={(event) =>
                    props.onProductionAcknowledgementChange(
                      event.target.checked,
                    )
                  }
                  type="checkbox"
                />{' '}
                Save my acknowledgement that normal replay can change real
                production data.
              </label>
              <small>
                Saved for this project until you turn it off. It applies to
                normal replay, Outcome capture, and test runs.
              </small>
            </div>
          ) : null}

          {props.traceMissing ? (
            <StateMessage variant="warning">
              The recorded browser trace is unavailable. Record a new version.
            </StateMessage>
          ) : null}
          {props.missingRequirements.length > 0 ? (
            <StateMessage variant="warning">
              Provide {props.missingRequirements.length} required runtime
              value(s).
            </StateMessage>
          ) : null}
          {props.productionAcknowledgementMissing ? (
            <StateMessage variant="warning">
              Save the production replay acknowledgement to continue.
            </StateMessage>
          ) : null}

          <button
            className="button button-primary"
            disabled={props.replayBlocked}
            onClick={() => props.onReplay(props.journey)}
            type="button"
          >
            {props.busy === `replay-${props.journey.id}`
              ? 'Replaying…'
              : 'Replay journey'}
          </button>
        </section>

        {props.replayResult === null ? null : (
          <section className="panel journey-configuration-card" role="status">
            <p className="eyebrow">Latest replay</p>
            <h2>{sentenceCase(props.replayResult.status)}</h2>
            {props.replayResult.failedStep === null ? (
              <p>The saved journey completed.</p>
            ) : (
              <p>
                Step {props.replayResult.failedStep.stepNumber}:{' '}
                {props.replayResult.failedStep.stepName}
              </p>
            )}
          </section>
        )}
      </div>

      <aside className="journey-detail-rail" aria-label="Replay boundaries">
        <section className="panel journey-configuration-card">
          <p className="eyebrow">Authentication</p>
          <h2>Saved browser session</h2>
          <StatusBadge
            tone={
              props.executionSettings?.authentication.available
                ? 'pass'
                : 'neutral'
            }
          >
            {props.executionSettings?.authentication.available
              ? 'Available'
              : 'Not saved'}
          </StatusBadge>
        </section>
        <section className="panel journey-configuration-card">
          <p className="eyebrow">Hooks</p>
          <h2>Preparation and cleanup</h2>
          <p>
            Preparation:{' '}
            {props.executionSettings?.beforeRunHook == null
              ? 'Not configured'
              : 'Configured'}
          </p>
          <p>
            Cleanup:{' '}
            {props.executionSettings?.afterRunHook == null
              ? 'Not configured'
              : 'Configured'}
          </p>
          <Link
            className="button button-secondary button-compact"
            href={`/projects/${props.project.id}/settings`}
          >
            Project settings
          </Link>
        </section>
      </aside>
    </div>
  );
}

function safeOrigin(value: string): string {
  try {
    return new URL(value).origin;
  } catch {
    return value;
  }
}

function latestRunPresentation(test: ExternalTestSummary): {
  readonly label: string;
  readonly tone: 'failure' | 'neutral' | 'pass' | 'warning';
  readonly startedAt: string | null;
} {
  const run = test.latestRun;
  if (run === null)
    return { label: 'Not run', tone: 'neutral', startedAt: null };
  if (run.canonicalVerdict === 'could_not_verify')
    return {
      label: 'Could not verify',
      tone: 'warning',
      startedAt: run.startedAt,
    };
  if (run.canonicalVerdict === 'runner_error')
    return {
      label: 'Runner error',
      tone: 'failure',
      startedAt: run.startedAt,
    };
  if (run.canonicalVerdict === 'failed')
    return { label: 'Failed', tone: 'failure', startedAt: run.startedAt };
  return {
    label:
      run.verdictBasis === 'technical_checks_only'
        ? 'Passed — technical checks only'
        : 'Passed',
    tone: 'pass',
    startedAt: run.startedAt,
  };
}

function safePathname(value: string | undefined): string {
  if (value === undefined) return 'Unavailable';
  try {
    return new URL(value).pathname || '/';
  } catch {
    return value;
  }
}

function describeTarget(step: PersistedJourney['steps'][number]): string {
  const fingerprint = step.fingerprint;
  return (
    fingerprint?.accessibleName ??
    fingerprint?.label ??
    fingerprint?.text ??
    fingerprint?.name ??
    step.locator?.strategy ??
    'Page navigation'
  );
}

function formatLocator(
  locator: PersistedJourney['steps'][number]['locator'],
): string {
  if (locator === null) return 'No element locator';
  return locator.strategy === 'role'
    ? `role=${locator.role}, name=${JSON.stringify(locator.name)}`
    : `${locator.strategy}=${JSON.stringify(locator.value)}`;
}
