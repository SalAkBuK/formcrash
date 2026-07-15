import { describe, expect, it } from 'vitest';

import {
  assertionResultStatusSchema,
  experimentTypeSchema,
  journeyActionTypeSchema,
  runArtifactSchema,
  runEventEnvelopeSchema,
  runStatusSchema,
} from '../src/index.js';

describe('foundational contracts', () => {
  it.each([
    [runStatusSchema, 'running'],
    [experimentTypeSchema, 'impatient_user'],
    [journeyActionTypeSchema, 'submit'],
    [assertionResultStatusSchema, 'not_evaluated'],
  ])('accepts a valid enum value', (schema, value) => {
    expect(schema.safeParse(value).success).toBe(true);
  });

  it.each([
    runStatusSchema,
    experimentTypeSchema,
    journeyActionTypeSchema,
    assertionResultStatusSchema,
  ])('rejects an invalid enum value', (schema) => {
    expect(schema.safeParse('not-a-real-value').success).toBe(false);
  });

  it('accepts a valid run event envelope', () => {
    const result = runEventEnvelopeSchema.safeParse({
      eventId: 'event-1',
      runId: 'run-1',
      eventType: 'run.created',
      sequence: 1,
      relativeTimestampMs: 0,
      recordedAt: '2026-07-15T10:00:00.000Z',
      schemaVersion: 1,
      payload: { source: 'dashboard' },
    });

    expect(result.success).toBe(true);
  });

  it('rejects malformed run event envelopes', () => {
    const result = runEventEnvelopeSchema.safeParse({
      eventId: '',
      runId: 'run-1',
      eventType: 'run.created',
      sequence: 0,
      relativeTimestampMs: -1,
      recordedAt: 'not-a-timestamp',
      schemaVersion: 2,
      payload: undefined,
    });

    expect(result.success).toBe(false);
  });

  it('accepts server-owned relative artifact metadata', () => {
    expect(
      runArtifactSchema.safeParse({
        artifactId: 'artifact-1',
        runId: 'run-1',
        artifactType: 'screenshot',
        label: 'before-disruption',
        relativePath: 'screenshots/run-1/001-before-disruption.png',
        mimeType: 'image/png',
        sizeBytes: 100,
        checksumSha256: '0'.repeat(64),
        captureSequence: 1,
        createdAt: '2026-07-15T10:00:00.000Z',
        metadata: { fullPage: true },
      }).success,
    ).toBe(true);
  });

  it.each(['C:\\outside.png', '/outside.png', '../outside.png'])(
    'rejects unsafe artifact path %s',
    (relativePath) => {
      expect(
        runArtifactSchema.safeParse({
          artifactId: 'artifact-1',
          runId: 'run-1',
          artifactType: 'screenshot',
          label: 'before-disruption',
          relativePath,
          mimeType: 'image/png',
          sizeBytes: 100,
          checksumSha256: '0'.repeat(64),
          captureSequence: 1,
          createdAt: '2026-07-15T10:00:00.000Z',
          metadata: {},
        }).success,
      ).toBe(false);
    },
  );
});
