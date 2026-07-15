import {
  startSampleRunAcceptedSchema,
  startSampleRunRequestSchema,
  type SampleRunMode,
  type StartSampleRunAccepted,
} from '@formcrash/contracts';

import { requestJson } from '../../../lib/api-client';

export function startSampleRun(
  mode: SampleRunMode,
): Promise<StartSampleRunAccepted> {
  const request = startSampleRunRequestSchema.parse({ mode });
  return requestJson('/api/sample-runs', startSampleRunAcceptedSchema, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(request),
  });
}
