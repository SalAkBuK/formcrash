import { z } from 'zod';

export const runStatusSchema = z.enum([
  'created',
  'starting',
  'running',
  'evaluating',
  'passed',
  'failed',
  'stopping',
  'incomplete',
  'runner_error',
]);

export const terminalRunStatusSchema = z.enum([
  'passed',
  'failed',
  'incomplete',
  'runner_error',
]);

export const experimentTypeSchema = z.enum([
  'impatient_user',
  'tunnel_drop',
  'slow_server',
  'accidental_refresh',
  'back_button_trap',
]);

export const journeyActionTypeSchema = z.enum([
  'navigate',
  'click',
  'fill',
  'checkbox',
  'radio',
  'select',
  'submit',
]);

export const controlledTargetUrlSchema = z
  .string()
  .trim()
  .url()
  .superRefine((value, context) => {
    const url = new URL(value);
    if (url.protocol !== 'http:' && url.protocol !== 'https:') {
      context.addIssue({
        code: 'custom',
        message: 'Only HTTP and HTTPS target URLs are supported.',
      });
    }
    if (url.username !== '' || url.password !== '') {
      context.addIssue({
        code: 'custom',
        message: 'Target URLs must not contain credentials.',
      });
    }
  });

export const projectSchema = z.object({
  id: z.string().min(1),
  name: z.string().trim().min(1).max(120),
  targetUrl: controlledTargetUrlSchema,
  description: z.string().max(1_000),
  createdAt: z.iso.datetime({ offset: true }),
  updatedAt: z.iso.datetime({ offset: true }),
});

export const createProjectRequestSchema = z.object({
  name: projectSchema.shape.name,
  targetUrl: controlledTargetUrlSchema,
  description: projectSchema.shape.description.optional().default(''),
});

export const projectListSchema = z.object({
  items: z.array(projectSchema),
});

export const recordingSessionStatusSchema = z.enum([
  'created',
  'launching',
  'recording',
  'stopping',
  'completed',
  'runner_error',
]);

export const replayLocatorSchema = z.discriminatedUnion('strategy', [
  z.object({ strategy: z.literal('data-formcrash'), value: z.string().min(1) }),
  z.object({ strategy: z.literal('data-testid'), value: z.string().min(1) }),
  z.object({ strategy: z.literal('id'), value: z.string().min(1) }),
  z.object({
    strategy: z.literal('role'),
    role: z.string().min(1),
    name: z.string().min(1),
  }),
  z.object({ strategy: z.literal('name'), value: z.string().min(1) }),
  z.object({ strategy: z.literal('label'), value: z.string().min(1) }),
  z.object({ strategy: z.literal('text'), value: z.string().min(1) }),
  z.object({ strategy: z.literal('css'), value: z.string().min(1) }),
]);

export const targetFingerprintSchema = z.object({
  tagName: z.string().min(1),
  inputType: z.string().nullable(),
  dataFormcrash: z.string().nullable(),
  dataTestId: z.string().nullable(),
  id: z.string().nullable(),
  role: z.string().nullable(),
  accessibleName: z.string().nullable(),
  name: z.string().nullable(),
  label: z.string().nullable(),
  text: z.string().nullable(),
  cssPath: z.string().min(1),
});

export const recordedValueSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('safe'), value: z.string().max(10_000) }),
  z.object({
    kind: z.literal('sensitive'),
    variableName: z.string().regex(/^[A-Z][A-Z0-9_]*$/u),
  }),
]);

export const recordedJourneyStepSchema = z.object({
  id: z.string().min(1),
  name: z.string().trim().min(1).max(160),
  type: journeyActionTypeSchema,
  timestamp: z.number().int().nonnegative(),
  url: controlledTargetUrlSchema,
  locator: replayLocatorSchema.nullable(),
  fingerprint: targetFingerprintSchema.nullable(),
  value: recordedValueSchema.nullable(),
  sensitive: z.boolean(),
});

export const recordingWarningCodeSchema = z.enum([
  'new_tab',
  'iframe',
  'file_upload',
  'captcha',
  'third_party_payment',
  'drag_and_drop',
  'contenteditable',
  'shadow_dom',
]);

export const recordingWarningSchema = z.object({
  code: recordingWarningCodeSchema,
  message: z.string().min(1),
  timestamp: z.number().int().nonnegative(),
  url: controlledTargetUrlSchema,
});

export const recordingSessionSchema = z.object({
  id: z.string().min(1),
  projectId: z.string().min(1),
  status: recordingSessionStatusSchema,
  steps: z.array(recordedJourneyStepSchema),
  warnings: z.array(recordingWarningSchema),
  errorMessage: z.string().nullable(),
  startedAt: z.iso.datetime({ offset: true }),
  completedAt: z.iso.datetime({ offset: true }).nullable(),
});

