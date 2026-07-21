'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useMemo, useState } from 'react';
import type {
  EphemeralRuntimeValues,
  ExternalAssertion,
  ExternalExperimentVersion,
  ExternalRunSummary,
  Project,
  ProjectExecutionSettings,
  ReplayMode,
  ReplayPacing,
} from '@formcrash/contracts';

import { StateMessage } from '../../../components/ui/state-message';
import { StatusBadge } from '../../../components/ui/status-badge';
import {
  createExternalExperimentVersion,
  deleteExternalTest,
  getExternalTestDetail,
  getProjectSettings,
  runExternalExperiment,
  saveProductionReplayAcknowledgement,
} from '../api/external-experiments';
import { getProject } from '../api/projects';
import { formatLocalDateTime, sentenceCase } from '../../../lib/formatters';
import { journeyRuntimeRequirements } from '../models/journey-runtime';
import {
  recipeIdForConfiguration,
  recipeNetworkAssertionsForStatus,
} from '../models/network-evidence';
import {
  hasEvaluatedNetworkCoverage,
  testCoverageLabel,
  testRecipeLabel,
} from '../models/test-coverage';
import {
  TechnicalChecksEditor,
  technicalChecksAreValid,
} from './technical-checks-editor';

interface TestData {
  readonly project: Project;
  readonly settings: ProjectExecutionSettings;
  readonly version: ExternalExperimentVersion;
  readonly versions: readonly ExternalExperimentVersion[];
  readonly runs: readonly ExternalRunSummary[];
  readonly runCount: number;
  readonly versionCount: number;
}

