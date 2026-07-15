import {
  persistedRunDetailSchema,
  persistedRunSummarySchema,
  runEventEnvelopeSchema,
  type PersistedRunDetail,
  type PersistedRunSummary,
  type RunEventEnvelope,
  type RunStatus,
} from '@formcrash/contracts';

export function buildRun(
  status: RunStatus = 'passed',
  options: {
    readonly events?: readonly RunEventEnvelope[];
    readonly artifacts?: PersistedRunDetail['artifacts'];
  } = {},
): PersistedRunDetail {
  const terminal = ['passed', 'failed', 'incomplete', 'runner_error'].includes(
    status,
  );
  const observedCount =
    status === 'failed' ? 2 : status === 'passed' ? 1 : null;
  const assertionStatus =
    status === 'failed'
      ? 'failed'
      : status === 'passed'
        ? 'passed'
        : 'not_evaluated';
  const experiment = {
    experimentType: 'impatient_user' as const,
    triggerCount: 2 as const,
    intervalMs: 100 as const,
    targetStep: 'submit-order' as const,
  };
  const journey = [
    {
      id: 'submit-order',
      name: 'Trigger Submit Order twice',
      action: {
        type: 'inject_impatient_user' as const,
        selector: 'submit-order',
      },
    },
  ];
  const assertions = [
    {
      id: 'assertion-max-created-orders-v1',
      assertionType: 'max_created_orders' as const,
      configuration: { expectedMaximum: 1 as const },
      description: 'No more than one order should be created.' as const,
    },
  ];
  const runId = `run-${status}`;
  const events =
    options.events ??
    (terminal && status !== 'runner_error'
      ? [1, 2].map((sequence) =>
          runEventEnvelopeSchema.parse({
            eventId: `event-trigger-${sequence}`,
            runId,
            eventType: 'experiment.triggered',
            sequence,
            relativeTimestampMs: sequence * 100,
            recordedAt: '2026-07-15T00:00:00.000Z',
            schemaVersion: 1,
            payload: { triggerNumber: sequence },
          }),
        )
      : []);
  const artifacts =
    options.artifacts ??
    (terminal && status !== 'runner_error'
      ? (
          ['before-disruption', 'after-disruption', 'final-result'] as const
        ).map((label, index) => ({
          artifactId: `artifact-${index + 1}`,
          runId,
          artifactType: 'screenshot' as const,
          label,
          relativePath: `screenshots/${runId}/00${index + 1}-${label}.png`,
          mimeType: 'image/png' as const,
          sizeBytes: 1_024 * (index + 1),
          checksumSha256: String(index).repeat(64),
          captureSequence: index + 1,
          createdAt: '2026-07-15T00:00:00.500Z',
          metadata: { fullPage: true },
        }))
      : []);

  return persistedRunDetailSchema.parse({
    runId,
    experimentVersionId: 'experiment-version-impatient-user-v1',
    status,
    mode: status === 'failed' ? 'vulnerable' : 'fixed',
    startedAt: '2026-07-15T00:00:00.000Z',
    completedAt: terminal ? '2026-07-15T00:00:02.000Z' : null,
    durationMs: terminal ? 2_000 : null,
    targetUrl: 'http://127.0.0.1:4200',
    createdAt: '2026-07-15T00:00:00.000Z',
    journey: {
      id: 'sample-checkout-priority-0',
      name: 'Sample checkout order submission',
      steps: [
        {
          id: 'submit-order',
          name: 'Trigger Submit Order twice',
          actionType: 'inject_impatient_user',
          selector: 'submit-order',
          path: null,
        },
      ],
    },
    experiment,
    assertions: [
      {
        assertionType: 'max_created_orders',
        expectedMaximum: 1,
        observedCount,
        status: assertionStatus,
        expectedDescription: 'No more than one order should be created.',
        observedDescription:
          observedCount === null
            ? 'The application state could not be evaluated.'
            : `${observedCount} order${observedCount === 1 ? '' : 's'} were created.`,
      },
    ],
    snapshots: { journey, experiment, assertions },
    events,
    observed:
      observedCount === null
        ? null
        : {
            browserOrderRequestCount: observedCount,
            requestAttemptCount: 2,
            acceptedCount: observedCount,
            deduplicatedCount: 2 - observedCount,
            rejectedCount: 0,
            createdOrderCount: observedCount,
            orderIds: Array.from(
              { length: observedCount },
              (_, index) => `order-${index + 1}`,
            ),
            requests: [],
          },
    runnerError:
      status === 'runner_error'
        ? {
            code: 'journey_step_failed',
            message: 'The saved Submit Order step could not be completed.',
            failedStep: {
              stepId: 'submit-order',
              stepName: 'Trigger Submit Order twice',
              actionType: 'inject_impatient_user',
              selector: 'submit-order',
              path: null,
            },
          }
        : null,
    evidenceWarnings: [],
    assertionResults: [],
    artifacts,
  });
}

export function buildRunSummary(
  status: RunStatus = 'failed',
): PersistedRunSummary {
  return persistedRunSummarySchema.parse({
    runId: `run-${status}`,
    mode: status === 'failed' ? 'vulnerable' : 'fixed',
    status,
    startedAt: '2026-07-15T00:00:00.000Z',
    completedAt: '2026-07-15T00:00:02.000Z',
    durationMs: 2_000,
    createdOrderCount: status === 'failed' ? 2 : 1,
    assertionStatus: status === 'failed' ? 'failed' : 'passed',
    screenshotCount: 3,
  });
}

export function buildEvent(
  sequence: number,
  eventType: string,
  payload: RunEventEnvelope['payload'] = {},
): RunEventEnvelope {
  return runEventEnvelopeSchema.parse({
    eventId: `event-${sequence}`,
    runId: 'run-running',
    eventType,
    sequence,
    relativeTimestampMs: sequence * 100,
    recordedAt: '2026-07-15T00:00:00.000Z',
    schemaVersion: 1,
    payload,
  });
}
