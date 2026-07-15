import {
  journeyListSchema,
  persistedJourneySchema,
  projectListSchema,
  projectSchema,
  recordingSessionSchema,
  replayResultSchema,
  type CreateProjectRequest,
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

export async function listJourneys(
  projectId: string,
): Promise<readonly PersistedJourney[]> {
  return (
    await requestJson(`/api/projects/${projectId}/journeys`, journeyListSchema)
  ).items;
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

export async function replayJourney(journeyId: string): Promise<ReplayResult> {
  return requestJson(`/api/journeys/${journeyId}/replay`, replayResultSchema, {
    method: 'POST',
  });
}
