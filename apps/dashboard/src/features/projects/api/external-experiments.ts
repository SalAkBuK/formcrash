import {
  authCaptureSessionSchema,
  authValidationResultSchema,
  deleteResourceResponseSchema,
  externalExperimentListSchema,
  externalExperimentVersionSchema,
  externalRunDetailSchema,
  externalRunComparisonResponseSchema,
  externalRunListSchema,
  externalTestDetailSchema,
  externalTestSummaryListSchema,
  networkEvidenceCandidateListSchema,
  projectExecutionSettingsSchema,
  type AuthCaptureSession,
  type AuthValidationResult,
  type CreateExternalExperimentRequest,
  type CreateExternalExperimentSuiteRequest,
  type CreateExternalExperimentVersionRequest,
  type EphemeralRuntimeValues,
  type ReplayMode,
  type ReplayPacing,
  type ExternalExperimentVersion,
  type ExternalRunDetail,
  type ExternalRunComparisonResponse,
  type ExternalRunList,
  type ExternalTestDetail,
  type ExternalTestSummary,
  type NetworkEvidenceCandidateList,
  type ProjectExecutionSettings,
  type ProjectExecutionSettingsInput,
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

export function saveProductionReplayAcknowledgement(
  projectId: string,
  acknowledged: boolean,
): Promise<ProjectExecutionSettings> {
  return requestJson(
    `/api/projects/${projectId}/settings/production-replay-acknowledgement`,
    projectExecutionSettingsSchema,
    {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ acknowledged }),
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

export function cancelAuthenticationCapture(
  projectId: string,
  captureId: string,
): Promise<AuthCaptureSession> {
  return requestJson(
    `/api/projects/${projectId}/auth-captures/${captureId}/cancel`,
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

export function continueWithoutAuthentication(
  projectId: string,
): Promise<ProjectExecutionSettings> {
  return requestJson(
    `/api/projects/${projectId}/authentication/continue-without-sign-in`,
    projectExecutionSettingsSchema,
    { method: 'POST' },
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

export async function listJourneyExternalTests(
  journeyId: string,
): Promise<readonly ExternalTestSummary[]> {
  return (
    await requestJson(
      `/api/journeys/${journeyId}/tests`,
      externalTestSummaryListSchema,
    )
  ).items;
}

export function listNetworkEvidenceCandidates(
  journeyId: string,
  targetStepId: string,
): Promise<NetworkEvidenceCandidateList> {
  const query = new URLSearchParams({ targetStepId });
  return requestJson(
    `/api/journeys/${journeyId}/network-evidence-candidates?${query.toString()}`,
    networkEvidenceCandidateListSchema,
  );
}

export function getExternalTestDetail(
  testId: string,
): Promise<ExternalTestDetail> {
  return requestJson(`/api/external-tests/${testId}`, externalTestDetailSchema);
}

export async function listProjectExternalExperiments(
  projectId: string,
): Promise<readonly ExternalExperimentVersion[]> {
  return (
    await requestJson(
      `/api/projects/${projectId}/experiments`,
      externalExperimentListSchema,
    )
  ).items;
}

export function getExternalExperimentVersion(
  experimentVersionId: string,
): Promise<ExternalExperimentVersion> {
  return requestJson(
    `/api/external-experiments/${experimentVersionId}`,
    externalExperimentVersionSchema,
  );
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

export async function createExternalExperimentSuite(
  journeyId: string,
  input: CreateExternalExperimentSuiteRequest,
): Promise<readonly ExternalExperimentVersion[]> {
  return (
    await requestJson(
      `/api/journeys/${journeyId}/experiment-suite`,
      externalExperimentListSchema,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(input),
      },
    )
  ).items;
}

export function createExternalExperimentVersion(
  testId: string,
  input: CreateExternalExperimentVersionRequest,
): Promise<ExternalExperimentVersion> {
  return requestJson(
    `/api/external-experiments/${testId}/versions`,
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

export async function deleteExternalTest(testId: string): Promise<void> {
  await requestJson(
    `/api/external-tests/${testId}`,
    deleteResourceResponseSchema,
    { method: 'DELETE' },
  );
}

export function runExternalExperiment(
  experimentVersionId: string,
  variables: EphemeralRuntimeValues,
  confirmProduction: boolean,
  replayMode: ReplayMode = 'adaptive',
  replayPacing: ReplayPacing = 'recorded',
): Promise<ExternalRunDetail> {
  return requestJson(
    `/api/external-experiments/${experimentVersionId}/runs`,
    externalRunDetailSchema,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        variables,
        confirmProduction,
        replayMode,
        replayPacing,
      }),
    },
  );
}

export function listExternalRuns(
  projectId?: string,
  limit = 20,
  offset = 0,
): Promise<ExternalRunList> {
  const query = new URLSearchParams({
    limit: String(limit),
    offset: String(offset),
  });
  if (projectId !== undefined) query.set('projectId', projectId);
  return requestJson(
    `/api/external-runs?${query.toString()}`,
    externalRunListSchema,
  );
}

export function getExternalRun(runId: string): Promise<ExternalRunDetail> {
  return requestJson(`/api/external-runs/${runId}`, externalRunDetailSchema);
}

export function compareExternalRuns(
  beforeRunId: string,
  afterRunId: string,
): Promise<ExternalRunComparisonResponse> {
  return requestJson(
    '/api/external-run-comparisons',
    externalRunComparisonResponseSchema,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ beforeRunId, afterRunId }),
    },
  );
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
