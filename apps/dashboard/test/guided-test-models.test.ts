import { describe, expect, it } from 'vitest';

import type {
  PersistedJourney,
  RequestDiscoveryResult,
} from '@formcrash/contracts';

import {
  approveRequestRecommendationSelections,
  recommendationProvenance,
  recommendationSelections,
  recommendationSetForCandidate,
  selectedAssertions,
} from '../src/features/projects/models/assertion-recommendations';
import { guidedStepValueOverrides } from '../src/features/projects/models/guided-values';
import { assessJourneyReadiness } from '../src/features/projects/models/journey-readiness';
import {
  guidedConfirmableCandidate,
  initialCandidateIndex,
  selectionProvenance,
} from '../src/features/projects/models/request-selection';

const journey: PersistedJourney = {
  id: 'journey-1',
  projectId: 'project-1',
  name: 'Create resident',
  version: 1,
  steps: [
    {
      id: 'fill-email',
      name: 'Fill email',
      type: 'fill',
      timestamp: 0,
      url: 'https://example.test/residents',
      locator: { strategy: 'name', value: 'email' },
      fingerprint: {
        tagName: 'input',
        inputType: 'email',
        dataFormcrash: null,
        dataTestId: null,
        id: null,
        role: 'textbox',
        accessibleName: 'Email',
        name: 'email',
        label: 'Email',
        text: null,
        cssPath: 'input[name="email"]',
      },
      value: { kind: 'safe', value: 'existing@example.test' },
      sensitive: false,
    },
    {
      id: 'fill-password',
      name: 'Fill password',
      type: 'fill',
      timestamp: 1,
      url: 'https://example.test/residents',
      locator: { strategy: 'name', value: 'password' },
      fingerprint: null,
      value: { kind: 'sensitive', variableName: 'PASSWORD' },
      sensitive: true,
    },
    {
      id: 'submit',
      name: 'Submit resident',
      type: 'submit',
      timestamp: 2,
      url: 'https://example.test/residents',
      locator: { strategy: 'data-testid', value: 'resident-form' },
      fingerprint: null,
      value: null,
      sensitive: false,
    },
  ],
  recordingMetadata: {
    recordingSessionId: null,
    recordedAt: '2026-07-16T00:00:00.000Z',
    warningCount: 0,
    normalizationRule: 'test',
  },
  createdAt: '2026-07-16T00:00:00.000Z',
};

