'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useMemo, useState } from 'react';
import type {
  EphemeralRuntimeValues,
  ExternalExperimentVersion,
  Project,
  ProjectExecutionSettings,
  ReplayMode,
  ReplayPacing,
} from '@formcrash/contracts';

import { StateMessage } from '../../../components/ui/state-message';
import { StatusBadge } from '../../../components/ui/status-badge';
import { formatLocalDateTime } from '../../../lib/formatters';
import {
  deleteExternalExperimentVersion,
  getExternalExperimentVersion,
  getProjectSettings,
  listProjectExternalExperiments,
  runExternalExperiment,
} from '../api/external-experiments';
import { getProject } from '../api/projects';
import { journeyRuntimeRequirements } from '../models/journey-runtime';

interface TestData {
  readonly project: Project;
  readonly settings: ProjectExecutionSettings;
  readonly version: ExternalExperimentVersion;
  readonly versions: readonly ExternalExperimentVersion[];
}

export function TestDetailScreen({
  experimentVersionId,
  projectId,
}: {
  readonly experimentVersionId: string;
  readonly projectId: string;
}) {
  const router = useRouter();
  const [data, setData] = useState<TestData | null>(null);
  const [values, setValues] = useState<EphemeralRuntimeValues>({});
  const [replayMode, setReplayMode] = useState<ReplayMode>('adaptive');
  const [replayPacing, setReplayPacing] = useState<ReplayPacing>('recorded');
  const [productionConfirmed, setProductionConfirmed] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    void Promise.all([
      getProject(projectId),
      getProjectSettings(projectId),
      getExternalExperimentVersion(experimentVersionId),
      listProjectExternalExperiments(projectId),
    ])
      .then(([project, settings, version, versions]) => {
        if (!active) return;
        if (version.projectId !== projectId)
          throw new Error('This test does not belong to the selected project.');
        setData({ project, settings, version, versions });
      })
      .catch((reason: unknown) => {
        if (active) setError(messageOf(reason));
      });
    return () => {
      active = false;
    };
  }, [experimentVersionId, projectId]);

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
  const family = data.versions.filter(
    (item) => item.experimentId === data.version.experimentId,
  );
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
  async function remove(): Promise<void> {
    if (
      !window.confirm(
        `Delete "${data!.version.name}" version ${data!.version.version} and its associated runs and screenshots? This cannot be undone.`,
      )
    )
      return;
    setBusy('delete');
    setError(null);
    try {
      await deleteExternalExperimentVersion(data!.version.id);
      router.push(`/projects/${projectId}/tests`);
    } catch (reason: unknown) {
      setError(messageOf(reason));
      setBusy(null);
    }
  }

  return (
    <main className="dashboard-shell crm-screen">
      <header className="crm-record-header">
        <div>
          <p className="eyebrow">Saved test</p>
          <h2>{data.version.name}</h2>
          <p>
            <Link
              href={`/projects/${projectId}/journeys/${data.version.journeyId}`}
            >
              {data.version.journeySnapshot.name} v
              {data.version.journeySnapshot.version}
            </Link>
          </p>
          <div className="crm-status-line">
            <StatusBadge tone={data.version.guided ? 'pass' : 'neutral'}>
              {data.version.guided ? 'Guided' : 'Advanced'}
            </StatusBadge>
            <StatusBadge tone="disruption">Impatient User</StatusBadge>
            <span>Version {data.version.version}</span>
          </div>
        </div>
        <label>
          Immutable version
          <select
            aria-label="Test version"
            onChange={(event) =>
              router.push(`/projects/${projectId}/tests/${event.target.value}`)
            }
            value={data.version.id}
          >
            {family.map((item) => (
              <option key={item.id} value={item.id}>
                Version {item.version} · {formatLocalDateTime(item.createdAt)}
              </option>
            ))}
          </select>
        </label>
      </header>
      {error !== null ? (
        <StateMessage variant="error">{error}</StateMessage>
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
              <dt>Assertions</dt>
              <dd>{data.version.assertions.length}</dd>
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
                  setProductionConfirmed(event.target.checked)
                }
                type="checkbox"
              />{' '}
              I understand this test can change real production data.
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
      <details className="panel crm-danger-zone">
        <summary>Test administration</summary>
        <p>
          Deleting an immutable test version also removes its associated runs
          and screenshots.
        </p>
        <button
          className="button button-destructive"
          disabled={busy !== null}
          onClick={() => void remove()}
          type="button"
        >
          {busy === 'delete' ? 'Deleting…' : 'Delete this version'}
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