export const startRecordingResponseSchema = recordingSessionSchema;

export const saveRecordedJourneyRequestSchema = z.object({
  name: z.string().trim().min(1).max(160),
  steps: z.array(recordedJourneyStepSchema).min(1).optional(),
});

export const journeyRecordingMetadataSchema = z.object({
  recordingSessionId: z.string().min(1).nullable(),
  recordedAt: z.iso.datetime({ offset: true }),
  warningCount: z.number().int().nonnegative(),
  normalizationRule: z.string().min(1),
});

export const persistedJourneySchema = z.object({
  id: z.string().min(1),
  projectId: z.string().min(1),
  name: z.string().min(1),
  version: z.number().int().positive(),
  steps: z.array(recordedJourneyStepSchema).min(1),
  recordingMetadata: journeyRecordingMetadataSchema,
  createdAt: z.iso.datetime({ offset: true }),
});

export const journeyListSchema = z.object({
  items: z.array(persistedJourneySchema),
});

export const replayFailureSchema = z.object({
  stepId: z.string().min(1),
  stepName: z.string().min(1),
  stepNumber: z.number().int().positive(),
  actionType: journeyActionTypeSchema,
  message: z.string().min(1),
});

export const replayResultSchema = z.object({
  replayId: z.string().min(1),
  journeyId: z.string().min(1),
  status: z.enum(['passed', 'failed', 'runner_error']),
  failedStep: replayFailureSchema.nullable(),
  startedAt: z.iso.datetime({ offset: true }),
  completedAt: z.iso.datetime({ offset: true }),
});

export const assertionResultStatusSchema = z.enum([
  'passed',
  'failed',
  'not_evaluated',
  'error',
]);

export const runEventEnvelopeSchema = z.object({
  eventId: z.string().min(1),
  runId: z.string().min(1),
  eventType: z.string().min(1),
  sequence: z.number().int().positive(),
  relativeTimestampMs: z.number().int().nonnegative(),
  recordedAt: z.iso.datetime({ offset: true }),
  schemaVersion: z.literal(1),
  payload: z.json(),
});

export const sampleRunModeSchema = z.enum(['vulnerable', 'fixed']);

export const startSampleRunRequestSchema = z.object({
  mode: sampleRunModeSchema,
});

export const startSampleRunAcceptedSchema = z.object({
  runId: z.string().min(1),
  status: z.literal('created'),
  detailUrl: z.string().startsWith('/api/runs/'),
  eventsUrl: z.string().startsWith('/api/runs/'),
});

export const sseRunEventSchema = runEventEnvelopeSchema;

export const sampleJourneyActionSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('navigate'), path: z.string().min(1) }),
  z.object({ type: z.literal('click'), selector: z.string().min(1) }),
  z.object({
    type: z.literal('fill'),
    selector: z.string().min(1),
    value: z.string(),
  }),
  z.object({
    type: z.literal('wait_for_visible'),
    selector: z.string().min(1),
  }),
  z.object({
    type: z.literal('inject_impatient_user'),
    selector: z.string().min(1),
  }),
  z.object({ type: z.literal('read_test_state') }),
]);

export const sampleJourneyStepSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  action: sampleJourneyActionSchema,
});

export const sampleJourneyStepsSchema = z.array(sampleJourneyStepSchema).min(1);

export const sampleJourneyStepSummarySchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  actionType: z.enum([
    'navigate',
    'click',
    'fill',
    'wait_for_visible',
    'inject_impatient_user',
    'read_test_state',
  ]),
  selector: z.string().nullable(),
  path: z.string().nullable(),
});

export const sampleJourneySummarySchema = z.object({
  id: z.literal('sample-checkout-priority-0'),
  name: z.literal('Sample checkout order submission'),
  steps: z.array(sampleJourneyStepSummarySchema),
});

export const impatientUserExperimentSchema = z.object({
  experimentType: z.literal('impatient_user'),
  triggerCount: z.literal(2),
  intervalMs: z.literal(100),
  targetStep: z.literal('submit-order'),
});

export const assertionSnapshotSchema = z.object({
  id: z.string().min(1),
  assertionType: z.literal('max_created_orders'),
  configuration: z.object({ expectedMaximum: z.literal(1) }),
  description: z.literal('No more than one order should be created.'),
});

