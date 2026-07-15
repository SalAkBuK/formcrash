import {
  persistedRunListSchema,
  type PersistedRunList,
} from '@formcrash/contracts';

import { requestJson } from '../../../lib/api-client';

const INITIAL_HISTORY_LIMIT = 12;

export function getRecentRuns(): Promise<PersistedRunList> {
  return requestJson(
    `/api/runs?limit=${INITIAL_HISTORY_LIMIT}&offset=0`,
    persistedRunListSchema,
  );
}
