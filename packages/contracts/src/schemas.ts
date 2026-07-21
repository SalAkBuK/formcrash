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

export const projectEnvironmentSchema = z.enum([
  'local',
  'staging',
  'production',
]);

export const projectSchema = z.object({
  id: z.string().min(1),
  name: z.string().trim().min(1).max(120),
  targetUrl: controlledTargetUrlSchema,
  environment: projectEnvironmentSchema,
  description: z.string().max(1_000),
  createdAt: z.iso.datetime({ offset: true }),
  updatedAt: z.iso.datetime({ offset: true }),
});

export const createProjectRequestSchema = z.object({
  name: projectSchema.shape.name,
  targetUrl: controlledTargetUrlSchema,
  environment: projectEnvironmentSchema.optional(),
  description: projectSchema.shape.description.optional().default(''),
});

export const projectListSchema = z.object({
  items: z.array(projectSchema),
});

export const deleteProjectResponseSchema = z.object({
  deletedProjectId: z.string().min(1),
});

export const deleteResourceResponseSchema = z.object({
  deletedId: z.string().min(1),
});

export const recordingSessionStatusSchema = z.enum([
  'created',
  'launching',
  'recording',
  'stopping',
  'completed',
  'cancelled',
  'runner_error',
]);

export const journeyCaptureFormatSchema = z.enum(['semantic-v1', 'hybrid-v2']);

export const traceCaptureStatusSchema = z.enum([
  'not_captured',
  'capturing',
  'complete',
  'truncated',
  'corrupt',
]);

export const replayModeSchema = z.enum(['adaptive', 'strict']);

export const replayPacingSchema = z.enum(['fast', 'recorded', 'deliberate']);

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

export const recordedTargetCandidateSchema = z.object({
  locator: replayLocatorSchema,
  source: z.enum([
    'test_attribute',
    'id',
    'accessibility',
    'name',
    'label',
    'text',
    'structure',
  ]),
  confidence: z.number().min(0).max(1),
});

export const recordedTargetGeometrySchema = z.object({
  x: z.number().finite(),
  y: z.number().finite(),
  width: z.number().finite().nonnegative(),
  height: z.number().finite().nonnegative(),
  pointerOffsetX: z.number().finite().nullable(),
  pointerOffsetY: z.number().finite().nullable(),
});

export const recordedPostconditionSchema = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('url'),
    value: controlledTargetUrlSchema,
    target: replayLocatorSchema.nullable().default(null),
  }),
  z.object({
    kind: z.literal('control_value'),
    value: z.string().max(10_000),
    target: replayLocatorSchema.nullable().default(null),
  }),
  z.object({
    kind: z.literal('checked'),
    value: z.boolean(),
    target: replayLocatorSchema.nullable().default(null),
  }),
  z.object({
    kind: z.literal('aria_attribute'),
    name: z.string().min(1).max(100),
    value: z.string().max(1_000).nullable(),
    target: replayLocatorSchema.nullable().default(null),
  }),
  z.object({
    kind: z.literal('visible_text'),
    value: z.string().min(1).max(500),
    target: replayLocatorSchema.nullable().default(null),
  }),
]);

export const recordedInteractionSchema = z.object({
  id: z.string().min(1),
  stepId: z.string().min(1),
  sequence: z.number().int().positive(),
  pageId: z.string().min(1),
  framePath: z.array(z.string().min(1)).max(20),
  startedAt: z.number().int().nonnegative(),
  durationMs: z.number().int().nonnegative(),
  intent: journeyActionTypeSchema,
  pointerType: z.enum(['mouse', 'pen', 'touch']).nullable(),
  targetCandidates: z.array(recordedTargetCandidateSchema).max(12),
  fingerprint: targetFingerprintSchema.nullable(),
  geometry: recordedTargetGeometrySchema.nullable(),
  postconditions: z.array(recordedPostconditionSchema).max(12),
  retrySafety: z.enum(['safe', 'side_effect_possible']),
});

export const recordedBrowserEnvironmentSchema = z.object({
  viewportWidth: z.number().int().positive(),
  viewportHeight: z.number().int().positive(),
  deviceScaleFactor: z.number().positive(),
  locale: z.string().min(1).max(100),
  timezoneId: z.string().min(1).max(100),
  userAgent: z.string().min(1).max(1_000),
  colorScheme: z.enum(['light', 'dark', 'no-preference']),
  browserName: z.literal('chromium'),
  browserVersion: z.string().min(1).max(100),
});

export const recordedVideoArtifactSchema = z.object({
  pageId: z.string().min(1),
  relativePath: z.string().min(1).max(2_000),
  sizeBytes: z.number().int().positive(),
  checksumSha256: z.string().regex(/^[a-f0-9]{64}$/u),
});

export const hybridTraceManifestSchema = z.object({
  formatVersion: z.literal(2),
  environment: recordedBrowserEnvironmentSchema,
  interactions: z.array(recordedInteractionSchema).max(100_000),
  eventCount: z.number().int().nonnegative(),
  pageCount: z.number().int().positive(),
  frameCount: z.number().int().positive(),
  redactionVersion: z.literal(1),
  videoCaptured: z.boolean(),
  videos: z.array(recordedVideoArtifactSchema).max(20).optional(),
  truncated: z.boolean(),
});

export const traceSummarySchema = z.object({
  interactionCount: z.number().int().nonnegative(),
  eventCount: z.number().int().nonnegative(),
  pageCount: z.number().int().nonnegative(),
  frameCount: z.number().int().nonnegative(),
  videoCaptured: z.boolean(),
  truncated: z.boolean(),
});

