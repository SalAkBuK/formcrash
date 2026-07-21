'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import type { PersistedJourney, Project } from '@formcrash/contracts';

import { StateMessage } from '../../../components/ui/state-message';
import { getProject, listJourneys } from '../api/projects';
import { ExternalExperimentPanel } from './external-experiment-panel';
import type { GuidedTestDraftV1, GuidedWizardStage } from './guided-test-panel';

export function TestBuilderScreen({
  projectId,
}: {
  readonly projectId: string;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const currentSearch = searchParams.toString();
  const requestedJourneyId = searchParams.get('journeyId');
  const requestedStage = stageFromQuery(searchParams.get('step'));
  const [project, setProject] = useState<Project | null>(null);
  const [journeys, setJourneys] = useState<readonly PersistedJourney[]>([]);
  const [selectedJourneyId, setSelectedJourneyId] = useState<string | null>(
    null,
  );
  const [draft, setDraft] = useState<GuidedTestDraftV1 | null>(null);
  const [error, setError] = useState<string | null>(null);
  const initialization = useRef<{
    readonly projectId: string;
    readonly promise: ReturnType<typeof loadTestBuilder>;
  } | null>(null);

  useEffect(() => {
    let active = true;
    setError(null);
    if (initialization.current?.projectId !== projectId) {
      initialization.current = {
        projectId,
        promise: loadTestBuilder(projectId),
      };
    }
    void initialization.current.promise
      .then(([nextProject, nextJourneys]) => {
        if (!active) return;
        setProject(nextProject);
        setJourneys(nextJourneys);
      })
      .catch((reason: unknown) => {
        if (active) setError(messageOf(reason));
      });
    return () => {
      active = false;
    };
  }, [projectId]);

  useEffect(() => {
    if (project === null || journeys.length === 0) return;
    const restored = readGuidedTestDraft(projectId);
    const nextJourneyId =
      journeys.find((item) => item.id === requestedJourneyId)?.id ??
      journeys.find((item) => item.id === restored?.journeyId)?.id ??
      journeys[0]?.id ??
      null;
    setSelectedJourneyId(nextJourneyId);
    if (nextJourneyId === null) {
      setDraft(null);
      return;
    }
    const nextDraft: GuidedTestDraftV1 = {
      version: 1,
      projectId,
      journeyId: nextJourneyId,
      stage: requestedStage ?? restored?.stage ?? 'outcome',
      recipeId: restored?.recipeId ?? 'duplicate_action',
      replayPacing: restored?.replayPacing ?? 'recorded',
      experimentName: restored?.experimentName ?? '',
      stepValueModes: restored?.stepValueModes ?? {},
    };
    setDraft((current) =>
      sameDraft(current, nextDraft) ? current : nextDraft,
    );
  }, [journeys, project, projectId, requestedJourneyId, requestedStage]);

  const updateLocation = useCallback(
    (stage: GuidedWizardStage, journeyId?: string | null) => {
      const query = new URLSearchParams();
      query.set('step', stage);
      const selected = journeyId ?? selectedJourneyId;
      if (selected !== null) query.set('journeyId', selected);
      const intendedPathname = `/projects/${projectId}/tests/new`;
      if (
        pathname === intendedPathname &&
        normalizedSearch(currentSearch) === normalizedSearch(query.toString())
      ) {
        return;
      }
      router.replace(`${intendedPathname}?${query.toString()}`, {
        scroll: false,
      });
    },
    [currentSearch, pathname, projectId, router, selectedJourneyId],
  );

  const handleDraftChange = useCallback(
    (next: GuidedTestDraftV1) => {
      window.sessionStorage.setItem(draftKey(projectId), JSON.stringify(next));
    },
    [projectId],
  );

  if (error !== null)
    return <StateMessage variant="error">{error}</StateMessage>;
  if (project === null)
    return <StateMessage variant="loading">Loading test builder…</StateMessage>;
  if (journeys.length === 0) {
    return (
      <main className="dashboard-shell crm-screen">
        <div className="empty-state">
          <h2>Record a journey first</h2>
          <p>A test must reference one exact immutable journey version.</p>
          <a
            className="button button-primary"
            href={`/projects/${projectId}/journeys/new`}
          >
            Record journey
          </a>
        </div>
      </main>
    );
  }

  return (
    <main className="dashboard-shell crm-screen crm-builder-screen">
      <ExternalExperimentPanel
        guidedDraft={draft}
        journeys={journeys}
        onGuidedDraftChange={handleDraftChange}
        onGuidedSaved={(versions) => {
          window.sessionStorage.removeItem(draftKey(projectId));
          const savedJourneyId = versions[0]?.journeyId ?? selectedJourneyId;
          if (savedJourneyId !== null) {
            router.push(`/projects/${projectId}/journeys/${savedJourneyId}`);
          }
        }}
        onGuidedStageChange={(stage) => updateLocation(stage)}
        onSelectedJourneyChange={(journeyId) => {
          setSelectedJourneyId(journeyId);
          updateLocation('outcome', journeyId);
        }}
        project={project}
        selectedJourneyId={selectedJourneyId}
      />
    </main>
  );
}

function draftKey(projectId: string): string {
  return `formcrash:guided-test-draft:v1:${projectId}`;
}

function loadTestBuilder(projectId: string) {
  return Promise.all([getProject(projectId), listJourneys(projectId)]);
}

function normalizedSearch(search: string): string {
  const entries = [...new URLSearchParams(search).entries()].sort(
    ([leftKey, leftValue], [rightKey, rightValue]) =>
      leftKey.localeCompare(rightKey) || leftValue.localeCompare(rightValue),
  );
  return new URLSearchParams(entries).toString();
}

function sameDraft(
  current: GuidedTestDraftV1 | null,
  next: GuidedTestDraftV1,
): boolean {
  return current !== null && JSON.stringify(current) === JSON.stringify(next);
}

export function readGuidedTestDraft(
  projectId: string,
): GuidedTestDraftV1 | null {
  try {
    const value = window.sessionStorage.getItem(draftKey(projectId));
    if (value === null) return null;
    const parsed = JSON.parse(value) as Partial<GuidedTestDraftV1>;
    if (
      parsed.version !== 1 ||
      parsed.projectId !== projectId ||
      typeof parsed.journeyId !== 'string' ||
      !isStage(parsed.stage) ||
      !isRecipe(parsed.recipeId) ||
      !isPacing(parsed.replayPacing) ||
      typeof parsed.experimentName !== 'string' ||
      !isSafeModes(parsed.stepValueModes)
    ) {
      window.sessionStorage.removeItem(draftKey(projectId));
      return null;
    }
    return {
      version: 1,
      projectId,
      journeyId: parsed.journeyId,
      stage: parsed.stage,
      recipeId: parsed.recipeId,
      replayPacing: parsed.replayPacing,
      experimentName: parsed.experimentName,
      stepValueModes: parsed.stepValueModes,
    };
  } catch {
    window.sessionStorage.removeItem(draftKey(projectId));
    return null;
  }
}

function stageFromQuery(value: string | null): GuidedWizardStage | null {
  return isStage(value) ? value : null;
}

function isStage(value: unknown): value is GuidedWizardStage {
  return value === 'outcome' || value === 'safety' || value === 'review';
}
function isRecipe(value: unknown): value is GuidedTestDraftV1['recipeId'] {
  return (
    value === 'duplicate_action' ||
    value === 'rapid_triple_action' ||
    value === 'server_duplicate_handling'
  );
}
function isPacing(value: unknown): value is GuidedTestDraftV1['replayPacing'] {
  return value === 'recorded' || value === 'deliberate' || value === 'fast';
}
function isSafeModes(
  value: unknown,
): value is GuidedTestDraftV1['stepValueModes'] {
  if (typeof value !== 'object' || value === null || Array.isArray(value))
    return false;
  return Object.values(value).every(
    (mode) =>
      mode === 'recorded' ||
      mode === 'unique_text' ||
      mode === 'uuid' ||
      mode === 'unique_name' ||
      mode === 'unique_email' ||
      mode === 'unique_phone',
  );
}
function messageOf(reason: unknown): string {
  return reason instanceof Error
    ? reason.message
    : 'The test builder could not be loaded.';
}
