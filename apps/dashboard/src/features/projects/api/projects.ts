import {
  criticalActionSchema,
  criticalActionResponseSchema,
  deleteProjectResponseSchema,
  deleteResourceResponseSchema,
  journeyListSchema,
  outcomeCaptureSessionSchema,
  outcomeCheckListSchema,
  outcomeCheckSchema,
  persistedJourneySchema,
  projectListSchema,
  projectSchema,
  recordingSessionSchema,
  replayResultSchema,
  type ApproveOutcomeCheckRequest,
  type CriticalAction,
  type CreateProjectRequest,
  type EphemeralRuntimeValues,
  type OutcomeCaptureSession,
  type OutcomeCheck,
  type PersistedJourney,
  type Project,
  type RecordedJourneyStep,
  type RecordingSession,
  type ReplayResult,
} from '@formcrash/contracts';

import { requestJson } from '../../../lib/api-client';

export async function listProjects(): Promise<readonly Project[]> {
  return (await requestJson('/api/projects', projectListSchema)).items;
}

export async function createProject(
  input: CreateProjectRequest,
): Promise<Project> {
  return requestJson('/api/projects', projectSchema, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  });
}

export async function deleteProject(
  projectId: string,
  force = false,
): Promise<void> {
  await requestJson(
    `/api/projects/${projectId}${force ? '?force=true' : ''}`,
    deleteProjectResponseSchema,
    {
      method: 'DELETE',
    },
  );
}

export async function listJourneys(
  projectId: string,
): Promise<readonly PersistedJourney[]> {
  return (
    await requestJson(`/api/projects/${projectId}/journeys`, journeyListSchema)
  ).items;
}

export async function deleteJourney(journeyId: string): Promise<void> {
  await requestJson(
    `/api/journeys/${journeyId}`,
    deleteResourceResponseSchema,
    { method: 'DELETE' },
  );
}

export async function startRecording(
  projectId: string,
): Promise<RecordingSession> {
  return requestJson(
    `/api/projects/${projectId}/recordings`,
    recordingSessionSchema,
    { method: 'POST' },
  );
}

export async function getRecording(
  projectId: string,
  sessionId: string,
): Promise<RecordingSession> {
  return requestJson(
    `/api/projects/${projectId}/recordings/${sessionId}`,
    recordingSessionSchema,
  );
}

export async function stopRecording(
  projectId: string,
  sessionId: string,
): Promise<RecordingSession> {
  return requestJson(
    `/api/projects/${projectId}/recordings/${sessionId}/stop`,
    recordingSessionSchema,
    { method: 'POST' },
  );
}

export async function saveJourney(
  projectId: string,
  sessionId: string,
  name: string,
  steps: readonly RecordedJourneyStep[],
): Promise<PersistedJourney> {
  return requestJson(
    `/api/projects/${projectId}/recordings/${sessionId}/journeys`,
    persistedJourneySchema,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, steps }),
    },
  );
}

export async function replayJourney(
  journeyId: string,
  variables: EphemeralRuntimeValues,
  confirmProduction: boolean,
): Promise<ReplayResult> {
  return requestJson(`/api/journeys/${journeyId}/replay`, replayResultSchema, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ variables, confirmProduction }),
  });
}

export async function getCriticalAction(
  journeyId: string,
): Promise<CriticalAction | null> {
  return (
    await requestJson(
      `/api/journeys/${journeyId}/critical-action`,
      criticalActionResponseSchema,
    )
  ).criticalAction;
}

export async function approveCriticalAction(
  journeyId: string,
  stepId: string,
  label: string,
): Promise<CriticalAction> {
  return requestJson(
    `/api/journeys/${journeyId}/critical-action`,
    criticalActionSchema,
    {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ stepId, label }),
    },
  );
}

export async function listOutcomeChecks(
  journeyId: string,
): Promise<readonly OutcomeCheck[]> {
  return (
    await requestJson(
      `/api/journeys/${journeyId}/outcome-checks`,
      outcomeCheckListSchema,
    )
  ).items;
}

export async function startOutcomeCapture(
  journeyId: string,
  variables: EphemeralRuntimeValues,
  confirmProduction: boolean,
): Promise<OutcomeCaptureSession> {
  return requestJson(
    `/api/journeys/${journeyId}/outcome-captures`,
    outcomeCaptureSessionSchema,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ variables, confirmProduction }),
    },
  );
}

export async function getOutcomeCapture(
  captureId: string,
): Promise<OutcomeCaptureSession> {
  return requestJson(
    `/api/outcome-captures/${captureId}`,
    outcomeCaptureSessionSchema,
  );
}

export async function approveOutcomeCheck(
  captureId: string,
  input: ApproveOutcomeCheckRequest,
): Promise<OutcomeCheck> {
  return requestJson(
    `/api/outcome-captures/${captureId}/outcome-checks`,
    outcomeCheckSchema,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(input),
    },
  );
}

export async function closeOutcomeCapture(
  captureId: string,
): Promise<OutcomeCaptureSession> {
  return requestJson(
    `/api/outcome-captures/${captureId}/close`,
    outcomeCaptureSessionSchema,
    { method: 'POST' },
  );
}
