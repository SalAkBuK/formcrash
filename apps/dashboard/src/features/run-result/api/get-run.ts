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

export function getRunEventsUrl(runId: string, afterSequence = 0): string {
  const path = `/api/runs/${encodeURIComponent(runId)}/events`;
  if (afterSequence <= 0) return resolveApiUrl(path);
  const query = new URLSearchParams({ afterSequence: String(afterSequence) });
  return resolveApiUrl(`${path}?${query.toString()}`);
}

export function getArtifactUrl(runId: string, artifactId: string): string {
  return resolveApiUrl(
    `/api/runs/${encodeURIComponent(runId)}/artifacts/${encodeURIComponent(artifactId)}`,
  );
}
