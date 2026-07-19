'use client';

import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import type {
  AuthCaptureSession,
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
  confirmAuthenticationCapture,
  getProjectSettings,
  startAuthenticationCapture,
} from '../api/external-experiments';
import {
  deleteJourney,
  getProject,
  listJourneys,
  replayJourney,
} from '../api/projects';
import { JourneyDetail } from './journey-detail';

export type JourneyWorkspaceView =
  'overview' | 'sequence' | 'outcomes' | 'replay';

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
  const [replayResult, setReplayResult] = useState<ReplayResult | null>(null);
  const [replayMode, setReplayMode] = useState<ReplayMode>('adaptive');
  const [replayPacing, setReplayPacing] = useState<ReplayPacing>('recorded');
  const [replayValues, setReplayValues] = useState<
    Readonly<Record<string, Readonly<Record<string, string>>>>
  >({});
  const [productionConfirmed, setProductionConfirmed] = useState(false);
  const [authenticationRequired, setAuthenticationRequired] = useState(false);
  const [authCapture, setAuthCapture] = useState<AuthCaptureSession | null>(
    null,
  );
  const [authMessage, setAuthMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let active = true;
    setLoading(true);
    setError(null);
    setReplayResult(null);
    void Promise.all([
      getProject(projectId),
      listJourneys(projectId),
      getProjectSettings(projectId),
    ])
      .then(([nextProject, nextJourneys, nextSettings]) => {
        if (!active) return;
        if (!nextJourneys.some((item) => item.id === journeyId))
          throw new Error(
            'This journey does not belong to the selected project.',
          );
        setProject(nextProject);
        setJourneys(nextJourneys);
        setSettings(nextSettings);
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

  async function run(journey: PersistedJourney): Promise<void> {
    setBusy(`replay-${journey.id}`);
    setError(null);
    setReplayResult(null);
    setAuthenticationRequired(false);
    setAuthMessage(null);
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
    } catch (reason: unknown) {
      if (
        reason instanceof FormCrashApiError &&
        reason.code === 'AUTHENTICATION_REQUIRED'
      ) {
        setAuthenticationRequired(true);
        setAuthCapture(null);
        setAuthMessage(reason.message);
      } else setError(messageOf(reason));
    } finally {
      setBusy(null);
    }
  }
  async function startAuth(): Promise<void> {
    setBusy('replay-auth-start');
    setError(null);
    setAuthMessage(null);
    try {
      setAuthCapture(await startAuthenticationCapture(projectId));
    } catch (reason: unknown) {
      setError(messageOf(reason));
    } finally {
      setBusy(null);
    }
  }
  async function confirmAuth(): Promise<void> {
    if (authCapture === null) return;
    setBusy('replay-auth-confirm');
    setError(null);
    try {
      setAuthCapture(
        await confirmAuthenticationCapture(projectId, authCapture.id),
      );
      setSettings(await getProjectSettings(projectId));
      setAuthenticationRequired(false);
      setAuthMessage('Authentication was recaptured. Replay again when ready.');
    } catch (reason: unknown) {
      setError(messageOf(reason));
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
      <JourneyDetail
        authCapture={authCapture}
        authMessage={authMessage}
        authenticationRequired={authenticationRequired}
        busy={busy}
        executionSettings={settings}
        journeys={journeys}
        loading={false}
        onAuthenticationConfirm={() => void confirmAuth()}
        onAuthenticationStart={() => void startAuth()}
        onDelete={(journey) => void remove(journey)}
        onManageProjects={() =>
          router.push(`/projects/${projectId}/journeys/new`)
        }
        onOpenTest={() =>
          router.push(
            `/projects/${projectId}/tests/new?journeyId=${journeyId}&step=outcome`,
          )
        }
        onProductionConfirmationChange={setProductionConfirmed}
        onReplay={(journey) => void run(journey)}
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
        productionReplayConfirmed={productionConfirmed}
        project={project}
        replayMode={replayMode}
        replayPacing={replayPacing}
        replayResult={replayResult}
        replayValues={replayValues}
        selectedJourneyId={journeyId}
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