export const journeyTraceReferenceSchema = traceSummarySchema.extend({
  id: z.string().min(1),
  checksumSha256: z.string().regex(/^[a-f0-9]{64}$/u),
  sizeBytes: z.number().int().nonnegative(),
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

export const recordedRequestEvidenceSchema = z.object({
  actionStepId: z.string().min(1),
  method: z.string().regex(/^[A-Z]+$/u),
  origin: z.string().url(),
  host: z.string().min(1),
  pathname: z.string().startsWith('/'),
  status: z.number().int().min(100).max(599).nullable(),
  failed: z.boolean().default(false),
  relativeTimestampMs: z.number().int().min(0).max(5_000),
  occurrences: z.number().int().positive(),
  observedAt: z.iso.datetime({ offset: true }),
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
  captureFormat: journeyCaptureFormatSchema.optional(),
  traceStatus: traceCaptureStatusSchema.optional(),
  traceSummary: traceSummarySchema.nullable().optional(),
  requestEvidence: z.array(recordedRequestEvidenceSchema).max(500).default([]),
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
  replayFormat: journeyCaptureFormatSchema.optional(),
  trace: journeyTraceReferenceSchema.nullable().optional(),
});

export const journeyListSchema = z.object({
  items: z.array(persistedJourneySchema),
});

export const criticalActionSchema = z.object({
  id: z.string().min(1),
  journeyId: z.string().min(1),
  stepId: z.string().min(1),
  label: z.string().trim().min(1).max(160),
  createdAt: z.iso.datetime({ offset: true }),
  updatedAt: z.iso.datetime({ offset: true }),
});

export const approveCriticalActionRequestSchema = z.object({
  stepId: z.string().min(1),
  label: criticalActionSchema.shape.label,
});

export const criticalActionResponseSchema = z.object({
  criticalAction: criticalActionSchema.nullable(),
});

export const outcomeCheckTypeSchema = z.enum([
  'visible_element_exists',
  'matching_item_appears_exactly_once',
  'final_pathname_matches',
]);

export const generatedValueExpressionSchema = z.enum([
  'unique.email',
  'unique.name',
  'unique.phone',
  'unique.text',
]);

export const generatedValueBindingSchema = z.object({
  expression: generatedValueExpressionSchema,
  template: z.string().regex(/^\{\{unique\.(email|name|phone|text)\}\}$/u),
  label: z.string().min(1).max(120),
});

export const generatedBaselineInputSchema = z.object({
  stepId: z.string().min(1),
  stepName: z.string().min(1).max(160),
  expression: generatedValueExpressionSchema,
  template: generatedValueBindingSchema.shape.template,
  label: generatedValueBindingSchema.shape.label,
  resolvedValue: z.string().min(1).max(1_000).optional(),
});

export const outcomeElementFingerprintSchema = z.object({
  tagName: z.string().min(1).max(80),
  dataFormcrash: z.string().max(160).nullable(),
  dataTestId: z.string().max(160).nullable(),
  id: z.string().max(160).nullable(),
  role: z.string().max(80).nullable(),
  accessibleName: z.string().max(240).nullable(),
  name: z.string().max(160).nullable(),
  cssPath: z.string().min(1).max(1_000),
});

export const outcomeCaptureWarningCodeSchema = z.enum([
  'ambiguous_locator',
  'unstable_locator',
  'unsupported_iframe',
  'sensitive_content',
  'dynamic_locator',
  'generated_binding_unavailable',
]);

export const outcomeCaptureWarningSchema = z.object({
  code: outcomeCaptureWarningCodeSchema,
  message: z.string().min(1).max(500),
});

export const capturedOutcomeTargetSchema = z.object({
  locator: replayLocatorSchema,
  fingerprint: outcomeElementFingerprintSchema,
  preview: z.string().min(1).max(300),
  reliability: z.enum(['high', 'review']),
  warnings: z.array(outcomeCaptureWarningSchema).max(10),
  generatedBindings: z.array(generatedValueBindingSchema).max(4),
});

export const outcomeCaptureStatusSchema = z.enum([
  'launching',
  'replaying',
  'awaiting_selection',
  'selection_ready',
  'selection_rejected',
  'selection_cancelled',
  'closing',
  'completed',
  'runner_error',
  'expired',
]);

export const outcomeCaptureSessionSchema = z.object({
  id: z.string().min(1),
  journeyId: z.string().min(1),
  criticalActionId: z.string().min(1),
  generatedInputs: z.array(generatedBaselineInputSchema).max(20),
  status: outcomeCaptureStatusSchema,
  selectedTarget: capturedOutcomeTargetSchema.nullable(),
  selectionWarnings: z.array(outcomeCaptureWarningSchema).max(10),
  finalPathname: z.string().startsWith('/').max(2_000).nullable(),
  errorMessage: z.string().min(1).max(1_000).nullable(),
  startedAt: z.iso.datetime({ offset: true }),
  expiresAt: z.iso.datetime({ offset: true }),
  completedAt: z.iso.datetime({ offset: true }).nullable(),
});

export const outcomeCaptureResponseSchema = z.object({
  capture: outcomeCaptureSessionSchema.nullable(),
});

export const startOutcomeCaptureRequestSchema = z.object({
  variables: z
    .record(z.string().regex(/^[A-Z][A-Z0-9_]*$/u), z.string().max(10_000))
    .optional()
    .default({}),
  confirmProduction: z.boolean().optional().default(false),
});

const outcomeCheckApprovalBaseSchema = z.object({
  description: z.string().trim().min(1).max(500),
});

export const approveOutcomeCheckRequestSchema = z.discriminatedUnion('type', [
  outcomeCheckApprovalBaseSchema.extend({
    type: z.literal('visible_element_exists'),
  }),
  outcomeCheckApprovalBaseSchema.extend({
    type: z.literal('matching_item_appears_exactly_once'),
    bindingExpression: generatedValueExpressionSchema,
  }),
  outcomeCheckApprovalBaseSchema.extend({
    type: z.literal('final_pathname_matches'),
    expectedPathname: z.string().startsWith('/').max(2_000),
  }),
]);

const persistedOutcomeCheckBaseSchema = z.object({
  id: z.string().min(1),
  journeyId: z.string().min(1),
  criticalActionId: z.string().min(1),
  description: z.string().trim().min(1).max(500),
  createdAt: z.iso.datetime({ offset: true }),
});

export const outcomeCheckSchema = z.discriminatedUnion('type', [
  persistedOutcomeCheckBaseSchema.extend({
    type: z.literal('visible_element_exists'),
    target: capturedOutcomeTargetSchema,
  }),
  persistedOutcomeCheckBaseSchema.extend({
    type: z.literal('matching_item_appears_exactly_once'),
    target: capturedOutcomeTargetSchema,
    binding: generatedValueBindingSchema,
  }),
  persistedOutcomeCheckBaseSchema.extend({
    type: z.literal('final_pathname_matches'),
    expectedPathname: z.string().startsWith('/').max(2_000),
  }),
]);

export const outcomeCheckListSchema = z.object({
  items: z.array(outcomeCheckSchema),
});

export const outcomeCheckRunSnapshotSchema = z
  .object({
    criticalAction: criticalActionSchema.nullable(),
    checks: z.array(outcomeCheckSchema),
  })
  .superRefine((value, context) => {
    if (value.checks.length > 0 && value.criticalAction === null) {
      context.addIssue({
        code: 'custom',
        path: ['criticalAction'],
        message: 'Outcome Checks require an approved Critical Action.',
      });
      return;
    }
    if (
      value.criticalAction !== null &&
      value.checks.some(
        (check) =>
          check.journeyId !== value.criticalAction?.journeyId ||
          check.criticalActionId !== value.criticalAction.id,
      )
    ) {
      context.addIssue({
        code: 'custom',
        path: ['checks'],
        message:
          'Every Outcome Check must belong to the snapshotted Critical Action.',
      });
    }
  });

export const replayFailureSchema = z.object({
  stepId: z.string().min(1),
  stepName: z.string().min(1),
  stepNumber: z.number().int().positive(),
  actionType: journeyActionTypeSchema,
  message: z.string().min(1),
  technicalMessage: z.string().min(1).nullable().default(null),
  currentUrl: controlledTargetUrlSchema.nullable().default(null),
  locator: replayLocatorSchema.nullable().default(null),
  pageId: z.string().min(1).nullable().optional(),
  framePath: z.array(z.string().min(1)).max(20).optional(),
  resolutionAttempts: z.array(z.string().min(1).max(500)).max(20).optional(),
  confidence: z.number().min(0).max(1).nullable().optional(),
  expectedState: z.array(z.string().min(1).max(500)).max(20).optional(),
  observedState: z.array(z.string().min(1).max(500)).max(20).optional(),
  sideEffectObserved: z.boolean().optional(),
});

export const replayInteractionOutcomeSchema = z.object({
  stepId: z.string().min(1),
  status: z.enum(['verified', 'recovered', 'ambiguous', 'unsupported']),
  strategy: z.string().min(1).max(160),
  confidence: z.number().min(0).max(1),
});

export const replayResultSchema = z.object({
  replayId: z.string().min(1),
  journeyId: z.string().min(1),
  status: z.enum(['passed', 'failed', 'runner_error']),
  failedStep: replayFailureSchema.nullable(),
  startedAt: z.iso.datetime({ offset: true }),
  completedAt: z.iso.datetime({ offset: true }),
  mode: replayModeSchema.optional(),
  pacing: replayPacingSchema.optional(),
  interactionOutcomes: z.array(replayInteractionOutcomeSchema).optional(),
});

export const runtimeVariableNameSchema = z
  .string()
  .regex(/^[A-Z][A-Z0-9_]*$/u)
  .max(100);

export const runtimeVariableDeclarationInputSchema = z.object({
  name: runtimeVariableNameSchema,
  secret: z.boolean(),
  description: z.string().max(300).default(''),
  template: z.string().max(10_000).nullable().default(null),
});

export const runtimeVariableDeclarationSchema =
  runtimeVariableDeclarationInputSchema.extend({
    environmentName: z.string().min(1),
    configured: z.boolean(),
  });

export const hookMethodSchema = z.enum(['POST', 'DELETE']);
export const httpHookSchema = z.object({
  method: hookMethodSchema,
  url: controlledTargetUrlSchema,
  headers: z.record(z.string().min(1).max(100), z.string().max(10_000)),
  body: z.json().nullable(),
  timeoutMs: z.number().int().min(100).max(30_000).default(5_000),
});

export const projectExecutionSettingsInputSchema = z.object({
  variables: z.array(runtimeVariableDeclarationInputSchema).max(100),
  beforeRunHook: httpHookSchema.nullable(),
  afterRunHook: httpHookSchema.nullable(),
});

export const productionReplayAcknowledgementInputSchema = z.object({
  acknowledged: z.boolean(),
});

export const projectAuthStatusSchema = z.object({
  configured: z.boolean(),
  available: z.boolean(),
  capturedAt: z.iso.datetime({ offset: true }).nullable(),
  missingReason: z.string().nullable(),
  requirement: z
    .enum(['unknown', 'not_required', 'user_confirmed_public', 'required'])
    .optional(),
  verification: z
    .enum(['not_checked', 'valid', 'expired', 'failed', 'inconclusive'])
    .optional(),
  lastCheckedAt: z.iso.datetime({ offset: true }).nullable().optional(),
});

export const projectExecutionSettingsSchema = z.object({
  projectId: z.string().min(1),
  variables: z.array(runtimeVariableDeclarationSchema),
  beforeRunHook: httpHookSchema.nullable(),
  afterRunHook: httpHookSchema.nullable(),
  authentication: projectAuthStatusSchema,
  productionReplayAcknowledged: z.boolean().optional(),
  productionReplayAcknowledgedAt: z.iso
    .datetime({ offset: true })
    .nullable()
    .optional(),
  updatedAt: z.iso.datetime({ offset: true }),
});

export const authCaptureStatusSchema = z.enum([
  'created',
  'launching',
  'awaiting_confirmation',
  'stopping',
  'completed',
  'cancelled',
  'runner_error',
]);

export const authCaptureSessionSchema = z.object({
  id: z.string().min(1),
  projectId: z.string().min(1),
  status: authCaptureStatusSchema,
  errorMessage: z.string().nullable(),
  startedAt: z.iso.datetime({ offset: true }),
  completedAt: z.iso.datetime({ offset: true }).nullable(),
});

export const authValidationResultSchema = z.object({
  projectId: z.string().min(1),
  status: z.enum(['valid', 'invalid', 'runner_error']),
  outcome: z
    .enum([
      'public',
      'target_accessible',
      'authenticated',
      'authentication_required',
      'authentication_expired',
      'target_unavailable',
      'inconclusive',
    ])
    .optional(),
  currentUrl: controlledTargetUrlSchema.nullable(),
  message: z.string().min(1),
  checkedAt: z.iso.datetime({ offset: true }),
});

export const ephemeralRuntimeValuesSchema = z
  .record(runtimeVariableNameSchema, z.string().max(10_000))
  .default({});

export const networkMatcherSchema = z.object({
  method: z.string().regex(/^[A-Z]+$/u),
  pathname: z.string().startsWith('/'),
  host: z.string().min(1).nullable().default(null),
});

export const discoveredRequestSchema = z.object({
  method: z.string().regex(/^[A-Z]+$/u),
  pathname: z.string().startsWith('/'),
  origin: z.string().url(),
  status: z.number().int().min(100).max(599).nullable(),
  failed: z.boolean().default(false),
  relativeTimestampMs: z.number().int().nonnegative(),
  occurrences: z.number().int().positive(),
});

export const requestCandidateClassificationSchema = z.enum([
  'likely_business_mutation',
  'background_refresh',
  'analytics',
  'static_asset',
  'other',
]);

export const requestRecommendationConfidenceSchema = z.enum([
  'high',
  'review',
  'ambiguous',
]);

export const requestRecommendationReasonCodeSchema = z.enum([
  'mutation_method',
  'read_only_method',
  'same_origin',
  'cross_origin',
  'successful_status',
  'server_error_status',
  'failed_request',
  'missing_status',
  'immediate_after_action',
  'soon_after_action',
  'delayed_after_action',
  'api_like_path',
  'action_path_similarity',
  'journey_path_similarity',
  'single_occurrence',
  'repeated_occurrence',
  'background_endpoint',
  'background_refresh',
  'analytics_endpoint',
  'static_asset',
]);

export const requestRecommendationReasonSchema = z.object({
  code: requestRecommendationReasonCodeSchema,
  label: z.string().min(1).max(240),
  scoreImpact: z.number().int().min(-1_000).max(1_000),
});

export const rankedRequestCandidateSchema = discoveredRequestSchema.extend({
  candidateId: z.string().regex(/^request-[a-f0-9]{24}$/u),
  rank: z.number().int().positive(),
  score: z.number().int().min(-1_000).max(1_000),
  classification: requestCandidateClassificationSchema,
  confidence: requestRecommendationConfidenceSchema,
  recommended: z.boolean(),
  reasons: z.array(requestRecommendationReasonSchema).min(1).max(30),
});

export const networkEvidenceSourceSchema = z.enum(['recording', 'prior_run']);

export const networkEvidenceCandidateSchema =
  rankedRequestCandidateSchema.extend({
    source: networkEvidenceSourceSchema,
    sourceRunId: z.string().min(1).nullable().default(null),
    actionStepId: z.string().min(1),
    host: z.string().min(1),
    observedAt: z.iso.datetime({ offset: true }),
  });

export const networkEvidenceCandidateListSchema = z.object({
  items: z.array(networkEvidenceCandidateSchema).max(100),
  source: networkEvidenceSourceSchema.nullable(),
  explanation: z.string().min(1).max(1_000),
});

export const networkEvidenceProvenanceSchema = z.object({
  source: networkEvidenceSourceSchema,
  sourceRunId: z.string().min(1).nullable().default(null),
  actionStepId: z.string().min(1),
  candidateId: z.string().regex(/^request-[a-f0-9]{24}$/u),
  candidateScore: z.number().int().min(-1_000).max(1_000),
  candidateConfidence: requestRecommendationConfidenceSchema,
  recommendationReasons: z
    .array(requestRecommendationReasonSchema)
    .min(1)
    .max(30),
  matcher: networkMatcherSchema,
  observedStatus: z.number().int().min(100).max(599).nullable(),
  observedFailed: z.boolean(),
  relativeTimestampMs: z.number().int().min(0).max(5_000),
  observedAt: z.iso.datetime({ offset: true }),
  approvedAt: z.iso.datetime({ offset: true }),
});

export const requestDiscoveryOutcomeSchema = z.enum([
  'recommended',
  'review',
  'ambiguous',
  'no_candidate',
]);

export const requestDiscoveryRecommendationSchema = z.object({
  outcome: requestDiscoveryOutcomeSchema,
  recommendedCandidateId: z.string().min(1).nullable().default(null),
  explanation: z.string().min(1).max(1_000),
});

export const assertionRecommendationRecipeTypeSchema = z.enum([
  'duplicate_action',
  'rapid_triple_action',
  'server_duplicate_handling',
  'advanced_repeated_action',
]);

export const assertionRecommendationRecipeSchema = z.object({
  type: assertionRecommendationRecipeTypeSchema,
  triggerCount: z.union([z.literal(2), z.literal(3)]),
  intervalMs: z.union([z.literal(0), z.literal(100), z.literal(300)]),
});

export const requestDiscoveryRequestSchema = z.object({
  targetStepId: z.string().min(1),
  recipe: assertionRecommendationRecipeSchema,
  variables: ephemeralRuntimeValuesSchema.optional().default({}),
  confirmProduction: z.boolean().optional().default(false),
  normalizeJourney: z.boolean().optional().default(false),
  stepValueOverrides: z
    .record(z.string().min(1), z.string().max(10_000))
    .optional()
    .default({}),
});

export const requestSelectionModeSchema = z.enum([
  'automatic',
  'confirmed_recommendation',
  'manual_override',
]);

export const requestSelectionProvenanceSchema = z
  .object({
    selectionMode: requestSelectionModeSchema,
    discoveryId: z.uuid(),
    discoveredAt: z.iso.datetime({ offset: true }),
    discoveryOutcome: requestDiscoveryOutcomeSchema,
    selectedCandidateId: z.string().min(1),
    selectedCandidateScore: z.number().int(),
    selectedCandidateConfidence: requestRecommendationConfidenceSchema,
    recommendationReasons: z
      .array(requestRecommendationReasonSchema)
      .min(1)
      .max(30),
    recommendedMatcher: networkMatcherSchema.nullable().default(null),
    selectedMatcher: networkMatcherSchema,
    userOverrodeRecommendation: z.boolean(),
  })
  .superRefine((value, context) => {
    const selectedRecommendation =
      value.recommendedMatcher !== null &&
      sameNetworkMatcher(value.recommendedMatcher, value.selectedMatcher);
    if (
      ['automatic', 'confirmed_recommendation'].includes(value.selectionMode) &&
      (value.discoveryOutcome !== 'recommended' ||
        !selectedRecommendation ||
        value.userOverrodeRecommendation)
    ) {
      context.addIssue({
        code: 'custom',
        path: ['selectionMode'],
        message:
          'Automatic or confirmed selection must accept the server recommendation without an override.',
      });
    }
    if (
      value.selectionMode === 'manual_override' &&
      value.userOverrodeRecommendation !==
        (value.recommendedMatcher !== null && !selectedRecommendation)
    ) {
      context.addIssue({
        code: 'custom',
        path: ['userOverrodeRecommendation'],
        message:
          'Manual override metadata must state whether a server recommendation was replaced.',
      });
    }
  });

export const externalAssertionTypeSchema = z.enum([
  'network_request_max',
  'network_request_exact',
  'network_success_max',
  'network_success_exact',
  'network_expected_status',
  'network_all_status',
  'network_no_server_errors',
  'element_visible',
  'element_not_visible',
  'element_disabled',
  'text_appeared',
  'field_retained',
  'final_url_contains',
  'final_url_not_contains',
]);

const assertionBaseSchema = z.object({
  id: z.string().min(1),
  description: z.string().min(1).max(500),
});

export const externalAssertionSchema = z.discriminatedUnion('type', [
  assertionBaseSchema.extend({
    type: z.literal('network_request_max'),
    maximum: z.number().int().nonnegative(),
  }),
  assertionBaseSchema.extend({
    type: z.literal('network_request_exact'),
    expected: z.number().int().nonnegative(),
  }),
  assertionBaseSchema.extend({
    type: z.literal('network_success_max'),
    maximum: z.number().int().nonnegative(),
  }),
  assertionBaseSchema.extend({
    type: z.literal('network_success_exact'),
    expected: z.number().int().nonnegative(),
  }),
  assertionBaseSchema.extend({
    type: z.literal('network_expected_status'),
    expectedStatus: z.number().int().min(100).max(599),
  }),
  assertionBaseSchema.extend({
    type: z.literal('network_all_status'),
    allowedStatuses: z.array(z.number().int().min(100).max(599)).min(1).max(20),
  }),
  assertionBaseSchema.extend({
    type: z.literal('network_no_server_errors'),
  }),
  assertionBaseSchema.extend({
    type: z.literal('element_visible'),
    locator: replayLocatorSchema,
    targetDescription: z.string().min(1).max(300),
  }),
  assertionBaseSchema.extend({
    type: z.literal('element_not_visible'),
    locator: replayLocatorSchema,
    targetDescription: z.string().min(1).max(300),
  }),
  assertionBaseSchema.extend({
    type: z.literal('element_disabled'),
    locator: replayLocatorSchema,
    targetDescription: z.string().min(1).max(300),
    observationWindow: z.enum(['final', 'during_repeated_action']).optional(),
  }),
  assertionBaseSchema.extend({
    type: z.literal('text_appeared'),
    text: z.string().min(1).max(1_000),
  }),
  assertionBaseSchema.extend({
    type: z.literal('field_retained'),
    locator: replayLocatorSchema,
    targetDescription: z.string().min(1).max(300),
    expectedValue: recordedValueSchema,
  }),
  assertionBaseSchema.extend({
    type: z.literal('final_url_contains'),
    value: z.string().min(1).max(2_000),
  }),
  assertionBaseSchema.extend({
    type: z.literal('final_url_not_contains'),
    value: z.string().min(1).max(2_000),
  }),
]);

export const normalActionElementObservationSchema = z.object({
  observationId: z.string().regex(/^element-[a-f0-9]{24}$/u),
  locator: replayLocatorSchema,
  classification: z.enum(['success', 'error', 'loading']),
  visibleBefore: z.boolean(),
  visibleAfter: z.boolean(),
});

export const normalActionObservationSchema = z.object({
  targetControlLocator: replayLocatorSchema.nullable().default(null),
  targetWasDisabledDuringPending: z.boolean().nullable().default(null),
  finalPathname: z.string().startsWith('/').max(2_000).nullable().default(null),
  elements: z.array(normalActionElementObservationSchema).max(20).default([]),
});

export const assertionRecommendationCategorySchema = z.enum([
  'request_count',
  'response_outcome',
  'server_error',
  'submit_state',
  'success_interface',
  'error_interface',
  'navigation',
  'field_retention',
]);

export const assertionRecommendationConfidenceSchema = z.enum([
  'high',
  'review',
]);

export const assertionRecommendationEvidenceSchema = z.object({
  evidenceIds: z.array(z.string().min(1).max(160)).max(20),
  source: z.enum([
    'request_discovery',
    'normal_action_state',
    'normal_interface_state',
    'normal_navigation',
    'recipe',
  ]),
});

export const assertionRecommendationSchema = z.object({
  recommendationId: z.string().regex(/^assertion-rec-[a-f0-9]{24}$/u),
  assertion: externalAssertionSchema,
  category: assertionRecommendationCategorySchema,
  confidence: assertionRecommendationConfidenceSchema,
  defaultEnabled: z.boolean(),
  reasonCode: z.string().regex(/^[a-z][a-z0-9_]{1,79}$/u),
  explanation: z.string().min(1).max(1_000),
  evidence: assertionRecommendationEvidenceSchema,
});

export const assertionRecommendationSetSchema = z.object({
  recipeType: assertionRecommendationRecipeTypeSchema,
  selectedRequestCandidateId: z.string().min(1).nullable().default(null),
  recommendations: z.array(assertionRecommendationSchema).max(20),
  limitations: z.array(z.string().min(1).max(500)).max(20),
});

export const requestDiscoveryResultSchema = z
  .object({
    discoveryId: z.uuid(),
    discoveredAt: z.iso.datetime({ offset: true }),
    journeyId: z.string().min(1),
    targetStepId: z.string().min(1),
    candidates: z.array(rankedRequestCandidateSchema),
    recommendation: requestDiscoveryRecommendationSchema,
    normalAction: normalActionObservationSchema,
    assertionRecommendationSets: z
      .array(assertionRecommendationSetSchema)
      .min(1),
  })
  .superRefine((value, context) => {
    const recommended = value.candidates.filter(
      (candidate) => candidate.recommended,
    );
    if (
      value.recommendation.outcome === 'recommended' &&
      (recommended.length !== 1 ||
        recommended[0]?.candidateId !==
          value.recommendation.recommendedCandidateId ||
        recommended[0]?.confidence !== 'high')
    ) {
      context.addIssue({
        code: 'custom',
        path: ['recommendation'],
        message:
          'A recommended discovery must identify exactly one high-confidence recommended candidate.',
      });
    }
    if (
      value.recommendation.outcome !== 'recommended' &&
      (value.recommendation.recommendedCandidateId !== null ||
        recommended.length > 0)
    ) {
      context.addIssue({
        code: 'custom',
        path: ['recommendation'],
        message:
          'Review, ambiguous, and no-candidate discoveries cannot silently recommend a candidate.',
      });
    }
    const setCandidateIds = value.assertionRecommendationSets.map(
      (set) => set.selectedRequestCandidateId,
    );
    if (new Set(setCandidateIds).size !== setCandidateIds.length) {
      context.addIssue({
        code: 'custom',
        path: ['assertionRecommendationSets'],
        message:
          'Assertion recommendation sets must identify unique request candidates.',
      });
    }
  });

export const assertionSelectionOriginSchema = z.enum([
  'generated',
  'generated_modified',
  'manual',
]);

export const assertionSelectionActionSchema = z.enum([
  'accepted',
  'enabled',
  'disabled',
  'modified',
  'manual',
]);

export const assertionSelectionProvenanceEntrySchema = z.object({
  assertionId: z.string().min(1).nullable(),
  recommendationId: z.string().min(1).nullable(),
  origin: assertionSelectionOriginSchema,
  confidence: assertionRecommendationConfidenceSchema.nullable(),
  reasonCode: z.string().min(1).max(80).nullable(),
  explanation: z.string().min(1).max(1_000).nullable(),
  defaultEnabled: z.boolean().nullable(),
  action: assertionSelectionActionSchema,
  evidenceIds: z.array(z.string().min(1).max(160)).max(20),
});

const externalExperimentConfigurationRequestObjectSchema = z.object({
  targetStepId: z.string().min(1),
  triggerCount: z.union([z.literal(2), z.literal(3)]),
  intervalMs: z.union([z.literal(0), z.literal(100), z.literal(300)]),
  networkMatcher: networkMatcherSchema.nullable().default(null),
  assertions: z.array(externalAssertionSchema).max(20),
  continueAfterTarget: z.boolean().default(false),
  guided: z.boolean().optional(),
  requestSelectionProvenance: requestSelectionProvenanceSchema
    .nullable()
    .optional()
    .default(null),
  networkEvidenceProvenance: networkEvidenceProvenanceSchema
    .nullable()
    .optional(),
  assertionSelectionProvenance: z
    .array(assertionSelectionProvenanceEntrySchema)
    .max(40)
    .optional(),
});

type ExternalExperimentConfigurationRequest = z.infer<
  typeof externalExperimentConfigurationRequestObjectSchema
>;
type ExternalExperimentConfigurationRefinementContext = Parameters<
  Parameters<
    typeof externalExperimentConfigurationRequestObjectSchema.superRefine
  >[0]
>[1];

function refineExternalExperimentConfiguration(
  value: ExternalExperimentConfigurationRequest,
  context: ExternalExperimentConfigurationRefinementContext,
): void {
  if (
    value.networkMatcher === null &&
    value.assertions.some((assertion) => assertion.type.startsWith('network_'))
  ) {
    context.addIssue({
      code: 'custom',
      path: ['networkMatcher'],
      message:
        'A discovered network request matcher is required for network assertions.',
    });
  }
  if (
    value.assertions.some((assertion) =>
      assertion.type.startsWith('network_'),
    ) &&
    value.requestSelectionProvenance === null &&
    value.networkEvidenceProvenance == null
  ) {
    context.addIssue({
      code: 'custom',
      path: ['networkEvidenceProvenance'],
      message:
        'Network assertions require an explicitly approved recording or prior-run request candidate.',
    });
  }
  if (
    value.requestSelectionProvenance?.selectedMatcher !== null &&
    value.requestSelectionProvenance?.selectedMatcher !== undefined &&
    (value.networkMatcher === null ||
      value.requestSelectionProvenance.selectedMatcher.method !==
        value.networkMatcher.method ||
      value.requestSelectionProvenance.selectedMatcher.pathname !==
        value.networkMatcher.pathname ||
      value.requestSelectionProvenance.selectedMatcher.host !==
        value.networkMatcher.host)
  ) {
    context.addIssue({
      code: 'custom',
      path: ['requestSelectionProvenance', 'selectedMatcher'],
      message:
        'The persisted selected matcher must match the experiment network matcher.',
    });
  }
  if (
    value.networkEvidenceProvenance != null &&
    (value.networkMatcher === null ||
      !sameNetworkMatcher(
        value.networkEvidenceProvenance.matcher,
        value.networkMatcher,
      ))
  ) {
    context.addIssue({
      code: 'custom',
      path: ['networkEvidenceProvenance', 'matcher'],
      message:
        'The approved evidence matcher must match the experiment network matcher.',
    });
  }
  if (
    value.guided === true &&
    value.networkMatcher !== null &&
    (value.requestSelectionProvenance !== null ||
      value.networkEvidenceProvenance != null)
  ) {
    const requestLimit = value.assertions.find(
      (assertion) => assertion.type === 'network_request_max',
    );
    const successLimit = value.assertions.find(
      (assertion) => assertion.type === 'network_success_max',
    );
    const noServerErrors = value.assertions.some(
      (assertion) => assertion.type === 'network_no_server_errors',
    );
    if (
      requestLimit?.type !== 'network_request_max' ||
      requestLimit.maximum !== value.triggerCount ||
      successLimit?.type !== 'network_success_max' ||
      successLimit.maximum !== 1 ||
      !noServerErrors
    ) {
      context.addIssue({
        code: 'custom',
        path: ['assertions'],
        message:
          'An approved guided network recipe must bound all trigger attempts, allow at most one successful response, and reject HTTP 5xx.',
      });
    }
    if (value.triggerCount === 2 && value.intervalMs === 300) {
      const statuses = value.assertions.find(
        (assertion) => assertion.type === 'network_all_status',
      );
      const observedStatus = value.networkEvidenceProvenance?.observedStatus;
      if (
        statuses?.type !== 'network_all_status' ||
        !statuses.allowedStatuses.includes(409) ||
        (observedStatus != null &&
          !statuses.allowedStatuses.includes(observedStatus)) ||
        (observedStatus == null &&
          !statuses.allowedStatuses.some(
            (status) => status >= 200 && status < 400,
          ))
      ) {
        context.addIssue({
          code: 'custom',
          path: ['assertions'],
          message:
            'Server duplicate handling requires the approved successful status and HTTP 409 duplicate response set.',
        });
      }
    }
  }
  if ((value.assertionSelectionProvenance?.length ?? 0) > 0) {
    const persistedAssertionIds = value.assertions.map(
      (assertion) => assertion.id,
    );
    const provenanceAssertionIds = (value.assertionSelectionProvenance ?? [])
      .map((entry) => entry.assertionId)
      .filter((id): id is string => id !== null);
    if (
      new Set(provenanceAssertionIds).size !== provenanceAssertionIds.length ||
      persistedAssertionIds.some(
        (assertionId) => !provenanceAssertionIds.includes(assertionId),
      ) ||
      provenanceAssertionIds.some(
        (assertionId) => !persistedAssertionIds.includes(assertionId),
      )
    ) {
      context.addIssue({
        code: 'custom',
        path: ['assertionSelectionProvenance'],
        message:
          'Assertion provenance must identify every saved assertion exactly once.',
      });
    }
  }
}

export const createExternalExperimentRequestSchema =
  externalExperimentConfigurationRequestObjectSchema
    .extend({
      name: z.string().trim().min(1).max(160),
      normalizeJourney: z.boolean().optional(),
      stepValueOverrides: z
        .record(z.string().min(1), z.string().max(10_000))
        .optional(),
    })
    .superRefine(refineExternalExperimentConfiguration);

export const createExternalExperimentSuiteRequestSchema = z
  .object({
    tests: z.array(createExternalExperimentRequestSchema).length(3),
  })
  .superRefine((value, context) => {
    const names = value.tests.map((test) => test.name);
    if (new Set(names).size !== names.length) {
      context.addIssue({
        code: 'custom',
        path: ['tests'],
        message: 'Every generated Test in a suite must have a distinct name.',
      });
    }
    const targetStepIds = new Set(value.tests.map((test) => test.targetStepId));
    if (targetStepIds.size !== 1) {
      context.addIssue({
        code: 'custom',
        path: ['tests'],
        message: 'Every generated Test must use the same Critical Action.',
      });
    }
    const configurations = new Set(
      value.tests.map((test) => `${test.triggerCount}:${test.intervalMs}`),
    );
    const requiredConfigurations = ['2:0', '3:100', '2:300'];
    if (
      configurations.size !== requiredConfigurations.length ||
      requiredConfigurations.some(
        (configuration) => !configurations.has(configuration),
      )
    ) {
      context.addIssue({
        code: 'custom',
        path: ['tests'],
        message:
          'A generated Test suite must include double-click, triple-click, and delayed-repeat configurations exactly once.',
      });
    }
  });

export const createExternalExperimentVersionRequestSchema =
  externalExperimentConfigurationRequestObjectSchema
    .strict()
    .superRefine(refineExternalExperimentConfiguration);

export const externalExperimentVersionSchema = z.object({
  id: z.string().min(1),
  experimentId: z.string().min(1),
  projectId: z.string().min(1),
  journeyId: z.string().min(1),
  name: z.string().min(1),
  experimentType: z.literal('impatient_user'),
  version: z.number().int().positive(),
  targetStepId: z.string().min(1),
  triggerCount: z.union([z.literal(2), z.literal(3)]),
  intervalMs: z.union([z.literal(0), z.literal(100), z.literal(300)]),
  networkMatcher: networkMatcherSchema.nullable(),
  assertions: z.array(externalAssertionSchema).max(20),
  continueAfterTarget: z.boolean(),
  guided: z.boolean().default(false),
  requestSelectionProvenance: requestSelectionProvenanceSchema
    .nullable()
    .default(null),
  networkEvidenceProvenance: networkEvidenceProvenanceSchema
    .nullable()
    .optional(),
  assertionSelectionProvenance: z
    .array(assertionSelectionProvenanceEntrySchema)
    .default([]),
  outcomeCheckSnapshot: outcomeCheckRunSnapshotSchema.default({
    criticalAction: null,
    checks: [],
  }),
  journeySnapshot: persistedJourneySchema,
  createdAt: z.iso.datetime({ offset: true }),
});

export const externalExperimentListSchema = z.object({
  items: z.array(externalExperimentVersionSchema),
});

function sameNetworkMatcher(
  left: z.infer<typeof networkMatcherSchema>,
  right: z.infer<typeof networkMatcherSchema>,
): boolean {
  return (
    left.method === right.method &&
    left.pathname === right.pathname &&
    left.host === right.host
  );
}

export const runExternalExperimentRequestSchema = z.object({
  variables: ephemeralRuntimeValuesSchema.optional().default({}),
  confirmProduction: z.boolean().optional().default(false),
  replayMode: replayModeSchema.optional().default('adaptive'),
  replayPacing: replayPacingSchema.optional().default('recorded'),
});

export const externalNetworkObservationSchema = z.object({
  requestId: z.string().min(1),
  method: z.string().regex(/^[A-Z]+$/u),
  pathname: z.string().startsWith('/'),
  origin: z.string().url(),
  startedAtMs: z.number().int().nonnegative(),
  completedAtMs: z.number().int().nonnegative().nullable(),
  status: z.number().int().min(100).max(599).nullable(),
  failed: z.boolean(),
  matched: z.boolean(),
});

export const externalAssertionResultSchema = z.object({
  assertionResultId: z.string().min(1),
  assertionId: z.string().min(1),
  type: externalAssertionTypeSchema,
  status: z.enum(['passed', 'failed', 'not_evaluated', 'error']),
  description: z.string().min(1),
  expectedDescription: z.string().min(1),
  observedDescription: z.string().min(1),
  evaluatedAt: z.iso.datetime({ offset: true }),
});

export const outcomeEvaluationStatusSchema = z.enum([
  'passed',
  'failed',
  'could_not_verify',
]);

export const outcomeAggregateSchema = z.enum([
  'passed',
  'failed',
  'could_not_verify',
  'not_configured',
]);

export const externalRunLifecycleStatusSchema = z.enum([
  'created',
  'starting',
  'running',
  'evaluating',
  'completed',
  'runner_error',
]);

export const externalRunCanonicalVerdictSchema = z.enum([
  'passed',
  'failed',
  'could_not_verify',
  'runner_error',
]);

export const externalRunVerdictBasisSchema = z.enum([
  'approved_outcomes_and_technical_checks',
  'approved_outcomes_only',
  'technical_checks_only',
  'no_required_checks',
]);

export function deriveExternalRunVerdict(input: {
  status:
    | 'created'
    | 'starting'
    | 'running'
    | 'evaluating'
    | 'passed'
    | 'failed'
    | 'runner_error';
  lifecycleStatus?: z.infer<typeof externalRunLifecycleStatusSchema>;
  outcomeAggregate: z.infer<typeof outcomeAggregateSchema>;
  assertionAggregate: z.infer<typeof outcomeAggregateSchema>;
}): {
  canonicalVerdict: z.infer<typeof externalRunCanonicalVerdictSchema>;
  verdictBasis: z.infer<typeof externalRunVerdictBasisSchema>;
} {
  const hasApprovedOutcomes = input.outcomeAggregate !== 'not_configured';
  const hasTechnicalChecks = input.assertionAggregate !== 'not_configured';
  const verdictBasis = hasApprovedOutcomes
    ? hasTechnicalChecks
      ? 'approved_outcomes_and_technical_checks'
      : 'approved_outcomes_only'
    : hasTechnicalChecks
      ? 'technical_checks_only'
      : 'no_required_checks';

  if (
    input.status === 'runner_error' ||
    input.lifecycleStatus === 'runner_error'
  ) {
    return { canonicalVerdict: 'runner_error', verdictBasis };
  }

  const configuredAggregates = [
    input.outcomeAggregate,
    input.assertionAggregate,
  ].filter((aggregate) => aggregate !== 'not_configured');

  if (configuredAggregates.includes('failed')) {
    return { canonicalVerdict: 'failed', verdictBasis };
  }

  if (
    configuredAggregates.length === 0 ||
    configuredAggregates.includes('could_not_verify')
  ) {
    return { canonicalVerdict: 'could_not_verify', verdictBasis };
  }

  return { canonicalVerdict: 'passed', verdictBasis };
}

export const outcomeEvidenceReferencesSchema = z.object({
  triggerEventIds: z.array(z.string().min(1)).max(3),
  requestObservationIds: z.array(z.string().min(1)).max(100),
  screenshotArtifactIds: z.array(z.string().min(1)).max(3),
  runnerEventIds: z.array(z.string().min(1)).max(20),
});

export const externalOutcomeCheckResultSchema = z.object({
  outcomeCheckResultId: z.string().min(1),
  runId: z.string().min(1),
  outcomeCheckId: z.string().min(1),
  journeyId: z.string().min(1),
  criticalActionId: z.string().min(1),
  type: outcomeCheckTypeSchema,
  expected: z.json(),
  observed: z.json(),
  expectedCount: z.number().int().nonnegative().nullable(),
  observedCount: z.number().int().nonnegative().nullable(),
  status: outcomeEvaluationStatusSchema,
  reason: z.string().min(1).max(1_000).nullable(),
  evidenceReferences: outcomeEvidenceReferencesSchema,
  templateBinding: generatedValueBindingSchema.nullable(),
  unknowns: z.array(z.string().min(1).max(500)).max(10),
  evaluatedAt: z.iso.datetime({ offset: true }),
});

export const externalRunWarningSchema = z.object({
  code: z.enum(['screenshot_capture_failed', 'cleanup_hook_failed']),
  message: z.string().min(1),
  label: z
    .enum(['before-disruption', 'after-disruption', 'final-result'])
    .nullable(),
});

export const externalRunnerErrorSchema = z.object({
  code: z.enum([
    'configuration_failed',
    'authentication_state_missing',
    'authentication_required',
    'before_hook_failed',
    'browser_launch_failed',
    'journey_step_failed',
    'browser_cleanup_failed',
    'persistence_failed',
    'runner_failure',
  ]),
  message: z.string().min(1),
  failedStep: replayFailureSchema.nullable(),
  missingVariables: z.array(runtimeVariableNameSchema),
});

export const externalRunPrimaryStatusSchema = z.enum([
  'passed',
  'failed',
  'could_not_verify',
  'not_configured',
  'runner_error',
]);

export const externalRunPresentationConditionSchema = z.discriminatedUnion(
  'kind',
  [
    z.object({
      kind: z.literal('visible_match_count'),
      count: z.number().int().nonnegative().nullable(),
      description: z.string().min(1).max(500),
    }),
    z.object({
      kind: z.literal('approved_target_visibility'),
      visible: z.boolean().nullable(),
      visibleMatchCount: z.number().int().nonnegative().nullable(),
      description: z.string().min(1).max(500),
    }),
    z.object({
      kind: z.literal('pathname'),
      pathname: z.string().startsWith('/').max(2_000).nullable(),
      description: z.string().min(1).max(2_000),
    }),
    z.object({
      kind: z.literal('unavailable'),
      description: z.string().min(1).max(1_000),
    }),
  ],
);

export const externalRunPresentationObservationSchema = z.object({
  kind: z.enum(['action', 'request', 'browser']),
  text: z.string().min(1).max(500),
  evidenceReferences: outcomeEvidenceReferencesSchema,
});

export const externalRunProtectionSuggestionSchema = z.object({
  area: z.enum(['frontend', 'backend']),
  text: z.string().min(1).max(500),
});

export const externalRunCheckPresentationSchema = z.object({
  outcomeCheckId: z.string().min(1),
  type: outcomeCheckTypeSchema,
  approvedDescription: z.string().min(1).max(500),
  status: outcomeEvaluationStatusSchema,
  headline: z.string().min(1).max(500),
  expectedCondition: externalRunPresentationConditionSchema,
  observedCondition: externalRunPresentationConditionSchema,
  templateBinding: generatedValueBindingSchema.nullable(),
  reason: z.string().min(1).max(1_000).nullable(),
  evidenceReferences: outcomeEvidenceReferencesSchema,
});

export const externalRunResultPresentationSchema = z.object({
  primaryStatus: externalRunPrimaryStatusSchema,
  headline: z.string().min(1).max(500),
  outcomeSummary: z.string().min(1).max(1_000),
  approvedExpectedOutcomeDescription: z.string().min(1).max(500).nullable(),
  expectedCondition: externalRunPresentationConditionSchema.nullable(),
  observedCondition: externalRunPresentationConditionSchema.nullable(),
  templateBinding: generatedValueBindingSchema.nullable(),
  observations: z.array(externalRunPresentationObservationSchema).max(20),
  conclusion: z.string().min(1).max(1_000).nullable(),
  whyItMatters: z.string().min(1).max(1_000).nullable(),
  unknowns: z.array(z.string().min(1).max(500)).max(20),
  protectionSuggestions: z.array(externalRunProtectionSuggestionSchema).max(2),
  evidenceReferences: outcomeEvidenceReferencesSchema,
  technicalDetailsAvailable: z.object({
    assertions: z.boolean(),
    requests: z.boolean(),
    events: z.boolean(),
    screenshots: z.boolean(),
  }),
  checks: z.array(externalRunCheckPresentationSchema),
});

const externalRunDetailObjectSchema = z.object({
  runId: z.string().min(1),
  experimentVersionId: z.string().min(1),
  projectId: z.string().min(1),
  journeyId: z.string().min(1),
  status: z.enum([
    'created',
    'starting',
    'running',
    'evaluating',
    'passed',
    'failed',
    'runner_error',
  ]),
  lifecycleStatus: externalRunLifecycleStatusSchema.optional(),
  outcomeAggregate: outcomeAggregateSchema.default('not_configured'),
  assertionAggregate: outcomeAggregateSchema.default('not_configured'),
  startedAt: z.iso.datetime({ offset: true }),
  completedAt: z.iso.datetime({ offset: true }).nullable(),
  durationMs: z.number().int().nonnegative().nullable(),
  targetUrl: controlledTargetUrlSchema,
  projectName: z.string().min(1),
  journeyName: z.string().min(1),
  experimentName: z.string().min(1),
  experimentSnapshot: externalExperimentVersionSchema,
  resolvedValues: z.record(runtimeVariableNameSchema, z.string()),
  triggerAttempts: z.number().int().nonnegative(),
  networkObservations: z.array(externalNetworkObservationSchema),
  assertions: z.array(externalAssertionResultSchema),
  outcomeCheckSnapshot: outcomeCheckRunSnapshotSchema.default({
    criticalAction: null,
    checks: [],
  }),
  outcomeCheckResults: z.array(externalOutcomeCheckResultSchema).default([]),
  presentation: externalRunResultPresentationSchema,
  events: z.array(z.lazy(() => runEventEnvelopeSchema)),
  runnerError: externalRunnerErrorSchema.nullable(),
  warnings: z.array(externalRunWarningSchema),
  artifacts: z.array(z.lazy(() => runArtifactSchema)),
  createdAt: z.iso.datetime({ offset: true }),
});

export const externalRunDetailSchema = externalRunDetailObjectSchema.transform(
  (run) => {
    const lifecycleStatus =
      run.lifecycleStatus ??
      (run.status === 'runner_error'
        ? 'runner_error'
        : run.status === 'passed' || run.status === 'failed'
          ? 'completed'
          : run.status);

    return {
      ...run,
      lifecycleStatus,
      ...deriveExternalRunVerdict({
        status: run.status,
        lifecycleStatus,
        outcomeAggregate: run.outcomeAggregate,
        assertionAggregate: run.assertionAggregate,
      }),
    };
  },
);

export const externalRunSummarySchema = z
  .object({
    runId: z.string().min(1),
    experimentVersionId: z.string().min(1),
    projectId: z.string().min(1),
    journeyId: z.string().min(1),
    status: externalRunDetailObjectSchema.shape.status,
    lifecycleStatus: externalRunLifecycleStatusSchema,
    outcomeAggregate: outcomeAggregateSchema,
    assertionAggregate: outcomeAggregateSchema,
    startedAt: z.iso.datetime({ offset: true }),
    completedAt: z.iso.datetime({ offset: true }).nullable(),
    durationMs: z.number().int().nonnegative().nullable(),
    projectName: z.string().min(1),
    journeyName: z.string().min(1),
    experimentName: z.string().min(1),
    triggerAttempts: z.number().int().nonnegative(),
    matchedRequestCount: z.number().int().nonnegative(),
    passedAssertionCount: z.number().int().nonnegative(),
    assertionCount: z.number().int().nonnegative(),
    screenshotCount: z.number().int().nonnegative(),
    createdAt: z.iso.datetime({ offset: true }),
  })
  .transform((run) => ({
    ...run,
    ...deriveExternalRunVerdict(run),
  }));

export const externalRunListQuerySchema = z.object({
  projectId: z.string().min(1).optional(),
  journeyId: z.string().min(1).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(20),
  offset: z.coerce.number().int().nonnegative().default(0),
});

export const externalRunListSchema = z.object({
  items: z.array(externalRunSummarySchema),
  limit: z.number().int().positive(),
  offset: z.number().int().nonnegative(),
});

export const externalTestSummarySchema = z.object({
  testId: z.string().min(1),
  projectId: z.string().min(1),
  journeyId: z.string().min(1),
  name: z.string().min(1),
  experimentType: z.literal('impatient_user'),
  latestVersion: externalExperimentVersionSchema,
  versionCount: z.number().int().positive(),
  latestRun: externalRunSummarySchema.nullable(),
  runCount: z.number().int().nonnegative(),
});

export const externalTestSummaryListSchema = z.object({
  items: z.array(externalTestSummarySchema),
});

export const externalTestDetailSchema = externalTestSummarySchema.extend({
  versions: z.array(externalExperimentVersionSchema).min(1),
  runs: z.array(externalRunSummarySchema).max(100),
});

export const externalRunComparisonRequestSchema = z
  .object({
    beforeRunId: z.string().min(1).max(200),
    afterRunId: z.string().min(1).max(200),
  })
  .strict();

export const externalRunComparisonCompatibilitySchema = z.enum([
  'compatible',
  'incompatible',
]);

export const externalRunComparisonStatusSchema = z.enum([
  'protection_verified',
  'still_failing',
  'regressed',
  'no_material_change',
  'could_not_verify',
  'incompatible',
]);

export const externalRunComparisonDifferenceSchema = z.object({
  code: z.enum([
    'same_run',
    'different_project',
    'different_journey_version',
    'different_critical_action',
    'different_failure_recipe',
    'different_trigger_count',
    'different_trigger_interval',
    'different_continuation_behavior',
    'different_experiment_configuration',
    'different_outcome_checks',
    'different_generated_template_strategy',
    'different_request_matcher',
    'different_assertions',
    'reverse_chronology',
    'run_not_completed',
    'runner_error',
    'outcome_checks_not_configured',
    'outcome_results_missing',
  ]),
  message: z.string().min(1).max(500),
});

export const externalRunComparisonMatchedPropertySchema = z.object({
  key: z.enum([
    'project',
    'journey_version',
    'critical_action',
    'failure_recipe',
    'outcome_checks',
    'generated_template_strategy',
    'request_matcher',
    'technical_assertions',
  ]),
  label: z.string().min(1).max(120),
  value: z.string().min(1).max(500),
});

export const externalRunComparisonRunReferenceSchema = z.object({
  runId: z.string().min(1),
  experimentVersionId: z.string().min(1),
  label: z.enum(['Before fix', 'After fix']),
  createdAt: z.iso.datetime({ offset: true }),
  completedAt: z.iso.datetime({ offset: true }),
  outcomeAggregate: outcomeAggregateSchema,
  assertionAggregate: outcomeAggregateSchema,
});

export const externalRunComparisonCriticalActionSchema = z.object({
  id: z.string().min(1),
  stepId: z.string().min(1),
  label: z.string().min(1).max(160),
  recordedStepName: z.string().min(1).max(160),
});

export const externalRunComparisonFailureRecipeSchema = z.object({
  type: z.literal('impatient_user'),
  targetStepId: z.string().min(1),
  targetStepName: z.string().min(1).max(160),
  triggerCount: z.union([z.literal(2), z.literal(3)]),
  intervalMs: z.union([z.literal(0), z.literal(100), z.literal(300)]),
  continueAfterTarget: z.boolean(),
});

export const externalRunComparisonCheckSchema = z.object({
  identity: z.string().min(1).max(128),
  outcomeCheckId: z.string().min(1),
  type: outcomeCheckTypeSchema,
  approvedDescription: z.string().min(1).max(500),
  expectedCondition: externalRunPresentationConditionSchema,
  beforeStatus: outcomeEvaluationStatusSchema,
  afterStatus: outcomeEvaluationStatusSchema,
  beforeObservedCondition: externalRunPresentationConditionSchema,
  afterObservedCondition: externalRunPresentationConditionSchema,
  templateBinding: generatedValueBindingSchema.nullable(),
  beforeEvidenceReferences: outcomeEvidenceReferencesSchema,
  afterEvidenceReferences: outcomeEvidenceReferencesSchema,
});

export const externalRunComparisonEvidenceValueSchema = z.union([
  z.string().min(1).max(500),
  z.number().int().nonnegative(),
]);

export const externalRunComparisonEvidenceRowSchema = z.object({
  key: z.enum([
    'critical_action_triggers',
    'successful_matching_requests',
    'visible_matching_results',
    'expected_visible_results',
    'outcome',
  ]),
  label: z.string().min(1).max(120),
  before: externalRunComparisonEvidenceValueSchema,
  after: externalRunComparisonEvidenceValueSchema,
});

export const externalRunComparisonScreenshotReferenceSchema = z.object({
  artifactId: z.string().min(1),
  runId: z.string().min(1),
  label: z.enum(['before-disruption', 'after-disruption', 'final-result']),
  createdAt: z.iso.datetime({ offset: true }),
});

export const externalRunComparisonScreenshotPairSchema = z.object({
  label: z.enum(['before-disruption', 'after-disruption', 'final-result']),
  before: externalRunComparisonScreenshotReferenceSchema.nullable(),
  after: externalRunComparisonScreenshotReferenceSchema.nullable(),
});

export const externalRunComparisonPresentationSchema = z.object({
  primaryStatus: externalRunComparisonStatusSchema.exclude(['incompatible']),
  headline: z.string().min(1).max(500),
  summary: z.string().min(1).max(1_000),
  beforeRun: externalRunComparisonRunReferenceSchema,
  afterRun: externalRunComparisonRunReferenceSchema,
  criticalAction: externalRunComparisonCriticalActionSchema,
  failureRecipe: externalRunComparisonFailureRecipeSchema,
  checks: z.array(externalRunComparisonCheckSchema).min(1).max(20),
  evidenceTable: z.array(externalRunComparisonEvidenceRowSchema).max(5),
  successfulRequestCounts: z
    .object({
      before: z.number().int().nonnegative(),
      after: z.number().int().nonnegative(),
    })
    .nullable(),
  technicalAssertionAggregates: z.object({
    before: outcomeAggregateSchema,
    after: outcomeAggregateSchema,
  }),
  screenshots: z.array(externalRunComparisonScreenshotPairSchema).length(3),
  configurationIdentity: z.object({
    algorithm: z.literal('sha256'),
    fingerprint: z.string().regex(/^[a-f0-9]{64}$/u),
  }),
  observed: z.array(z.string().min(1).max(500)).max(20),
  conclusion: z.string().min(1).max(1_000).nullable(),
  unknowns: z.array(z.string().min(1).max(500)).min(1).max(20),
});

export const externalRunComparisonResponseSchema = z.object({
  compatibility: externalRunComparisonCompatibilitySchema,
  primaryStatus: externalRunComparisonStatusSchema,
  differences: z.array(externalRunComparisonDifferenceSchema).max(20),
  matchedProperties: z
    .array(externalRunComparisonMatchedPropertySchema)
    .max(20),
  presentation: externalRunComparisonPresentationSchema.nullable(),
});

export const missingRuntimeVariablesErrorSchema = z.object({
  error: z.object({
    code: z.literal('MISSING_RUNTIME_VARIABLES'),
    message: z.string().min(1),
    missingVariables: z.array(runtimeVariableNameSchema).min(1),
  }),
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
export type ProjectEnvironment = z.infer<typeof projectEnvironmentSchema>;
export type Project = z.infer<typeof projectSchema>;
export type CreateProjectRequest = z.infer<typeof createProjectRequestSchema>;
export type ProjectList = z.infer<typeof projectListSchema>;
export type DeleteProjectResponse = z.infer<typeof deleteProjectResponseSchema>;
export type DeleteResourceResponse = z.infer<
  typeof deleteResourceResponseSchema
>;
export type RecordingSessionStatus = z.infer<
  typeof recordingSessionStatusSchema
>;
export type JourneyCaptureFormat = z.infer<typeof journeyCaptureFormatSchema>;
export type TraceCaptureStatus = z.infer<typeof traceCaptureStatusSchema>;
export type ReplayMode = z.infer<typeof replayModeSchema>;
export type ReplayPacing = z.infer<typeof replayPacingSchema>;
export type ReplayLocator = z.infer<typeof replayLocatorSchema>;
export type TargetFingerprint = z.infer<typeof targetFingerprintSchema>;
export type RecordedTargetCandidate = z.infer<
  typeof recordedTargetCandidateSchema
>;
export type RecordedTargetGeometry = z.infer<
  typeof recordedTargetGeometrySchema
>;
export type RecordedPostcondition = z.infer<typeof recordedPostconditionSchema>;
export type RecordedInteraction = z.infer<typeof recordedInteractionSchema>;
export type RecordedBrowserEnvironment = z.infer<
  typeof recordedBrowserEnvironmentSchema
>;
export type RecordedVideoArtifact = z.infer<typeof recordedVideoArtifactSchema>;
export type HybridTraceManifest = z.infer<typeof hybridTraceManifestSchema>;
export type TraceSummary = z.infer<typeof traceSummarySchema>;
export type JourneyTraceReference = z.infer<typeof journeyTraceReferenceSchema>;
export type RecordedValue = z.infer<typeof recordedValueSchema>;
export type RecordedJourneyStep = z.infer<typeof recordedJourneyStepSchema>;
export type RecordingWarningCode = z.infer<typeof recordingWarningCodeSchema>;
export type RecordingWarning = z.infer<typeof recordingWarningSchema>;
export type RecordedRequestEvidence = z.infer<
  typeof recordedRequestEvidenceSchema
>;
export type RecordingSession = z.infer<typeof recordingSessionSchema>;
export type SaveRecordedJourneyRequest = z.infer<
  typeof saveRecordedJourneyRequestSchema
>;
export type JourneyRecordingMetadata = z.infer<
  typeof journeyRecordingMetadataSchema
>;
export type PersistedJourney = z.infer<typeof persistedJourneySchema>;
export type JourneyList = z.infer<typeof journeyListSchema>;
export type CriticalAction = z.infer<typeof criticalActionSchema>;
export type ApproveCriticalActionRequest = z.infer<
  typeof approveCriticalActionRequestSchema
>;
export type CriticalActionResponse = z.infer<
  typeof criticalActionResponseSchema
>;
export type OutcomeCheckType = z.infer<typeof outcomeCheckTypeSchema>;
export type GeneratedValueExpression = z.infer<
  typeof generatedValueExpressionSchema
>;
export type GeneratedValueBinding = z.infer<typeof generatedValueBindingSchema>;
export type GeneratedBaselineInput = z.infer<
  typeof generatedBaselineInputSchema
>;
export type OutcomeElementFingerprint = z.infer<
  typeof outcomeElementFingerprintSchema
>;
export type OutcomeCaptureWarningCode = z.infer<
  typeof outcomeCaptureWarningCodeSchema
>;
export type OutcomeCaptureWarning = z.infer<typeof outcomeCaptureWarningSchema>;
export type CapturedOutcomeTarget = z.infer<typeof capturedOutcomeTargetSchema>;
export type OutcomeCaptureStatus = z.infer<typeof outcomeCaptureStatusSchema>;
export type OutcomeCaptureSession = z.infer<typeof outcomeCaptureSessionSchema>;
export type OutcomeCaptureResponse = z.infer<
  typeof outcomeCaptureResponseSchema
>;
export type StartOutcomeCaptureRequest = z.infer<
  typeof startOutcomeCaptureRequestSchema
>;
export type ApproveOutcomeCheckRequest = z.infer<
  typeof approveOutcomeCheckRequestSchema
>;
export type OutcomeCheck = z.infer<typeof outcomeCheckSchema>;
export type OutcomeCheckList = z.infer<typeof outcomeCheckListSchema>;
export type OutcomeCheckRunSnapshot = z.infer<
  typeof outcomeCheckRunSnapshotSchema
>;
export type OutcomeEvaluationStatus = z.infer<
  typeof outcomeEvaluationStatusSchema
>;
export type OutcomeAggregate = z.infer<typeof outcomeAggregateSchema>;
export type ExternalRunLifecycleStatus = z.infer<
  typeof externalRunLifecycleStatusSchema
>;
export type ExternalRunCanonicalVerdict = z.infer<
  typeof externalRunCanonicalVerdictSchema
>;
export type ExternalRunVerdictBasis = z.infer<
  typeof externalRunVerdictBasisSchema
>;
export type OutcomeEvidenceReferences = z.infer<
  typeof outcomeEvidenceReferencesSchema
>;
export type ExternalOutcomeCheckResult = z.infer<
  typeof externalOutcomeCheckResultSchema
>;
export type ReplayFailure = z.infer<typeof replayFailureSchema>;
export type ReplayResult = z.infer<typeof replayResultSchema>;
export type ReplayInteractionOutcome = z.infer<
  typeof replayInteractionOutcomeSchema
>;
export type RuntimeVariableName = z.infer<typeof runtimeVariableNameSchema>;
export type RuntimeVariableDeclarationInput = z.infer<
  typeof runtimeVariableDeclarationInputSchema
>;
export type RuntimeVariableDeclaration = z.infer<
  typeof runtimeVariableDeclarationSchema
>;
export type HookMethod = z.infer<typeof hookMethodSchema>;
export type HttpHook = z.infer<typeof httpHookSchema>;
export type ProjectExecutionSettingsInput = z.infer<
  typeof projectExecutionSettingsInputSchema
>;
export type ProductionReplayAcknowledgementInput = z.infer<
  typeof productionReplayAcknowledgementInputSchema
>;
export type ProjectAuthStatus = z.infer<typeof projectAuthStatusSchema>;
export type ProjectExecutionSettings = z.infer<
  typeof projectExecutionSettingsSchema
>;
export type AuthCaptureStatus = z.infer<typeof authCaptureStatusSchema>;
export type AuthCaptureSession = z.infer<typeof authCaptureSessionSchema>;
export type AuthValidationResult = z.infer<typeof authValidationResultSchema>;
export type EphemeralRuntimeValues = z.infer<
  typeof ephemeralRuntimeValuesSchema
>;
export type NetworkMatcher = z.infer<typeof networkMatcherSchema>;
export type DiscoveredRequest = z.infer<typeof discoveredRequestSchema>;
export type RequestCandidateClassification = z.infer<
  typeof requestCandidateClassificationSchema
>;
export type RequestRecommendationConfidence = z.infer<
  typeof requestRecommendationConfidenceSchema
>;
export type RequestRecommendationReasonCode = z.infer<
  typeof requestRecommendationReasonCodeSchema
>;
export type RequestRecommendationReason = z.infer<
  typeof requestRecommendationReasonSchema
>;
export type RankedRequestCandidate = z.infer<
  typeof rankedRequestCandidateSchema
>;
export type NetworkEvidenceSource = z.infer<typeof networkEvidenceSourceSchema>;
export type NetworkEvidenceCandidate = z.infer<
  typeof networkEvidenceCandidateSchema
>;
export type NetworkEvidenceCandidateList = z.infer<
  typeof networkEvidenceCandidateListSchema
>;
export type NetworkEvidenceProvenance = z.infer<
  typeof networkEvidenceProvenanceSchema
>;
export type RequestDiscoveryOutcome = z.infer<
  typeof requestDiscoveryOutcomeSchema
>;
export type RequestDiscoveryRecommendation = z.infer<
  typeof requestDiscoveryRecommendationSchema
>;
export type RequestDiscoveryRequest = z.infer<
  typeof requestDiscoveryRequestSchema
>;
export type RequestDiscoveryResult = z.infer<
  typeof requestDiscoveryResultSchema
>;
export type AssertionRecommendationRecipeType = z.infer<
  typeof assertionRecommendationRecipeTypeSchema
>;
export type AssertionRecommendationRecipe = z.infer<
  typeof assertionRecommendationRecipeSchema
>;
export type NormalActionElementObservation = z.infer<
  typeof normalActionElementObservationSchema
>;
export type NormalActionObservation = z.infer<
  typeof normalActionObservationSchema
>;
export type AssertionRecommendationCategory = z.infer<
  typeof assertionRecommendationCategorySchema
>;
export type AssertionRecommendationConfidence = z.infer<
  typeof assertionRecommendationConfidenceSchema
>;
export type AssertionRecommendation = z.infer<
  typeof assertionRecommendationSchema
>;
export type AssertionRecommendationSet = z.infer<
  typeof assertionRecommendationSetSchema
>;
export type AssertionSelectionOrigin = z.infer<
  typeof assertionSelectionOriginSchema
>;
export type AssertionSelectionAction = z.infer<
  typeof assertionSelectionActionSchema
>;
export type AssertionSelectionProvenanceEntry = z.infer<
  typeof assertionSelectionProvenanceEntrySchema
>;
export type RequestSelectionMode = z.infer<typeof requestSelectionModeSchema>;
export type RequestSelectionProvenance = z.infer<
  typeof requestSelectionProvenanceSchema
>;
export type ExternalAssertionType = z.infer<typeof externalAssertionTypeSchema>;
export type ExternalAssertion = z.infer<typeof externalAssertionSchema>;
export type CreateExternalExperimentRequest = z.infer<
  typeof createExternalExperimentRequestSchema
>;
export type CreateExternalExperimentSuiteRequest = z.infer<
  typeof createExternalExperimentSuiteRequestSchema
>;
export type CreateExternalExperimentVersionRequest = z.infer<
  typeof createExternalExperimentVersionRequestSchema
>;
export type ExternalExperimentVersion = z.infer<
  typeof externalExperimentVersionSchema
>;
export type RunExternalExperimentRequest = z.infer<
  typeof runExternalExperimentRequestSchema
>;
export type ExternalNetworkObservation = z.infer<
  typeof externalNetworkObservationSchema
>;
export type ExternalAssertionResult = z.infer<
  typeof externalAssertionResultSchema
>;
export type ExternalRunWarning = z.infer<typeof externalRunWarningSchema>;
export type ExternalRunnerError = z.infer<typeof externalRunnerErrorSchema>;
export type ExternalRunPrimaryStatus = z.infer<
  typeof externalRunPrimaryStatusSchema
>;
export type ExternalRunPresentationCondition = z.infer<
  typeof externalRunPresentationConditionSchema
>;
export type ExternalRunPresentationObservation = z.infer<
  typeof externalRunPresentationObservationSchema
>;
export type ExternalRunProtectionSuggestion = z.infer<
  typeof externalRunProtectionSuggestionSchema
>;
export type ExternalRunCheckPresentation = z.infer<
  typeof externalRunCheckPresentationSchema
>;
export type ExternalRunResultPresentation = z.infer<
  typeof externalRunResultPresentationSchema
>;
export type ExternalRunDetail = z.infer<typeof externalRunDetailSchema>;
export type ExternalRunSummary = z.infer<typeof externalRunSummarySchema>;
export type ExternalRunListQuery = z.infer<typeof externalRunListQuerySchema>;
export type ExternalRunList = z.infer<typeof externalRunListSchema>;
export type ExternalTestSummary = z.infer<typeof externalTestSummarySchema>;
export type ExternalTestSummaryList = z.infer<
  typeof externalTestSummaryListSchema
>;
export type ExternalTestDetail = z.infer<typeof externalTestDetailSchema>;
export type ExternalRunComparisonRequest = z.infer<
  typeof externalRunComparisonRequestSchema
>;
export type ExternalRunComparisonCompatibility = z.infer<
  typeof externalRunComparisonCompatibilitySchema
>;
export type ExternalRunComparisonStatus = z.infer<
  typeof externalRunComparisonStatusSchema
>;
export type ExternalRunComparisonDifference = z.infer<
  typeof externalRunComparisonDifferenceSchema
>;
export type ExternalRunComparisonMatchedProperty = z.infer<
  typeof externalRunComparisonMatchedPropertySchema
>;
export type ExternalRunComparisonPresentation = z.infer<
  typeof externalRunComparisonPresentationSchema
>;
export type ExternalRunComparisonResponse = z.infer<
  typeof externalRunComparisonResponseSchema
>;
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
