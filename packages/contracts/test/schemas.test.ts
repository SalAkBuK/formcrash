import { describe, expect, it } from 'vitest';

import {
  assertionResultStatusSchema,
  controlledTargetUrlSchema,
  createExternalExperimentRequestSchema,
  createProjectRequestSchema,
  experimentTypeSchema,
  journeyActionTypeSchema,
  requestDiscoveryResultSchema,
  runArtifactSchema,
  runEventEnvelopeSchema,
  runStatusSchema,
  startSampleRunAcceptedSchema,
  startSampleRunRequestSchema,
} from '../src/index.js';

describe('foundational contracts', () => {
  it('validates asynchronous sample-run start contracts', () => {
    expect(startSampleRunRequestSchema.parse({ mode: 'vulnerable' })).toEqual({
      mode: 'vulnerable',
    });
    expect(
      startSampleRunAcceptedSchema.parse({
        runId: 'run-1',
        status: 'created',
        detailUrl: '/api/runs/run-1',
        eventsUrl: '/api/runs/run-1/events',
      }),
    ).toMatchObject({ runId: 'run-1', status: 'created' });
    expect(
      startSampleRunRequestSchema.safeParse({ mode: 'unsafe' }).success,
    ).toBe(false);
  });
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

  it.each([
    'http://localhost:4300',
    'http://127.0.0.1:4300/form',
    'https://controlled.example.test/journey',
  ])('accepts controlled HTTP target URL %s', (targetUrl) => {
    expect(
      createProjectRequestSchema.safeParse({ name: 'Target', targetUrl })
        .success,
    ).toBe(true);
  });

  it.each([
    'file:///tmp/form.html',
    'ftp://example.test/form',
    'javascript:alert(1)',
    'https://user:secret@example.test',
  ])('rejects unsupported target URL %s', (targetUrl) => {
    expect(controlledTargetUrlSchema.safeParse(targetUrl).success).toBe(false);
  });

  it('requires a matcher when an experiment uses network assertions', () => {
    const result = createExternalExperimentRequestSchema.safeParse({
      name: 'Unmatched network assertion',
      targetStepId: 'submit',
      triggerCount: 2,
      intervalMs: 0,
      networkMatcher: null,
      assertions: [
        {
          id: 'max-one',
          type: 'network_request_max',
          maximum: 1,
          description: 'At most one matching request.',
        },
      ],
      continueAfterTarget: false,
    });

    expect(result.success).toBe(false);
  });

  it('accepts guided snapshot automation options', () => {
    const result = createExternalExperimentRequestSchema.safeParse({
      name: 'Guided submit',
      targetStepId: 'submit',
      triggerCount: 2,
      intervalMs: 0,
      networkMatcher: {
        method: 'POST',
        pathname: '/api/profile',
        host: 'example.test',
      },
      assertions: [
        {
          id: 'one-request',
          type: 'network_request_exact',
          expected: 1,
          description: 'Only one matching request is sent.',
        },
      ],
      continueAfterTarget: false,
      guided: true,
      normalizeJourney: true,
      stepValueOverrides: {
        'fill-name': '{{unique.name}}',
      },
    });

    expect(result.success).toBe(true);
  });

  it('accepts ranked server-owned discovery evidence', () => {
    const result = requestDiscoveryResultSchema.parse({
      discoveryId: '11111111-2222-4333-8444-555555555555',
      discoveredAt: '2026-07-16T00:00:00.000Z',
      journeyId: 'journey-1',
      targetStepId: 'submit',
      candidates: [
        {
          candidateId: 'request-0123456789abcdef01234567',
          rank: 1,
          score: 105,
          classification: 'likely_business_mutation',
          confidence: 'high',
          recommended: true,
          reasons: [
            {
              code: 'mutation_method',
              label: 'POST changes server state.',
              scoreImpact: 50,
            },
          ],
          method: 'POST',
          pathname: '/api/profile',
          origin: 'https://example.test',
          status: 201,
          failed: false,
          relativeTimestampMs: 4,
          occurrences: 1,
        },
      ],
      recommendation: {
        outcome: 'recommended',
        recommendedCandidateId: 'request-0123456789abcdef01234567',
        explanation: 'One high-confidence business mutation was identified.',
      },
    });

    expect(result.candidates[0]?.rank).toBe(1);
    expect(result.recommendation.outcome).toBe('recommended');
  });

  it('defaults legacy experiment requests to no selection provenance', () => {
    const result = createExternalExperimentRequestSchema.parse({
      name: 'Legacy experiment',
      targetStepId: 'submit',
      triggerCount: 2,
      intervalMs: 0,
      networkMatcher: null,
      assertions: [
        {
          id: 'visible',
          type: 'text_appeared',
          text: 'Saved',
          description: 'Saved text appears.',
        },
      ],
      continueAfterTarget: false,
    });

    expect(result.requestSelectionProvenance).toBeNull();
  });

  it('rejects selection provenance that disagrees with the saved matcher', () => {
    const result = createExternalExperimentRequestSchema.safeParse({
      name: 'Mismatched provenance',
      targetStepId: 'submit',
      triggerCount: 2,
      intervalMs: 0,
      networkMatcher: {
        method: 'POST',
        pathname: '/api/profile',
        host: 'example.test',
      },
      requestSelectionProvenance: {
        selectionMode: 'manual_override',
        discoveryId: '11111111-2222-4333-8444-555555555555',
        discoveredAt: '2026-07-16T00:00:00.000Z',
        discoveryOutcome: 'review',
        selectedCandidateId: 'request-0123456789abcdef01234567',
        selectedCandidateScore: 50,
        selectedCandidateConfidence: 'review',
        recommendationReasons: [],
        recommendedMatcher: null,
        selectedMatcher: {
          method: 'POST',
          pathname: '/api/other',
          host: 'example.test',
        },
        userOverrodeRecommendation: true,
      },
      assertions: [
        {
          id: 'one-request',
          type: 'network_request_exact',
          expected: 1,
          description: 'One request occurs.',
        },
      ],
      continueAfterTarget: false,
    });

    expect(result.success).toBe(false);
  });
});
