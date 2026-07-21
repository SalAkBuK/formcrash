'use client';

import { useRouter } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';
import type {
  ExternalExperimentVersion,
  ExternalTestSummary,
  PersistedJourney,
  Project,
  ProjectExecutionSettings,
  ReplayMode,
  ReplayPacing,
  ReplayResult,
} from '@formcrash/contracts';

import { StateMessage } from '../../../components/ui/state-message';
import { FormCrashApiError } from '../../../lib/api-client';
import {
  getProjectSettings,
  listJourneyExternalTests,
  runExternalExperiment,
  saveProductionReplayAcknowledgement,
} from '../api/external-experiments';
import {
  deleteJourney,
  getProject,
  listJourneys,
  replayJourney,
} from '../api/projects';
import {
  SavedJourneyDetail,
  type SavedJourneyView,
} from './saved-journey-detail';
import {
  AuthenticationRecoveryPanel,
  useAuthenticationGate,
} from './authentication-gate';

export type JourneyWorkspaceView = SavedJourneyView;

export function JourneyWorkspaceScreen({
  journeyId,
  projectId,
  view = 'overview',
}: {
  readonly journeyId: string;
  readonly projectId: string;
  readonly view?: JourneyWorkspaceView;
}) {
  const router = useRouter();
  const [project, setProject] = useState<Project | null>(null);
  const [journeys, setJourneys] = useState<readonly PersistedJourney[]>([]);
  const [settings, setSettings] = useState<ProjectExecutionSettings | null>(
    null,
  );
  const [tests, setTests] = useState<readonly ExternalTestSummary[]>([]);
  const [replayResult, setReplayResult] = useState<ReplayResult | null>(null);
  const [replayMode, setReplayMode] = useState<ReplayMode>('adaptive');
  const [replayPacing, setReplayPacing] = useState<ReplayPacing>('recorded');
  const [replayValues, setReplayValues] = useState<
    Readonly<Record<string, Readonly<Record<string, string>>>>
  >({});
  const [productionConfirmed, setProductionConfirmed] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const authentication = useAuthenticationGate({
    projectId,
    onSettingsChange: setSettings,
  });
  const authenticationJourneyId = useRef(journeyId);

  useEffect(() => {
    if (authenticationJourneyId.current === journeyId) return;
    authenticationJourneyId.current = journeyId;
    authentication.complete();
  }, [authentication.complete, journeyId]);

  useEffect(() => {
    let active = true;
    setLoading(true);
    setError(null);
    setReplayResult(null);
    void Promise.all([
      getProject(projectId),
      listJourneys(projectId),
      getProjectSettings(projectId),
      listJourneyExternalTests(journeyId),
    ])
      .then(([nextProject, nextJourneys, nextSettings, nextTests]) => {
        if (!active) return;
        if (!nextJourneys.some((item) => item.id === journeyId))
          throw new Error(
            'This journey does not belong to the selected project.',
          );
        setProject(nextProject);
        setJourneys(nextJourneys);
        setSettings(nextSettings);
        setTests(nextTests);
        setProductionConfirmed(
          nextSettings.productionReplayAcknowledged === true,
        );
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
  }, [journeyId, projectId]);

  async function run(
    journey: PersistedJourney,
    preflightComplete = false,
  ): Promise<boolean> {
    const operation = {
      kind: 'replayJourney',
      projectId,
      journeyId: journey.id,
    } as const;
    if (!preflightComplete && !(await authentication.ensure(operation)))
      return false;
    setBusy(`replay-${journey.id}`);
    setError(null);
    setReplayResult(null);
    try {
      setReplayResult(
        await replayJourney(
          journey.id,
          nonEmptyValues(replayValues[journey.id] ?? {}),
          project?.environment !== 'production' || productionConfirmed,
          replayMode,
          replayPacing,
        ),
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
  async function remove(journey: PersistedJourney): Promise<void> {
    if (
      !window.confirm(
        `Delete "${journey.name}" v${journey.version} and all associated tests, runs, and screenshots? This cannot be undone.`,
      )
    )
      return;
    setBusy(`delete-journey-${journey.id}`);
    setError(null);
    try {
      await deleteJourney(journey.id);
      router.push(`/projects/${projectId}/journeys`);
    } catch (reason: unknown) {
      setError(messageOf(reason));
      setBusy(null);
    }
  }

  async function runTest(
    version: ExternalExperimentVersion,
    preflightComplete = false,
  ): Promise<boolean> {
    const operation = {
      kind: 'runExperiment',
      projectId,
      journeyId: version.journeyId,
      experimentVersionId: version.id,
    } as const;
    if (!preflightComplete && !(await authentication.ensure(operation)))
      return false;
    setBusy(`run-test-${version.id}`);
    setError(null);
    try {
      const result = await runExternalExperiment(
        version.id,
        {},
        project?.environment !== 'production' || productionConfirmed,
      );
      router.push(`/external-runs/${result.runId}`);
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

  async function saveProductionAcknowledgement(
    acknowledged: boolean,
  ): Promise<void> {
    const previous = productionConfirmed;
    setProductionConfirmed(acknowledged);
    setBusy('production-replay-acknowledgement');
    setError(null);
    try {
      const next = await saveProductionReplayAcknowledgement(
        projectId,
        acknowledged,
      );
      setSettings(next);
      setProductionConfirmed(next.productionReplayAcknowledged === true);
    } catch (reason: unknown) {
      setProductionConfirmed(previous);
      setError(messageOf(reason));
    } finally {
      setBusy(null);
    }
  }

  if (loading)
    return (
      <StateMessage variant="loading">Loading saved journey…</StateMessage>
    );
  if (error !== null && project === null)
    return <StateMessage variant="error">{error}</StateMessage>;
  if (project === null) return null;

  return (
    <main className="dashboard-shell crm-screen">
      {error !== null ? (
        <StateMessage variant="error">{error}</StateMessage>
      ) : null}
      <AuthenticationRecoveryPanel
        gate={authentication}
        onRetry={(operation) => {
          if (operation.kind === 'runExperiment') {
            const version = tests
              .map((item) => item.latestVersion)
              .find((item) => item.id === operation.experimentVersionId);
            if (version === undefined) {
              authentication.complete();
              return;
            }
            void runTest(version, true).then((started) => {
              if (started) authentication.complete();
            });
            return;
          }
          if (operation.kind !== 'replayJourney') return;
          const selectedJourney = journeys.find(
            (item) => item.id === operation.journeyId,
          );
          if (selectedJourney === undefined) {
            authentication.complete();
            return;
          }
          void run(selectedJourney, true).then((started) => {
            if (started) authentication.complete();
          });
        }}
      />
      <SavedJourneyDetail
        busy={
          busy ?? (authentication.pending === null ? null : 'authentication')
        }
        executionSettings={settings}
        journeys={journeys}
        onDelete={(journey) => void remove(journey)}
        onOpenTest={() =>
          router.push(
            `/projects/${projectId}/tests/new?journeyId=${journeyId}&step=outcome`,
          )
        }
        onProductionAcknowledgementChange={(acknowledged) =>
          void saveProductionAcknowledgement(acknowledged)
        }
        onRecordNewVersion={() =>
          router.push(`/projects/${projectId}/journeys/new`)
        }
        onReplay={(journey) => void run(journey)}
        onRunTest={(test) => void runTest(test.latestVersion)}
        onReplayModeChange={setReplayMode}
        onReplayPacingChange={setReplayPacing}
        onRuntimeValueChange={(selectedId, name, value) =>
          setReplayValues((current) => ({
            ...current,
            [selectedId]: { ...current[selectedId], [name]: value },
          }))
        }
        onSelectionChange={(selectedId) =>
          router.push(journeyRoute(projectId, selectedId, view))
        }
        productionReplayAcknowledged={productionConfirmed}
        project={project}
        replayMode={replayMode}
        replayPacing={replayPacing}
        replayResult={replayResult}
        replayValues={replayValues}
        selectedJourneyId={journeyId}
        tests={tests}
        view={view}
      />
    </main>
  );
}

function journeyRoute(
  projectId: string,
  journeyId: string,
  view: JourneyWorkspaceView,
): string {
  const suffix = view === 'overview' ? '' : `/${view}`;
  return `/projects/${projectId}/journeys/${journeyId}${suffix}`;
}
function nonEmptyValues(
  values: Readonly<Record<string, string>>,
): Readonly<Record<string, string>> {
  return Object.fromEntries(
    Object.entries(values).filter(([, value]) => value.trim() !== ''),
  );
}
function messageOf(reason: unknown): string {
  return reason instanceof Error
    ? reason.message
    : 'The journey operation could not be completed.';
}