export const createdOrdersAssertionResultSchema = z.object({
  assertionType: z.literal('max_created_orders'),
  expectedMaximum: z.literal(1),
  observedCount: z.number().int().nonnegative().nullable(),
  status: assertionResultStatusSchema,
  expectedDescription: z.literal('No more than one order should be created.'),
  observedDescription: z.string().min(1),
});

export const browserRequestEvidenceSchema = z.object({
  requestId: z.string().min(1),
  method: z.literal('POST'),
  path: z.literal('/api/orders'),
  startedAtMs: z.number().int().nonnegative(),
  completedAtMs: z.number().int().nonnegative().nullable(),
  statusCode: z.number().int().min(100).max(599).nullable(),
  failed: z.boolean(),
});

export const sampleObservedStateSchema = z.object({
  browserOrderRequestCount: z.number().int().nonnegative(),
  requestAttemptCount: z.number().int().nonnegative(),
  acceptedCount: z.number().int().nonnegative(),
  deduplicatedCount: z.number().int().nonnegative(),
  rejectedCount: z.number().int().nonnegative(),
  createdOrderCount: z.number().int().nonnegative(),
  orderIds: z.array(z.string().min(1)),
  requests: z.array(browserRequestEvidenceSchema),
});

export const failedJourneyStepSchema = z.object({
  stepId: z.string().min(1),
  stepName: z.string().min(1),
  actionType: sampleJourneyStepSummarySchema.shape.actionType,
  selector: z.string().nullable(),
  path: z.string().nullable(),
});

export const sampleRunnerErrorSchema = z.object({
  code: z.enum([
    'target_unavailable',
    'browser_launch_failed',
    'journey_step_failed',
    'browser_cleanup_failed',
    'persistence_failed',
    'runner_failure',
  ]),
  message: z.string().min(1),
  failedStep: failedJourneyStepSchema.nullable(),
});

export const evidenceWarningSchema = z.object({
  code: z.literal('screenshot_capture_failed'),
  label: z.enum(['before-disruption', 'after-disruption', 'final-result']),
  message: z.string().min(1),
});

export const runArtifactSchema = z.object({
  artifactId: z.string().min(1),
  runId: z.string().min(1),
  artifactType: z.literal('screenshot'),
  label: z.enum(['before-disruption', 'after-disruption', 'final-result']),
  relativePath: z
    .string()
    .min(1)
    .refine(
      (value) =>
        !value.startsWith('/') &&
        !value.includes('\\') &&
        !/^[a-zA-Z]:/u.test(value) &&
        !value.split('/').includes('..'),
      'Artifact paths must be safe relative POSIX paths.',
    ),
  mimeType: z.literal('image/png'),
  sizeBytes: z.number().int().positive(),
  checksumSha256: z.string().regex(/^[0-9a-f]{64}$/u),
  captureSequence: z.number().int().positive(),
  createdAt: z.iso.datetime({ offset: true }),
  metadata: z.json(),
});

export const persistedAssertionResultSchema = z.object({
  assertionResultId: z.string().min(1),
  runId: z.string().min(1),
  assertionId: z.string().min(1),
  assertionType: z.literal('max_created_orders'),
  status: assertionResultStatusSchema,
  expected: z.json(),
  observed: z.json(),
  expectedDescription: z.string().min(1),
  observedDescription: z.string().min(1),
  evaluatedAt: z.iso.datetime({ offset: true }),
});

export const runSnapshotsSchema = z.object({
  journey: sampleJourneyStepsSchema,
  experiment: impatientUserExperimentSchema,
  assertions: z.array(assertionSnapshotSchema).min(1),
});

export const persistedRunDetailSchema = z.object({
  runId: z.string().min(1),
  experimentVersionId: z.string().min(1),
  status: runStatusSchema,
  mode: sampleRunModeSchema,
  startedAt: z.iso.datetime({ offset: true }),
  completedAt: z.iso.datetime({ offset: true }).nullable(),
  durationMs: z.number().int().nonnegative().nullable(),
  targetUrl: z.url(),
  createdAt: z.iso.datetime({ offset: true }),
  journey: sampleJourneySummarySchema,
  experiment: impatientUserExperimentSchema,
  assertions: z.array(createdOrdersAssertionResultSchema).length(1),
  snapshots: runSnapshotsSchema,
  events: z.array(runEventEnvelopeSchema),
  observed: sampleObservedStateSchema.nullable(),
  runnerError: sampleRunnerErrorSchema.nullable(),
  evidenceWarnings: z.array(evidenceWarningSchema),
  assertionResults: z.array(persistedAssertionResultSchema),
  artifacts: z.array(runArtifactSchema),
});

