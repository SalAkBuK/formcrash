import {
  authCaptureSessionSchema,
  authValidationResultSchema,
  deleteResourceResponseSchema,
  externalExperimentListSchema,
  externalExperimentVersionSchema,
  externalRunDetailSchema,
  externalRunListSchema,
  projectExecutionSettingsSchema,
  requestDiscoveryResultSchema,
  type AuthCaptureSession,
  type AuthValidationResult,
  type CreateExternalExperimentRequest,
  type EphemeralRuntimeValues,
  type ExternalExperimentVersion,
  type ExternalRunDetail,
  type ExternalRunList,
  type ProjectExecutionSettings,
  type ProjectExecutionSettingsInput,
  type RequestDiscoveryResult,
} from '@formcrash/contracts';

import { requestJson, resolveApiUrl } from '../../../lib/api-client';

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

export function testAuthentication(
  projectId: string,
): Promise<AuthValidationResult> {
  return requestJson(
    `/api/projects/${projectId}/authentication/test`,
    authValidationResultSchema,
    { method: 'POST' },
  );
}

export function discoverRequests(
  journeyId: string,
  targetStepId: string,
  variables: EphemeralRuntimeValues,
  confirmProduction: boolean,
): Promise<RequestDiscoveryResult> {
  return requestJson(
    `/api/journeys/${journeyId}/request-discovery`,
    requestDiscoveryResultSchema,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ targetStepId, variables, confirmProduction }),
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

export async function deleteExternalExperimentVersion(
  experimentVersionId: string,
): Promise<void> {
  await requestJson(
    `/api/external-experiments/${experimentVersionId}`,
    deleteResourceResponseSchema,
    { method: 'DELETE' },
  );
}

export function runExternalExperiment(
  experimentVersionId: string,
  variables: EphemeralRuntimeValues,
  confirmProduction: boolean,
): Promise<ExternalRunDetail> {
  return requestJson(
    `/api/external-experiments/${experimentVersionId}/runs`,
    externalRunDetailSchema,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ variables, confirmProduction }),
    },
  );
}

export function listExternalRuns(
  projectId: string,
  limit = 20,
  offset = 0,
): Promise<ExternalRunList> {
  const query = new URLSearchParams({
    projectId,
    limit: String(limit),
    offset: String(offset),
  });
  return requestJson(
    `/api/external-runs?${query.toString()}`,
    externalRunListSchema,
  );
}

export function getExternalRun(runId: string): Promise<ExternalRunDetail> {
  return requestJson(`/api/external-runs/${runId}`, externalRunDetailSchema);
}

export function getExternalArtifactUrl(
  runId: string,
  artifactId: string,
): string {
  return resolveApiUrl(`/api/external-runs/${runId}/artifacts/${artifactId}`);
}

export async function deleteExternalRun(runId: string): Promise<void> {
  await requestJson(
    `/api/external-runs/${runId}`,
    deleteResourceResponseSchema,
    { method: 'DELETE' },
  );
}
