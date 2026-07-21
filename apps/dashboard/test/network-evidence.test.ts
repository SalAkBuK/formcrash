import { describe, expect, it } from 'vitest';

import type { NetworkEvidenceCandidate } from '@formcrash/contracts';

import {
  candidateCanBeApproved,
  matcherForCandidate,
  provenanceForCandidate,
  recipeNetworkAssertions,
} from '../src/features/projects/models/network-evidence';

describe('approved network evidence', () => {
  it('builds the bounded double-click protection set', () => {
    const assertions = recipeNetworkAssertions(
      'duplicate_action',
      2,
      candidate(),
    );

    expect(assertions.map((assertion) => assertion.type)).toEqual([
      'network_request_max',
      'network_success_max',
      'network_no_server_errors',
    ]);
    expect(assertions[0]).toMatchObject({ maximum: 2 });
    expect(assertions[1]).toMatchObject({ maximum: 1 });
  });

  it('bounds all three triple-click attempts and one success', () => {
    const assertions = recipeNetworkAssertions(
      'rapid_triple_action',
      3,
      candidate(),
    );

    expect(assertions[0]).toMatchObject({ maximum: 3 });
    expect(assertions[1]).toMatchObject({ maximum: 1 });
  });

  it('adds the approved success and duplicate statuses for server handling', () => {
    const assertions = recipeNetworkAssertions(
      'server_duplicate_handling',
      2,
      candidate(),
    );

    expect(assertions.at(-1)).toMatchObject({
      type: 'network_all_status',
      allowedStatuses: [201, 409],
    });
  });

  it('creates a host-bounded matcher and immutable source provenance', () => {
    const evidence = candidate();

    expect(candidateCanBeApproved(evidence)).toBe(true);
    expect(matcherForCandidate(evidence)).toEqual({
      method: 'POST',
      pathname: '/v1/tenants',
      host: 'api.example.test',
    });
    expect(
      provenanceForCandidate(evidence, '2026-07-20T21:00:00.000Z'),
    ).toMatchObject({
      source: 'recording',
      sourceRunId: null,
      candidateId: evidence.candidateId,
      observedStatus: 201,
      approvedAt: '2026-07-20T21:00:00.000Z',
    });
  });
});

function candidate(): NetworkEvidenceCandidate {
  return {
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
    actionStepId: 'submit-step',
    method: 'POST',
    origin: 'https://api.example.test',
    host: 'api.example.test',
    pathname: '/v1/tenants',
    status: 201,
    failed: false,
    relativeTimestampMs: 20,
    occurrences: 1,
    observedAt: '2026-07-20T20:00:00.000Z',
  };
}
