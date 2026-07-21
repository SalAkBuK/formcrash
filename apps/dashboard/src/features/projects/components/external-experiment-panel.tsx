'use client';

import { useEffect, useRef, useState } from 'react';
import type {
  ExternalExperimentVersion,
  PersistedJourney,
  Project,
  ProjectExecutionSettings,
} from '@formcrash/contracts';

import { StateMessage } from '../../../components/ui/state-message';
import { getProjectSettings } from '../api/external-experiments';
import {
  GuidedTestPanel,
  type GuidedTestDraftV1,
  type GuidedWizardStage,
} from './guided-test-panel';

interface Props {
  readonly project: Project;
  readonly journeys: readonly PersistedJourney[];
  readonly selectedJourneyId?: string | null;
  readonly onSelectedJourneyChange?: (journeyId: string) => void;
  readonly guidedDraft?: GuidedTestDraftV1 | null;
  readonly onGuidedDraftChange?: (draft: GuidedTestDraftV1) => void;
  readonly onGuidedStageChange?: (stage: GuidedWizardStage) => void;
  readonly onGuidedSaved?: (
    versions: readonly ExternalExperimentVersion[],
  ) => void;
}

/**
 * The single supported test-configuration workspace.
 *
 * The former Advanced workbench duplicated settings, request discovery,
 * assertions, saved versions, runs, and destructive controls behind an
 * unreachable mode branch. Reusable technical checks now live in
 * TechnicalChecksEditor and are rendered by GuidedTestPanel, so this wrapper
 * only owns project-settings hydration and delegates configuration to that one
 * flow.
 */
export function ExternalExperimentPanel({
  project,
  journeys,
  selectedJourneyId,
  onSelectedJourneyChange,
  guidedDraft = null,
  onGuidedDraftChange,
  onGuidedStageChange,
  onGuidedSaved = () => undefined,
}: Props) {
  const [settings, setSettings] = useState<ProjectExecutionSettings | null>(
    null,
  );
  const [error, setError] = useState<string | null>(null);
  const initialization = useRef<{
    readonly projectId: string;
    readonly promise: ReturnType<typeof getProjectSettings>;
  } | null>(null);

  useEffect(() => {
    let active = true;
    setError(null);
    if (initialization.current?.projectId !== project.id) {
      initialization.current = {
        projectId: project.id,
        promise: getProjectSettings(project.id),
      };
    }
    void initialization.current.promise
      .then((value) => {
        if (active) setSettings(value);
      })
      .catch((reason: unknown) => {
        if (active) setError(messageOf(reason));
      });
    return () => {
      active = false;
    };
  }, [project.id]);

  return (
    <section
      aria-label="Test configuration"
      className="external-workbench"
      id="test-configuration"
    >
      {error === null ? null : (
        <StateMessage variant="error">{error}</StateMessage>
      )}
      <GuidedTestPanel
        initialDraft={guidedDraft}
        journeys={journeys}
        onAuthenticationRecaptured={setSettings}
        onDraftChange={onGuidedDraftChange}
        onSaved={onGuidedSaved}
        onSelectedJourneyChange={onSelectedJourneyChange}
        onStageChange={onGuidedStageChange}
        project={project}
        selectedJourneyId={selectedJourneyId}
        settings={settings}
      />
    </section>
  );
}

function messageOf(reason: unknown): string {
  return reason instanceof Error
    ? reason.message
    : 'The test configuration could not be loaded.';
}