export const persistedRunSummarySchema = z.object({
  runId: z.string().min(1),
  mode: sampleRunModeSchema,
  status: runStatusSchema,
  startedAt: z.iso.datetime({ offset: true }),
  completedAt: z.iso.datetime({ offset: true }).nullable(),
  durationMs: z.number().int().nonnegative().nullable(),
  createdOrderCount: z.number().int().nonnegative().nullable(),
  assertionStatus: assertionResultStatusSchema.nullable(),
  screenshotCount: z.number().int().nonnegative(),
});

export const persistedRunListSchema = z.object({
  items: z.array(persistedRunSummarySchema),
  limit: z.number().int().positive(),
  offset: z.number().int().nonnegative(),
});

export type RunStatus = z.infer<typeof runStatusSchema>;
export type TerminalRunStatus = z.infer<typeof terminalRunStatusSchema>;

export function isTerminalRunStatus(
  status: RunStatus,
): status is TerminalRunStatus {
  return terminalRunStatusSchema.safeParse(status).success;
}
export type ExperimentType = z.infer<typeof experimentTypeSchema>;
export type JourneyActionType = z.infer<typeof journeyActionTypeSchema>;
export type ControlledTargetUrl = z.infer<typeof controlledTargetUrlSchema>;
export type Project = z.infer<typeof projectSchema>;
export type CreateProjectRequest = z.infer<typeof createProjectRequestSchema>;
export type ProjectList = z.infer<typeof projectListSchema>;
export type RecordingSessionStatus = z.infer<
  typeof recordingSessionStatusSchema
>;
export type ReplayLocator = z.infer<typeof replayLocatorSchema>;
export type TargetFingerprint = z.infer<typeof targetFingerprintSchema>;
export type RecordedValue = z.infer<typeof recordedValueSchema>;
export type RecordedJourneyStep = z.infer<typeof recordedJourneyStepSchema>;
export type RecordingWarningCode = z.infer<typeof recordingWarningCodeSchema>;
export type RecordingWarning = z.infer<typeof recordingWarningSchema>;
export type RecordingSession = z.infer<typeof recordingSessionSchema>;
export type SaveRecordedJourneyRequest = z.infer<
  typeof saveRecordedJourneyRequestSchema
>;
export type JourneyRecordingMetadata = z.infer<
  typeof journeyRecordingMetadataSchema
>;
export type PersistedJourney = z.infer<typeof persistedJourneySchema>;
export type JourneyList = z.infer<typeof journeyListSchema>;
export type ReplayFailure = z.infer<typeof replayFailureSchema>;
export type ReplayResult = z.infer<typeof replayResultSchema>;
export type AssertionResultStatus = z.infer<typeof assertionResultStatusSchema>;
export type RunEventEnvelope = z.infer<typeof runEventEnvelopeSchema>;
export type SampleRunMode = z.infer<typeof sampleRunModeSchema>;
export type StartSampleRunRequest = z.infer<typeof startSampleRunRequestSchema>;
export type StartSampleRunAccepted = z.infer<
  typeof startSampleRunAcceptedSchema
>;
export type SseRunEvent = z.infer<typeof sseRunEventSchema>;
export type SampleJourneyAction = z.infer<typeof sampleJourneyActionSchema>;
export type SampleJourneyStep = z.infer<typeof sampleJourneyStepSchema>;
export type SampleJourneyStepSummary = z.infer<
  typeof sampleJourneyStepSummarySchema
>;
export type SampleJourneySummary = z.infer<typeof sampleJourneySummarySchema>;
export type ImpatientUserExperiment = z.infer<
  typeof impatientUserExperimentSchema
>;
export type AssertionSnapshot = z.infer<typeof assertionSnapshotSchema>;
export type CreatedOrdersAssertionResult = z.infer<
  typeof createdOrdersAssertionResultSchema
>;
export type BrowserRequestEvidence = z.infer<
  typeof browserRequestEvidenceSchema
>;
export type SampleObservedState = z.infer<typeof sampleObservedStateSchema>;
export type FailedJourneyStep = z.infer<typeof failedJourneyStepSchema>;
export type SampleRunnerError = z.infer<typeof sampleRunnerErrorSchema>;
export type EvidenceWarning = z.infer<typeof evidenceWarningSchema>;
export type RunArtifact = z.infer<typeof runArtifactSchema>;
export type PersistedAssertionResult = z.infer<
  typeof persistedAssertionResultSchema
>;
export type RunSnapshots = z.infer<typeof runSnapshotsSchema>;
export type PersistedRunDetail = z.infer<typeof persistedRunDetailSchema>;
export type PersistedRunSummary = z.infer<typeof persistedRunSummarySchema>;
export type PersistedRunList = z.infer<typeof persistedRunListSchema>;
