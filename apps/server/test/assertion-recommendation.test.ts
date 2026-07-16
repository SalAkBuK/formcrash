import { describe, expect, it } from 'vitest';

import type {
  NormalActionObservation,
  RankedRequestCandidate,
  RecordedJourneyStep,
} from '@formcrash/contracts';

import { recommendAssertions } from '../src/runner/external/assertion-recommendation.js';

describe('server-owned assertion recommendation', () => {
  it('creates deterministic high-confidence network recommendations for a selected mutation', () => {
    const first = recommendations(candidate(), observation());
    const second = recommendations(candidate(), observation());

    expect(first).toEqual(second);
    const requestMaximum = first.recommendations.find(
      (item) => item.assertion.type === 'network_request_max',
    );
    expect(requestMaximum).toMatchObject({
      category: 'request_count',
      confidence: 'high',
      defaultEnabled: true,
    });
    expect(requestMaximum?.assertion).toMatchObject({
      type: 'network_request_max',
      maximum: 1,
    });
    expect(
      first.recommendations.find(
        (item) => item.assertion.type === 'network_success_max',
      )?.assertion,
    ).toMatchObject({ type: 'network_success_max', maximum: 1 });
    expect(
      first.recommendations.find(
        (item) => item.assertion.type === 'network_no_server_errors',
      )?.category,
    ).toBe('server_error');
    expect(
      first.recommendations.find(
        (item) => item.assertion.type === 'network_all_status',
      )?.assertion,
    ).toMatchObject({
      type: 'network_all_status',
      allowedStatuses: [201],
    });
  });

  it('does not fabricate request assertions without a selected mutation', () => {
    const result = recommendations(null, observation(), 'no_candidate');

    expect(
      result.recommendations.some((item) =>
        item.assertion.type.startsWith('network_'),
      ),
    ).toBe(false);
    expect(result.limitations.join(' ')).toContain(
      'did not have a selected mutation request',
    );
  });

  it('keeps ambiguous and manually selected candidates in review until approved', () => {
    const result = recommendations(
      {
        ...candidate(),
        candidateId: 'request-bbbbbbbbbbbbbbbbbbbbbbbb',
        recommended: false,
        confidence: 'ambiguous',
      },
      observation(),
      'ambiguous',
    );

    expect(result.selectedRequestCandidateId).toBe(
      'request-bbbbbbbbbbbbbbbbbbbbbbbb',
    );
    expect(
      result.recommendations
        .filter((item) => item.assertion.type.startsWith('network_'))
        .every((item) => item.confidence === 'review' && !item.defaultEnabled),
    ).toBe(true);
  });

  it('omits an expected-success status when discovery failed', () => {
    const result = recommendations(
      { ...candidate(), status: 500, failed: true, recommended: false },
      observation(),
      'review',
    );

    expect(
      result.recommendations.some(
        (item) => item.assertion.type === 'network_all_status',
      ),
    ).toBe(false);
    expect(result.limitations.join(' ')).toContain(
      'did not produce a successful completed status',
    );
  });

  it('recommends only directly observed pending, success, error and navigation interface checks', () => {
    const result = recommendations(candidate(), observation());

    const submitState = result.recommendations.find(
      (item) => item.category === 'submit_state',
    );
    expect(submitState).toMatchObject({
      confidence: 'review',
      defaultEnabled: false,
    });
    expect(submitState?.assertion).toMatchObject({
      type: 'element_disabled',
      observationWindow: 'during_repeated_action',
    });
    expect(
      result.recommendations.find(
        (item) => item.category === 'success_interface',
      )?.assertion.type,
    ).toBe('element_visible');
    expect(
      result.recommendations.find((item) => item.category === 'error_interface')
        ?.assertion.type,
    ).toBe('element_not_visible');
    expect(
      result.recommendations.find((item) => item.category === 'navigation')
        ?.assertion,
    ).toMatchObject({
      type: 'final_url_contains',
      value: '/profiles',
    });
  });

  it('omits unsupported interface recommendations and safely reduces dynamic paths', () => {
    const result = recommendations(candidate(), {
      targetControlLocator: null,
      targetWasDisabledDuringPending: false,
      finalPathname: '/profiles/550e8400-e29b-41d4-a716-446655440000',
      elements: [],
    });

    expect(
      result.recommendations.some((item) => item.category === 'submit_state'),
    ).toBe(false);
    expect(
      result.recommendations.find((item) => item.category === 'navigation')
        ?.assertion,
    ).toMatchObject({ type: 'final_url_contains', value: '/profiles' });
  });

  it('never copies page text or secret values into recommendation evidence', () => {
    const serialized = JSON.stringify(
      recommendations(candidate(), {
        ...observation(),
        finalPathname: '/profiles/SyntheticSecret-123',
      }),
    );

    expect(serialized).not.toContain('SyntheticSecret-123');
    expect(serialized).not.toContain('Profile fixture completed');
    expect(serialized).not.toContain('?token=');
  });
});

function recommendations(
  selectedCandidate: RankedRequestCandidate | null,
  normalAction: NormalActionObservation,
  discoveryOutcome:
    'recommended' | 'review' | 'ambiguous' | 'no_candidate' = 'recommended',
) {
  return recommendAssertions({
    recipe: {
      type: 'duplicate_action',
      triggerCount: 2,
      intervalMs: 0,
    },
    candidate: selectedCandidate,
    discoveryOutcome,
    target,
    normalAction,
  });
}

function candidate(): RankedRequestCandidate {
  return {
    candidateId: 'request-aaaaaaaaaaaaaaaaaaaaaaaa',
    rank: 1,
    score: 108,
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
    pathname: '/api/profiles',
    origin: 'https://example.test',
    status: 201,
    failed: false,
    relativeTimestampMs: 4,
    occurrences: 1,
  };
}

function observation(): NormalActionObservation {
  return {
    targetControlLocator: {
      strategy: 'data-testid',
      value: 'save-profile',
    },
    targetWasDisabledDuringPending: true,
    finalPathname: '/profiles',
    elements: [
      {
        observationId: 'element-aaaaaaaaaaaaaaaaaaaaaaaa',
        locator: { strategy: 'id', value: 'complete' },
        classification: 'success',
        visibleBefore: false,
        visibleAfter: true,
      },
      {
        observationId: 'element-bbbbbbbbbbbbbbbbbbbbbbbb',
        locator: { strategy: 'id', value: 'request-error' },
        classification: 'error',
        visibleBefore: false,
        visibleAfter: false,
      },
    ],
  };
}

const target: RecordedJourneyStep = {
  id: 'submit',
  name: 'Submit profile',
  type: 'submit',
  timestamp: 1,
  url: 'https://example.test/profiles?token=SyntheticSecret-123',
  locator: { strategy: 'data-testid', value: 'profile-form' },
  fingerprint: null,
  value: null,
  sensitive: false,
};
