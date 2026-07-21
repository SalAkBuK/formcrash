import { describe, expect, it } from 'vitest';

import {
  approveOutcomeCheckRequestSchema,
  assertionResultStatusSchema,
  capturedOutcomeTargetSchema,
  controlledTargetUrlSchema,
  createExternalExperimentRequestSchema,
  createExternalExperimentSuiteRequestSchema,
  createExternalExperimentVersionRequestSchema,
  createProjectRequestSchema,
  deriveExternalRunVerdict,
  experimentTypeSchema,
  externalRunResultPresentationSchema,
  journeyActionTypeSchema,
  hybridTraceManifestSchema,
  outcomeCheckSchema,
  outcomeCheckRunSnapshotSchema,
  outcomeCaptureResponseSchema,
  persistedJourneySchema,
  networkEvidenceCandidateListSchema,
  requestDiscoveryResultSchema,
  runArtifactSchema,
  runEventEnvelopeSchema,
  runStatusSchema,
  startSampleRunAcceptedSchema,
  startSampleRunRequestSchema,
} from '../src/index.js';

describe('canonical external run verdicts', () => {
  it('fails when technical checks pass but an approved Outcome Check fails', () => {
    expect(
      deriveExternalRunVerdict({
        status: 'passed',
        lifecycleStatus: 'completed',
        outcomeAggregate: 'failed',
        assertionAggregate: 'passed',
      }),
    ).toEqual({
      canonicalVerdict: 'failed',
      verdictBasis: 'approved_outcomes_and_technical_checks',
    });
  });

  it('cannot verify when required approved-outcome evidence is unavailable', () => {
    expect(
      deriveExternalRunVerdict({
        status: 'passed',
        lifecycleStatus: 'completed',
        outcomeAggregate: 'could_not_verify',
        assertionAggregate: 'passed',
      }).canonicalVerdict,
    ).toBe('could_not_verify');
  });

  it('keeps runner errors distinct from check failures', () => {
    expect(
      deriveExternalRunVerdict({
        status: 'runner_error',
        lifecycleStatus: 'runner_error',
        outcomeAggregate: 'failed',
        assertionAggregate: 'failed',
      }).canonicalVerdict,
    ).toBe('runner_error');
  });

  it('identifies a legacy technical-only pass without inventing Outcome Check evidence', () => {
    expect(
      deriveExternalRunVerdict({
        status: 'passed',
        lifecycleStatus: 'completed',
        outcomeAggregate: 'not_configured',
        assertionAggregate: 'passed',
      }),
    ).toEqual({
      canonicalVerdict: 'passed',
      verdictBasis: 'technical_checks_only',
    });
  });
});

