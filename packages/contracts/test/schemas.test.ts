import { describe, expect, it } from 'vitest';

import {
  approveOutcomeCheckRequestSchema,
  assertionResultStatusSchema,
  capturedOutcomeTargetSchema,
  controlledTargetUrlSchema,
  createExternalExperimentRequestSchema,
  createProjectRequestSchema,
  experimentTypeSchema,
  externalRunResultPresentationSchema,
  journeyActionTypeSchema,
  outcomeCheckSchema,
  outcomeCaptureResponseSchema,
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
      normalAction: {
        targetControlLocator: {
          strategy: 'data-testid',
          value: 'save-profile',
        },
        targetWasDisabledDuringPending: true,
        finalPathname: '/profiles',
        elements: [],
      },
      assertionRecommendationSets: [
        {
          recipeType: 'duplicate_action',
          selectedRequestCandidateId: 'request-0123456789abcdef01234567',
          recommendations: [
            {
              recommendationId: 'assertion-rec-0123456789abcdef01234567',
              assertion: {
                id: 'assertion-draft-0123456789abcdef01234567',
                type: 'network_request_max',
                maximum: 1,
                description: 'At most one request.',
              },
              category: 'request_count',
              confidence: 'high',
              defaultEnabled: true,
              reasonCode: 'repeated_action_request_limit',
              explanation: 'The normal action sent one request.',
              evidence: {
                evidenceIds: ['request-0123456789abcdef01234567'],
                source: 'request_discovery',
              },
            },
          ],
          limitations: ['No database state was inspected.'],
        },
      ],
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
    expect(result.assertionSelectionProvenance).toBeUndefined();
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

  it('validates all three locked Outcome Check contracts', () => {
    const target = capturedOutcomeTargetSchema.parse({
      locator: { strategy: 'data-formcrash', value: 'tenant-row' },
      fingerprint: {
        tagName: 'li',
        dataFormcrash: 'tenant-row',
        dataTestId: null,
        id: null,
        role: 'listitem',
        accessibleName: 'Tenant {{unique.email}}',
        name: null,
        cssPath: 'li',
      },
      preview: 'Tenant {{unique.email}}',
      reliability: 'high',
      warnings: [],
      generatedBindings: [
        {
          expression: 'unique.email',
          template: '{{unique.email}}',
          label: 'Generated unique email',
        },
      ],
    });
    const common = {
      journeyId: 'journey-1',
      criticalActionId: 'critical-action-1',
      createdAt: '2026-07-17T00:00:00.000Z',
    };

    expect(
      outcomeCheckSchema.parse({
        ...common,
        id: 'visible-1',
        type: 'visible_element_exists',
        description: 'A tenant row appears.',
        target,
      }).type,
    ).toBe('visible_element_exists');
    expect(
      outcomeCheckSchema.parse({
        ...common,
        id: 'matching-1',
        type: 'matching_item_appears_exactly_once',
        description: 'Exactly one tenant row appears.',
        target,
        binding: target.generatedBindings[0],
      }).type,
    ).toBe('matching_item_appears_exactly_once');
    expect(
      outcomeCheckSchema.parse({
        ...common,
        id: 'path-1',
        type: 'final_pathname_matches',
        description: 'The journey ends on tenants.',
        expectedPathname: '/tenants',
      }).type,
    ).toBe('final_pathname_matches');
  });

  it('exposes server-owned generated input provenance on capture retrieval', () => {
    const response = outcomeCaptureResponseSchema.parse({
      capture: {
        id: 'capture-1',
        journeyId: 'journey-version-1',
        criticalActionId: 'critical-action-1',
        generatedInputs: [
          {
            stepId: 'fill-email',
            stepName: 'Fill tenant email',
            expression: 'unique.email',
            template: '{{unique.email}}',
            label: 'Generated unique email',
          },
        ],
        status: 'awaiting_selection',
        selectedTarget: null,
        selectionWarnings: [],
        finalPathname: '/tenants',
        errorMessage: null,
        startedAt: '2026-07-17T00:00:00.000Z',
        expiresAt: '2026-07-17T00:10:00.000Z',
        completedAt: null,
      },
    });

    expect(response.capture?.generatedInputs[0]?.template).toBe(
      '{{unique.email}}',
    );
  });

  it('rejects an unsupported Outcome Check type and malformed binding', () => {
    expect(
      approveOutcomeCheckRequestSchema.safeParse({
        type: 'database_record_exists',
        description: 'A tenant exists.',
      }).success,
    ).toBe(false);
    expect(
      approveOutcomeCheckRequestSchema.safeParse({
        type: 'matching_item_appears_exactly_once',
        description: 'Exactly one tenant appears.',
        bindingExpression: 'var.SECRET',
      }).success,
    ).toBe(false);
  });

  it('validates the bounded server-owned external result presentation', () => {
    const references = {
      triggerEventIds: [],
      requestObservationIds: [],
      screenshotArtifactIds: [],
      runnerEventIds: [],
    };
    const presentation = externalRunResultPresentationSchema.parse({
      primaryStatus: 'failed',
      headline: 'Failed: The expected result appeared twice instead of once.',
      outcomeSummary: '1 of 1 approved Outcome Check failed.',
      approvedExpectedOutcomeDescription:
        'Exactly one generated profile should appear.',
      expectedCondition: {
        kind: 'visible_match_count',
        count: 1,
        description: 'Exactly 1 visible matching result.',
      },
      observedCondition: {
        kind: 'visible_match_count',
        count: 2,
        description: '2 visible matching results.',
      },
      templateBinding: {
        expression: 'unique.email',
        template: '{{unique.email}}',
        label: 'Unique email',
      },
      observations: [
        {
          kind: 'browser',
          text: 'Two visible results matched the approved generated identity.',
          evidenceReferences: references,
        },
      ],
      conclusion: 'The approved exact-once browser-visible outcome failed.',
      whyItMatters: 'Repeated submission can leave duplicate visible results.',
      unknowns: [
        'FormCrash did not inspect the application database or hidden backend state.',
      ],
      protectionSuggestions: [],
      evidenceReferences: references,
      technicalDetailsAvailable: {
        assertions: true,
        requests: true,
        events: true,
        screenshots: true,
      },
      checks: [],
    });

    expect(presentation.primaryStatus).toBe('failed');
    expect(
      externalRunResultPresentationSchema.safeParse({
        ...presentation,
        headline: 'x'.repeat(501),
      }).success,
    ).toBe(false);
  });
});
