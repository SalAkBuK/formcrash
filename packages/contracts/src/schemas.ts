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
  relativeTimestampMs: z.number().int().nonnegative(),
  recordedAt: z.iso.datetime({ offset: true }),
  schemaVersion: z.literal(1),
  payload: z.json(),
});

export type RunStatus = z.infer<typeof runStatusSchema>;
export type ExperimentType = z.infer<typeof experimentTypeSchema>;
export type JourneyActionType = z.infer<typeof journeyActionTypeSchema>;
export type AssertionResultStatus = z.infer<typeof assertionResultStatusSchema>;
export type RunEventEnvelope = z.infer<typeof runEventEnvelopeSchema>;