describe('foundational contracts', () => {
  it('keeps semantic-v1 journeys compatible while validating hybrid-v2 manifests', () => {
    const legacy = persistedJourneySchema.parse({
      id: 'journey-legacy',
      projectId: 'project-1',
      name: 'Legacy journey',
      version: 1,
      steps: [
        {
          id: 'step-1',
          name: 'Navigate',
          type: 'navigate',
          timestamp: 1,
          url: 'http://127.0.0.1:4811',
          locator: null,
          fingerprint: null,
          value: null,
          sensitive: false,
        },
      ],
      recordingMetadata: {
        recordingSessionId: null,
        recordedAt: '2026-07-18T00:00:00.000Z',
        warningCount: 0,
        normalizationRule: 'Legacy semantic replay.',
      },
      createdAt: '2026-07-18T00:00:00.000Z',
    });
    expect(legacy.replayFormat).toBeUndefined();

    expect(
      hybridTraceManifestSchema.safeParse({
        formatVersion: 2,
        environment: {
          viewportWidth: 1440,
          viewportHeight: 900,
          deviceScaleFactor: 1,
          locale: 'en-US',
          timezoneId: 'UTC',
          userAgent: 'contract-test',
          colorScheme: 'light',
          browserName: 'chromium',
          browserVersion: 'test',
        },
        interactions: [],
        eventCount: 0,
        pageCount: 1,
        frameCount: 1,
        redactionVersion: 1,
        videoCaptured: false,
        videos: [],
        truncated: false,
      }).success,
    ).toBe(true);
  });
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
    const input = {
      name: 'Guided submit',
      targetStepId: 'submit',
      triggerCount: 2,
      intervalMs: 0,
      networkMatcher: {
        method: 'POST',
        pathname: '/api/profile',
        host: 'example.test',
      },
      networkEvidenceProvenance: {
        source: 'recording',
        sourceRunId: null,
        actionStepId: 'submit',
        candidateId: 'request-0123456789abcdef01234567',
        candidateScore: 90,
        candidateConfidence: 'high',
        recommendationReasons: [
          {
            code: 'mutation_method',
            label: 'POST can change state.',
            scoreImpact: 50,
          },
        ],
        matcher: {
          method: 'POST',
          pathname: '/api/profile',
          host: 'example.test',
        },
        observedStatus: 201,
        observedFailed: false,
        relativeTimestampMs: 20,
        observedAt: '2026-07-20T20:00:00.000Z',
        approvedAt: '2026-07-20T20:01:00.000Z',
      },
      assertions: [
        {
          id: 'one-request',
          type: 'network_request_max',
          maximum: 2,
          description: 'No more than two matching requests are sent.',
        },
        {
          id: 'one-success',
          type: 'network_success_max',
          maximum: 1,
          description: 'At most one matching request succeeds.',
        },
        {
          id: 'no-server-errors',
          type: 'network_no_server_errors',
          description: 'No matching response returns HTTP 5xx.',
        },
      ],
      continueAfterTarget: false,
      guided: true,
      normalizeJourney: true,
      stepValueOverrides: {
        'fill-name': '{{unique.name}}',
      },
    };
    const result = createExternalExperimentRequestSchema.safeParse(input);

    expect(result.success).toBe(true);
    expect(
      createExternalExperimentRequestSchema.safeParse({
        ...input,
        assertions: input.assertions.filter(
          (assertion) => assertion.type !== 'network_no_server_errors',
        ),
      }).success,
    ).toBe(false);
  });

  it('keeps explicit version creation separate from new-test identity fields', () => {
    const configuration = {
      targetStepId: 'submit',
      triggerCount: 3,
      intervalMs: 300,
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
    };

    expect(
      createExternalExperimentVersionRequestSchema.safeParse(configuration)
        .success,
    ).toBe(true);
    expect(
      createExternalExperimentVersionRequestSchema.safeParse({
        ...configuration,
        name: 'A different stable identity',
      }).success,
    ).toBe(false);
  });

  it('allows zero custom checks because required Outcome Checks are version-owned', () => {
    expect(
      createExternalExperimentVersionRequestSchema.safeParse({
        targetStepId: 'submit',
        triggerCount: 2,
        intervalMs: 0,
        networkMatcher: null,
        assertions: [],
        continueAfterTarget: false,
      }).success,
    ).toBe(true);
  });

  it('accepts exactly one complete three-recipe Test suite', () => {
    const base = {
      targetStepId: 'submit',
      networkMatcher: null,
      assertions: [],
      continueAfterTarget: false,
      guided: true,
    };
    const suite = {
      tests: [
        { ...base, name: 'Double-click: Save', triggerCount: 2, intervalMs: 0 },
        {
          ...base,
          name: 'Triple-click: Save',
          triggerCount: 3,
          intervalMs: 100,
        },
        {
          ...base,
          name: 'Delayed repeat: Save',
          triggerCount: 2,
          intervalMs: 300,
        },
      ],
    };

    expect(
      createExternalExperimentSuiteRequestSchema.safeParse(suite).success,
    ).toBe(true);
    expect(
      createExternalExperimentSuiteRequestSchema.safeParse({
        tests: suite.tests.map((test) => ({ ...test, intervalMs: 0 })),
      }).success,
    ).toBe(false);
  });

  it('requires every snapshotted Outcome Check to belong to its Critical Action', () => {
    expect(
      outcomeCheckRunSnapshotSchema.safeParse({
        criticalAction: {
          id: 'action-one',
          journeyId: 'journey-one',
          stepId: 'submit',
          label: 'Submit',
          createdAt: '2026-07-20T00:00:00.000Z',
          updatedAt: '2026-07-20T00:00:00.000Z',
        },
        checks: [
          {
            id: 'check-one',
            journeyId: 'journey-one',
            criticalActionId: 'another-action',
            type: 'final_pathname_matches',
            description: 'The final page should remain visible.',
            expectedPathname: '/complete',
            createdAt: '2026-07-20T00:00:00.000Z',
          },
        ],
      }).success,
    ).toBe(false);
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
    expect(result.networkEvidenceProvenance).toBeUndefined();
    expect(result.assertionSelectionProvenance).toBeUndefined();
  });

  it('requires explicit evidence approval before enabling network checks', () => {
    const result = createExternalExperimentRequestSchema.safeParse({
      name: 'Unapproved network test',
      targetStepId: 'submit',
      triggerCount: 2,
      intervalMs: 0,
      networkMatcher: {
        method: 'POST',
        pathname: '/api/tenants',
        host: 'api.example.test',
      },
      assertions: [
        {
          id: 'request-limit',
          type: 'network_request_max',
          maximum: 2,
          description: 'No more than two requests.',
        },
      ],
      continueAfterTarget: false,
    });

    expect(result.success).toBe(false);
  });

  it('accepts bounded recording approval and excludes unsafe request fields', () => {
    const candidates = networkEvidenceCandidateListSchema.parse({
      source: 'recording',
      explanation: 'Captured once.',
      items: [
        {
          candidateId: 'request-0123456789abcdef01234567',
          rank: 1,
          score: 58,
          classification: 'likely_business_mutation',
          confidence: 'review',
          recommended: false,
          reasons: [
            {
              code: 'mutation_method',
              label: 'POST can change state.',
              scoreImpact: 50,
            },
          ],
          source: 'recording',
          sourceRunId: null,
          actionStepId: 'submit',
          method: 'POST',
          origin: 'https://api.example.test',
          host: 'api.example.test',
          pathname: '/api/tenants',
          status: 201,
          failed: false,
          relativeTimestampMs: 14,
          occurrences: 1,
          observedAt: '2026-07-20T20:00:00.000Z',
        },
      ],
    });

    expect(candidates.items[0]).not.toHaveProperty('headers');
    expect(candidates.items[0]).not.toHaveProperty('body');
    expect(candidates.items[0]).not.toHaveProperty('query');
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
            resolvedValue: 'formcrash+abc123@example.test',
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
    expect(response.capture?.generatedInputs[0]?.resolvedValue).toBe(
      'formcrash+abc123@example.test',
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
