import {
  authCaptureSessionSchema,
  externalExperimentListSchema,
  externalExperimentVersionSchema,
  externalRunDetailSchema,
  projectExecutionSettingsSchema,
  requestDiscoveryResultSchema,
  type AuthCaptureSession,
  type CreateExternalExperimentRequest,
  type EphemeralRuntimeValues,
  type ExternalExperimentVersion,
  type ExternalRunDetail,
  type ProjectExecutionSettings,
  type ProjectExecutionSettingsInput,
  type RequestDiscoveryResult,
} from '@formcrash/contracts';

import { requestJson } from '../../../lib/api-client';

export function getProjectSettings(
  projectId: string,
): Promise<ProjectExecutionSettings> {
  return requestJson(
    `/api/projects/${projectId}/settings`,
    projectExecutionSettingsSchema,
  );
}

export function saveProjectSettings(
  projectId: string,
  input: ProjectExecutionSettingsInput,
): Promise<ProjectExecutionSettings> {
  return requestJson(
    `/api/projects/${projectId}/settings`,
    projectExecutionSettingsSchema,
    {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(input),
    },
  );
}

export function startAuthenticationCapture(
  projectId: string,
): Promise<AuthCaptureSession> {
  return requestJson(
    `/api/projects/${projectId}/auth-captures`,
    authCaptureSessionSchema,
    { method: 'POST' },
  );
}

export function confirmAuthenticationCapture(
  projectId: string,
  captureId: string,
): Promise<AuthCaptureSession> {
  return requestJson(
    `/api/projects/${projectId}/auth-captures/${captureId}/confirm`,
    authCaptureSessionSchema,
    { method: 'POST' },
  );
}

export function clearAuthentication(
  projectId: string,
): Promise<ProjectExecutionSettings> {
  return requestJson(
    `/api/projects/${projectId}/authentication`,
    projectExecutionSettingsSchema,
    { method: 'DELETE' },
  );
}

export function discoverRequests(
  journeyId: string,
  targetStepId: string,
  variables: EphemeralRuntimeValues,
): Promise<RequestDiscoveryResult> {
  return requestJson(
    `/api/journeys/${journeyId}/request-discovery`,
    requestDiscoveryResultSchema,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ targetStepId, variables }),
    },
  );
}

export async function listExternalExperiments(
  journeyId: string,
): Promise<readonly ExternalExperimentVersion[]> {
  return (
    await requestJson(
      `/api/journeys/${journeyId}/experiments`,
      externalExperimentListSchema,
    )
  ).items;
}

export function createExternalExperiment(
  journeyId: string,
  input: CreateExternalExperimentRequest,
): Promise<ExternalExperimentVersion> {
  return requestJson(
    `/api/journeys/${journeyId}/experiments`,
    externalExperimentVersionSchema,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(input),
    },
  );
}

export function runExternalExperiment(
  experimentVersionId: string,
  variables: EphemeralRuntimeValues,
): Promise<ExternalRunDetail> {
  return requestJson(
    `/api/external-experiments/${experimentVersionId}/runs`,
    externalRunDetailSchema,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ variables }),
    },
  );
}
