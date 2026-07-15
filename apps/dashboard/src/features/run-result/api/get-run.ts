import {
  persistedRunDetailSchema,
  type PersistedRunDetail,
} from '@formcrash/contracts';

import { requestJson, resolveApiUrl } from '../../../lib/api-client';

export function getRun(runId: string): Promise<PersistedRunDetail> {
  return requestJson(
    `/api/runs/${encodeURIComponent(runId)}`,
    persistedRunDetailSchema,
  );
}

export function getRunEventsUrl(runId: string): string {
  return resolveApiUrl(`/api/runs/${encodeURIComponent(runId)}/events`);
}

export function getArtifactUrl(runId: string, artifactId: string): string {
  return resolveApiUrl(
    `/api/runs/${encodeURIComponent(runId)}/artifacts/${encodeURIComponent(artifactId)}`,
  );
}