describe('guided test automation models', () => {
  it('blocks analysis only for genuine missing requirements', () => {
    const targetStep = journey.steps[2] ?? null;
    const blocked = assessJourneyReadiness({
      journey,
      targetStep,
      runtimeRequirements: [
        { name: 'PASSWORD', label: 'Password', secret: true },
      ],
      runtimeValues: {},
      generatedValueCount: 1,
      authenticationAvailable: true,
      cleanupConfigured: true,
      production: false,
    });
    const ready = assessJourneyReadiness({
      journey,
      targetStep,
      runtimeRequirements: [
        { name: 'PASSWORD', label: 'Password', secret: true },
      ],
      runtimeValues: { PASSWORD: 'runtime-only' },
      generatedValueCount: 1,
      authenticationAvailable: true,
      cleanupConfigured: true,
      production: false,
    });

    expect(blocked.status).toBe('blocked');
    expect(blocked.items).toContainEqual(
      expect.objectContaining({
        id: 'runtime',
        level: 'blocker',
      }),
    );
    expect(ready.status).toBe('ready');
    expect(ready.blockerCount).toBe(0);
  });

  it('generates unique field overrides and server-safety assertions', () => {
    expect(guidedStepValueOverrides(journey)).toEqual({
      'fill-email': '{{unique.email}}',
    });

    const discovery = discoveryResult();
    const selected = discovery.candidates[1]!;
    const assertions = recommendationSelections(
      recommendationSetForCandidate(discovery, selected),
    ).map((selection) => selection.assertion);

    expect(assertions).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: 'network_request_max',
          maximum: 2,
        }),
        expect.objectContaining({
          type: 'network_success_max',
          maximum: 1,
        }),
        expect.objectContaining({
          type: 'network_no_server_errors',
        }),
        expect.objectContaining({
          type: 'network_all_status',
          allowedStatuses: [201, 409],
        }),
      ]),
    );
  });

  it('uses the server outcome and recommended flag without client-side reranking', () => {
    const discovery = discoveryResult();

    expect(initialCandidateIndex(discovery)).toBe(1);
    expect(
      initialCandidateIndex({
        ...discovery,
        recommendation: {
          outcome: 'review',
          recommendedCandidateId: null,
          explanation: 'Review required.',
        },
      }),
    ).toBe(-1);
    expect(
      selectionProvenance(discovery, discovery.candidates[0]!),
    ).toMatchObject({
      selectionMode: 'manual_override',
      selectedCandidateId: 'request-aaaaaaaaaaaaaaaaaaaaaaaa',
      recommendedMatcher: {
        method: 'POST',
        pathname: '/api/residents',
        host: 'example.test',
      },
      selectedMatcher: {
        method: 'GET',
        pathname: '/api/residents',
        host: 'example.test',
      },
      userOverrodeRecommendation: true,
    });
  });

  it('offers one strong cross-origin business mutation for explicit Guided approval', () => {
    const recommended = discoveryResult();
    const businessMutation = recommended.candidates[1]!;
    const discovery: RequestDiscoveryResult = {
      ...recommended,
      candidates: [
        {
          ...businessMutation,
          rank: 1,
          score: 74,
          origin: 'https://api.example.test',
          confidence: 'review',
          recommended: false,
          reasons: [
            ...businessMutation.reasons,
            {
              code: 'cross_origin',
              label: 'Request uses a different origin.',
              scoreImpact: -20,
            },
          ],
        },
      ],
      recommendation: {
        outcome: 'review',
        recommendedCandidateId: null,
        explanation: 'The cross-origin mutation requires confirmation.',
      },
      assertionRecommendationSets: recommended.assertionRecommendationSets.map(
        (set) => ({
          ...set,
          recommendations: set.recommendations.map((item) => ({
            ...item,
            confidence: 'review' as const,
            defaultEnabled: false,
          })),
        }),
      ),
    };

    const candidate = guidedConfirmableCandidate(discovery);
    expect(candidate?.candidateId).toBe(businessMutation.candidateId);
    const selections = approveRequestRecommendationSelections(
      recommendationSetForCandidate(discovery, candidate),
    );
    expect(selectedAssertions(selections)).toHaveLength(4);
    expect(
      recommendationProvenance(selections).every(
        (entry) => entry.action === 'enabled',
      ),
    ).toBe(true);
  });

  it('does not offer failed, weak, or multiple business mutations for Guided confirmation', () => {
    const recommended = discoveryResult();
    const businessMutation = recommended.candidates[1]!;
    const review: RequestDiscoveryResult = {
      ...recommended,
      candidates: [
        {
          ...businessMutation,
          rank: 1,
          score: 74,
          origin: 'https://api.example.test',
          confidence: 'review',
          recommended: false,
          reasons: [
            ...businessMutation.reasons,
            {
              code: 'cross_origin',
              label: 'Request uses a different origin.',
              scoreImpact: -20,
            },
          ],
        },
      ],
      recommendation: {
        outcome: 'review',
        recommendedCandidateId: null,
        explanation: 'Review required.',
      },
    };

    expect(
      guidedConfirmableCandidate({
        ...review,
        candidates: [{ ...review.candidates[0]!, failed: true }],
      }),
    ).toBeNull();
    expect(
      guidedConfirmableCandidate({
        ...review,
        candidates: [{ ...review.candidates[0]!, score: 59 }],
      }),
    ).toBeNull();
    expect(
      guidedConfirmableCandidate({
        ...review,
        candidates: [
          review.candidates[0]!,
          {
            ...review.candidates[0]!,
            candidateId: 'request-cccccccccccccccccccccccc',
            rank: 2,
            pathname: '/api/invitations',
          },
        ],
      }),
    ).toBeNull();
  });
});