export function TestDetailScreen({
  testId,
  projectId,
}: {
  readonly testId: string;
  readonly projectId: string;
}) {
  const router = useRouter();
  const [data, setData] = useState<TestData | null>(null);
  const [values, setValues] = useState<EphemeralRuntimeValues>({});
  const [replayMode, setReplayMode] = useState<ReplayMode>('adaptive');
  const [replayPacing, setReplayPacing] = useState<ReplayPacing>('recorded');
  const [productionConfirmed, setProductionConfirmed] = useState(false);
  const [editing, setEditing] = useState(false);
  const [editedTriggerCount, setEditedTriggerCount] = useState<2 | 3>(2);
  const [editedIntervalMs, setEditedIntervalMs] = useState<0 | 100 | 300>(0);
  const [editedAssertions, setEditedAssertions] = useState<
    readonly ExternalAssertion[]
  >([]);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    void Promise.all([
      getProject(projectId),
      getProjectSettings(projectId),
      getExternalTestDetail(testId),
    ])
      .then(([project, settings, detail]) => {
        if (!active) return;
        const version = detail.latestVersion;
        if (version.projectId !== projectId)
          throw new Error('This test does not belong to the selected project.');
        setData({
          project,
          settings,
          version,
          versions: detail.versions,
          runs: detail.runs,
          runCount: detail.runCount,
          versionCount: detail.versionCount,
        });
        setEditedTriggerCount(version.triggerCount);
        setEditedIntervalMs(version.intervalMs);
        setEditedAssertions(version.assertions);
        if (window.location.hash === '#edit-test') setEditing(true);
        setProductionConfirmed(settings.productionReplayAcknowledged === true);
        if (testId !== version.experimentId) {
          router.replace(
            `/projects/${projectId}/tests/${version.experimentId}`,
          );
        }
      })
      .catch((reason: unknown) => {
        if (active) setError(messageOf(reason));
      });
    return () => {
      active = false;
    };
  }, [projectId, router, testId]);

  const requirements = useMemo(
    () =>
      data === null
        ? []
        : journeyRuntimeRequirements(
            data.version.journeySnapshot,
            data.settings,
          ),
    [data],
  );
  if (error !== null && data === null)
    return <StateMessage variant="error">{error}</StateMessage>;
  if (data === null)
    return <StateMessage variant="loading">Loading saved test…</StateMessage>;
  const blocked =
    busy !== null ||
    requirements.some((item) => (values[item.name] ?? '').trim() === '') ||
    (data.project.environment === 'production' && !productionConfirmed);

  async function run(): Promise<void> {
    setBusy('run');
    setError(null);
    try {
      const result = await runExternalExperiment(
        data!.version.id,
        values,
        data!.project.environment !== 'production' || productionConfirmed,
        replayMode,
        replayPacing,
      );
      router.push(`/external-runs/${result.runId}`);
    } catch (reason: unknown) {
      setError(messageOf(reason));
      setBusy(null);
    }
  }
  async function saveProductionAcknowledgement(
    acknowledged: boolean,
  ): Promise<void> {
    const previous = productionConfirmed;
    setProductionConfirmed(acknowledged);
    setError(null);
    try {
      const settings = await saveProductionReplayAcknowledgement(
        projectId,
        acknowledged,
      );
      setData((current) =>
        current === null ? null : { ...current, settings },
      );
      setProductionConfirmed(settings.productionReplayAcknowledged === true);
    } catch (reason: unknown) {
      setProductionConfirmed(previous);
      setError(messageOf(reason));
    }
  }
  async function remove(): Promise<void> {
    if (
      !window.confirm(
        `Delete test "${data!.version.name}" and all ${data!.versionCount} saved version${data!.versionCount === 1 ? '' : 's'}, ${data!.runCount} run${data!.runCount === 1 ? '' : 's'}, and screenshots? This cannot be undone.`,
      )
    )
      return;
    setBusy('delete');
    setError(null);
    try {
      await deleteExternalTest(data!.version.experimentId);
      router.push(`/projects/${projectId}/tests`);
    } catch (reason: unknown) {
      setError(messageOf(reason));
      setBusy(null);
    }
  }

  function beginEditing(): void {
    setEditedTriggerCount(data!.version.triggerCount);
    setEditedIntervalMs(data!.version.intervalMs);
    setEditedAssertions(data!.version.assertions);
    setEditing(true);
  }

  async function saveNewVersion(): Promise<void> {
    setBusy('save-version');
    setError(null);
    try {
      const current = data!.version;
      const assertions =
        current.networkEvidenceProvenance == null
          ? [...editedAssertions]
          : [
              ...editedAssertions.filter(
                (assertion) => !assertion.type.startsWith('network_'),
              ),
              ...recipeNetworkAssertionsForStatus(
                recipeIdForConfiguration(editedTriggerCount, editedIntervalMs),
                editedTriggerCount,
                current.networkEvidenceProvenance.observedStatus,
              ),
            ];
      const created = await createExternalExperimentVersion(
        current.experimentId,
        {
          targetStepId: current.targetStepId,
          triggerCount: editedTriggerCount,
          intervalMs: editedIntervalMs,
          networkMatcher: current.networkMatcher,
          assertions,
          continueAfterTarget: current.continueAfterTarget,
          guided: current.guided,
          requestSelectionProvenance: current.requestSelectionProvenance,
          networkEvidenceProvenance: current.networkEvidenceProvenance,
          assertionSelectionProvenance: [
            ...current.assertionSelectionProvenance,
          ],
        },
      );
      setData((existing) =>
        existing === null
          ? null
          : {
              ...existing,
              version: created,
              versions: [created, ...existing.versions],
              versionCount: existing.versionCount + 1,
            },
      );
      setEditing(false);
      setEditedAssertions(created.assertions);
      router.replace(`/projects/${projectId}/tests/${created.experimentId}`);
    } catch (reason: unknown) {
      setError(messageOf(reason));
    } finally {
      setBusy(null);
    }
  }

  return (
    <main className="dashboard-shell crm-screen">
      <header className="crm-record-header">
        <div>
          <p className="eyebrow">Saved test</p>
          <h2>{data.version.name}</h2>
          <Link
            aria-label={`Open ${data.version.journeySnapshot.name} journey version ${data.version.journeySnapshot.version}`}
            className="crm-related-record-link"
            href={`/projects/${projectId}/journeys/${data.version.journeyId}`}
          >
            <span className="crm-related-record-kind">Journey</span>
            <strong>{data.version.journeySnapshot.name}</strong>
            <span className="crm-related-record-meta">
              Version {data.version.journeySnapshot.version}
              <span aria-hidden="true">→</span>
            </span>
          </Link>
          <div className="crm-status-line">
            <StatusBadge tone="pass">Saved test</StatusBadge>
            <StatusBadge tone="disruption">Impatient User</StatusBadge>
            <span>Version {data.version.version}</span>
          </div>
        </div>
        <div className="journey-card-actions">
          <span>
            {data.versionCount} immutable version
            {data.versionCount === 1 ? '' : 's'}
          </span>
          <button
            className="button button-secondary button-compact"
            disabled={busy !== null}
            onClick={beginEditing}
            type="button"
          >
            Edit test
          </button>
        </div>
      </header>
      {error !== null ? (
        <StateMessage variant="error">{error}</StateMessage>
      ) : null}
      {editing ? (
        <section className="panel crm-summary-panel" id="edit-test">
          <p className="eyebrow">Edit test</p>
          <h3>Save a new immutable version</h3>
          <p>
            The stable test name and historical versions stay unchanged. Saving
            creates Version {data.version.version + 1} without running it and
            snapshots every currently approved Outcome Check.
          </p>
          <div className="crm-form-grid">
            <label>
              Trigger count
              <select
                aria-label="Edited trigger count"
                onChange={(event) =>
                  setEditedTriggerCount(Number(event.target.value) as 2 | 3)
                }
                value={editedTriggerCount}
              >
                <option value={2}>2</option>
                <option value={3}>3</option>
              </select>
            </label>
            <label>
              Trigger interval
              <select
                aria-label="Edited trigger interval"
                onChange={(event) =>
                  setEditedIntervalMs(
                    Number(event.target.value) as 0 | 100 | 300,
                  )
                }
                value={editedIntervalMs}
              >
                <option value={0}>0 ms</option>
                <option value={100}>100 ms</option>
                <option value={300}>300 ms</option>
              </select>
            </label>
          </div>
          <TechnicalChecksEditor
            assertions={editedAssertions}
            journey={data.version.journeySnapshot}
            onChange={setEditedAssertions}
          />
          <div className="journey-card-actions">
            <button
              className="button button-primary button-compact"
              disabled={
                busy !== null || !technicalChecksAreValid(editedAssertions)
              }
              onClick={() => void saveNewVersion()}
              type="button"
            >
              {busy === 'save-version' ? 'Saving…' : 'Save new version'}
            </button>
            <button
              className="button button-secondary button-compact"
              disabled={busy !== null}
              onClick={() => setEditing(false)}
              type="button"
            >
              Cancel
            </button>
          </div>
        </section>
      ) : null}
      <div className="crm-record-grid">
        <section className="panel crm-summary-panel">
          <p className="eyebrow">Configuration</p>
          <h3>Repeated-action plan</h3>
          <dl className="crm-record-summary">
            <div>
              <dt>Triggers</dt>
              <dd>{data.version.triggerCount}</dd>
            </div>
            <div>
              <dt>Interval</dt>
              <dd>{data.version.intervalMs} ms</dd>
            </div>
            <div>
              <dt>Required Outcome Checks</dt>
              <dd>{data.version.outcomeCheckSnapshot.checks.length}</dd>
            </div>
            <div>
              <dt>Custom technical checks</dt>
              <dd>
                {
                  data.version.assertions.filter(
                    (assertion) => !assertion.type.startsWith('network_'),
                  ).length
                }
              </dd>
            </div>
            <div>
              <dt>Continue after target</dt>
              <dd>{data.version.continueAfterTarget ? 'Yes' : 'No'}</dd>
            </div>
            <div>
              <dt>Request matcher</dt>
              <dd>
                <code>
                  {data.version.networkMatcher === null
                    ? 'None'
                    : `${data.version.networkMatcher.method} ${data.version.networkMatcher.pathname}`}
                </code>
              </dd>
            </div>
          </dl>
          <div className="guided-review-outcomes">
            <strong>Frozen Outcome Check snapshot</strong>
            {data.version.outcomeCheckSnapshot.checks.length === 0 ? (
              <p>No approved Outcome Checks were included in this version.</p>
            ) : (
              <ul>
                {data.version.outcomeCheckSnapshot.checks.map((check) => (
                  <li key={check.id}>{check.description}</li>
                ))}
              </ul>
            )}
          </div>
          {!hasEvaluatedNetworkCoverage(data.version) ? (
            <StateMessage variant="warning">
              <strong>{testCoverageLabel(data.version)}.</strong> This version
              does not evaluate request counts, response statuses, or server
              errors.
            </StateMessage>
          ) : null}
        </section>
        <section className="panel crm-run-panel">
          <p className="eyebrow">Run test</p>
          <h3>Runtime and safety</h3>
          {requirements.map((item) => (
            <label key={item.name}>
              {item.label}
              <input
                autoComplete="off"
                onChange={(event) =>
                  setValues((current) => ({
                    ...current,
                    [item.name]: event.target.value,
                  }))
                }
                type={item.secret ? 'password' : 'text'}
                value={values[item.name] ?? ''}
              />
              <code>{item.name}</code>
            </label>
          ))}
          <div className="crm-form-grid">
            <label>
              Replay mode
              <select
                onChange={(event) =>
                  setReplayMode(event.target.value as ReplayMode)
                }
                value={replayMode}
              >
                <option value="adaptive">Adaptive</option>
                <option value="strict">Strict</option>
              </select>
            </label>
            <label>
              Replay pacing
              <select
                onChange={(event) =>
                  setReplayPacing(event.target.value as ReplayPacing)
                }
                value={replayPacing}
              >
                <option value="recorded">Recorded</option>
                <option value="deliberate">Deliberate</option>
                <option value="fast">Fast</option>
              </select>
            </label>
          </div>
          {data.project.environment === 'production' ? (
            <label className="production-confirmation">
              <input
                checked={productionConfirmed}
                onChange={(event) =>
                  void saveProductionAcknowledgement(event.target.checked)
                }
                type="checkbox"
              />{' '}
              Save my acknowledgement that browser runs can change real
              production data.
            </label>
          ) : null}
          <button
            className="button button-primary crm-sticky-action"
            disabled={blocked}
            onClick={() => void run()}
            type="button"
          >
            {busy === 'run' ? 'Running…' : 'Run test'}
          </button>
        </section>
      </div>
      <div className="crm-record-grid">
        <section className="panel crm-summary-panel">
          <p className="eyebrow">Version history</p>
          <h3>Immutable configurations</h3>
          <div className="crm-table-wrap">
            <table className="crm-table">
              <thead>
                <tr>
                  <th>Version</th>
                  <th>Recipe</th>
                  <th>Timing</th>
                  <th>Created</th>
                </tr>
              </thead>
              <tbody>
                {data.versions.map((version) => (
                  <tr key={version.id}>
                    <td>
                      <strong>Version {version.version}</strong>
                    </td>
                    <td>{testRecipeLabel(version)}</td>
                    <td>
                      {version.triggerCount} triggers, {version.intervalMs} ms
                    </td>
                    <td>{formatLocalDateTime(version.createdAt)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
        <section className="panel crm-summary-panel">
          <p className="eyebrow">Run history</p>
          <h3>
            {data.runCount} saved run{data.runCount === 1 ? '' : 's'}
          </h3>
          {data.runs.length === 0 ? (
            <StateMessage variant="neutral">
              This test has not been run yet.
            </StateMessage>
          ) : (
            <div className="experiment-version-list">
              {data.runs.map((run) => (
                <article className="journey-card" key={run.runId}>
                  <div>
                    <Link
                      className="crm-primary-link"
                      href={`/external-runs/${run.runId}`}
                    >
                      <strong>{runVerdictLabel(run)}</strong>
                    </Link>
                    <span>{formatLocalDateTime(run.startedAt)}</span>
                    <small>
                      Version {versionNumberForRun(run, data.versions)} ·{' '}
                      {run.triggerAttempts} trigger attempts
                    </small>
                  </div>
                </article>
              ))}
            </div>
          )}
        </section>
      </div>
      <details className="panel crm-danger-zone">
        <summary>Test administration</summary>
        <p>
          Deleting this Test permanently removes every immutable version, Run,
          and screenshot that belongs to it.
        </p>
        <button
          className="button button-destructive"
          disabled={busy !== null}
          onClick={() => void remove()}
          type="button"
        >
          {busy === 'delete' ? 'Deleting…' : 'Delete test'}
        </button>
      </details>
    </main>
  );
}

function messageOf(reason: unknown): string {
  return reason instanceof Error
    ? reason.message
    : 'The test operation could not be completed.';
}

function runVerdictLabel(run: ExternalRunSummary): string {
  if (
    run.lifecycleStatus === 'created' ||
    run.lifecycleStatus === 'starting' ||
    run.lifecycleStatus === 'running' ||
    run.lifecycleStatus === 'evaluating'
  ) {
    return sentenceCase(run.lifecycleStatus);
  }
  if (run.canonicalVerdict === 'runner_error') return 'Runner error';
  if (run.canonicalVerdict === 'could_not_verify') return 'Could not verify';
  if (
    run.canonicalVerdict === 'passed' &&
    run.verdictBasis === 'technical_checks_only'
  ) {
    return 'Passed — technical checks only';
  }
  return sentenceCase(run.canonicalVerdict);
}

function versionNumberForRun(
  run: ExternalRunSummary,
  versions: readonly ExternalExperimentVersion[],
): number | string {
  return (
    versions.find((version) => version.id === run.experimentVersionId)
      ?.version ?? 'Unknown'
  );
}