function discoveryResult(): RequestDiscoveryResult {
  return {
    discoveryId: '11111111-2222-4333-8444-555555555555',
    discoveredAt: '2026-07-16T00:00:00.000Z',
    journeyId: journey.id,
    targetStepId: 'submit',
    candidates: [
      {
        candidateId: 'request-aaaaaaaaaaaaaaaaaaaaaaaa',
        rank: 2,
        score: 999,
        classification: 'background_refresh',
        confidence: 'review',
        recommended: false,
        reasons: [
          {
            code: 'background_refresh',
            label: 'Background refresh.',
            scoreImpact: -30,
          },
        ],
        method: 'GET',
        pathname: '/api/residents',
        origin: 'https://example.test',
        status: 200,
        failed: false,
        relativeTimestampMs: 12,
        occurrences: 1,
      },
      {
        candidateId: 'request-bbbbbbbbbbbbbbbbbbbbbbbb',
        rank: 1,
        score: 100,
        classification: 'likely_business_mutation',
        confidence: 'high',
        recommended: true,
        reasons: [
          {
            code: 'mutation_method',
            label: 'POST can change server state.',
            scoreImpact: 50,
          },
        ],
        method: 'POST',
        pathname: '/api/residents',
        origin: 'https://example.test',
        status: 201,
        failed: false,
        relativeTimestampMs: 10,
        occurrences: 1,
      },
    ],
    recommendation: {
      outcome: 'recommended',
      recommendedCandidateId: 'request-bbbbbbbbbbbbbbbbbbbbbbbb',
      explanation: 'The server selected the business mutation.',
    },
    normalAction: {
      targetControlLocator: null,
      targetWasDisabledDuringPending: null,
      finalPathname: '/residents',
      elements: [],
    },
    assertionRecommendationSets: [
      {
        recipeType: 'server_duplicate_handling',
        selectedRequestCandidateId: 'request-bbbbbbbbbbbbbbbbbbbbbbbb',
        recommendations: [
          recommendation('request', {
            id: 'assertion-draft-aaaaaaaaaaaaaaaaaaaaaaaa',
            type: 'network_request_max',
            maximum: 2,
            description: 'Request maximum',
          }),
          recommendation('success', {
            id: 'assertion-draft-bbbbbbbbbbbbbbbbbbbbbbbb',
            type: 'network_success_max',
            maximum: 1,
            description: 'Success maximum',
          }),
          recommendation('server', {
            id: 'assertion-draft-cccccccccccccccccccccccc',
            type: 'network_no_server_errors',
            description: 'No server error',
          }),
          recommendation('status', {
            id: 'assertion-draft-dddddddddddddddddddddddd',
            type: 'network_all_status',
            allowedStatuses: [201, 409],
            description: 'Allowed statuses',
          }),
        ],
        limitations: [],
      },
      {
        recipeType: 'server_duplicate_handling',
        selectedRequestCandidateId: null,
        recommendations: [],
        limitations: ['No candidate.'],
      },
    ],
  };
}

function recommendation(
  suffix: string,
  assertion: RequestDiscoveryResult['assertionRecommendationSets'][number]['recommendations'][number]['assertion'],
) {
  return {
    recommendationId: `assertion-rec-${suffix.padEnd(24, 'a')}`,
    assertion,
    category: 'response_outcome' as const,
    confidence: 'high' as const,
    defaultEnabled: true,
    reasonCode: 'test_recommendation',
    explanation: 'Server-generated recommendation.',
    evidence: {
      evidenceIds: ['request-bbbbbbbbbbbbbbbbbbbbbbbb'],
      source: 'request_discovery' as const,
    },
  };
}
