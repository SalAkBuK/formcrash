import { describe, expect, it } from 'vitest';

import type { DiscoveredRequest } from '@formcrash/contracts';

import { rankRequestCandidates } from '../src/runner/external/request-recommendation.js';

const targetOrigin = 'https://app.example.test';

describe('server-owned request recommendation', () => {
  it('recommends one clear business mutation above assets, analytics, and refresh traffic', () => {
    const result = rank([
      candidate('GET', '/assets/app.js', 200, 5),
      candidate('GET', '/api/tenants', 200, 30),
      candidate('POST', '/collect', 204, 20, 'https://analytics.example.test'),
      candidate('POST', '/api/session/refresh', 204, 8),
      candidate('POST', '/api/tenants', 201, 10),
    ]);

    expect(result.recommendation).toMatchObject({
      outcome: 'recommended',
      recommendedCandidateId: result.candidates[0]?.candidateId,
    });
    expect(result.candidates[0]).toMatchObject({
      method: 'POST',
      pathname: '/api/tenants',
      classification: 'likely_business_mutation',
      confidence: 'high',
      recommended: true,
      rank: 1,
    });
    expect(
      result.candidates.find(
        (item) => item.method === 'GET' && item.pathname === '/api/tenants',
      ),
    ).toMatchObject({
      classification: 'background_refresh',
      recommended: false,
    });
    expect(
      result.candidates.find(
        (item) =>
          item.method === 'POST' && item.pathname === '/api/session/refresh',
      ),
    ).toMatchObject({
      classification: 'background_refresh',
      recommended: false,
    });
  });

  it('returns ambiguous when two plausible successful mutations have similar evidence', () => {
    const result = rank([
      candidate('POST', '/api/tenants', 201, 10),
      candidate('POST', '/api/invitations', 201, 12),
    ]);

    expect(result.recommendation).toMatchObject({
      outcome: 'ambiguous',
      recommendedCandidateId: null,
    });
    expect(
      result.candidates.filter((item) => item.confidence === 'ambiguous'),
    ).toHaveLength(2);
    expect(result.candidates.every((item) => !item.recommended)).toBe(true);
  });

  it('requires review for a cross-origin mutation', () => {
    const result = rank([
      candidate('GET', '/api/tenants', 200, 20),
      candidate('POST', '/api/tenants', 201, 10, 'https://api.partner.test'),
    ]);

    expect(result.recommendation.outcome).toBe('review');
    expect(result.candidates[0]).toMatchObject({
      method: 'POST',
      confidence: 'review',
      recommended: false,
    });
    expect(result.candidates[0]?.reasons).toContainEqual(
      expect.objectContaining({
        code: 'cross_origin',
        scoreImpact: -20,
      }),
    );
  });

  it('penalizes failed candidates and keeps status evidence explicit', () => {
    const result = rank([
      { ...candidate('POST', '/api/tenants', 500, 10), failed: true },
      candidate('GET', '/api/search', 200, 20),
    ]);
    const failed = result.candidates.find(
      (item) => item.pathname === '/api/tenants',
    );

    expect(result.recommendation.outcome).toBe('review');
    expect(failed?.reasons).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ code: 'failed_request', scoreImpact: -30 }),
      ]),
    );
    expect(failed?.recommended).toBe(false);
  });

  it('returns no candidate when no request or only static and analytics traffic exists', () => {
    expect(rank([]).recommendation.outcome).toBe('no_candidate');
    expect(
      rank([
        candidate('GET', '/assets/app.css', 200, 5),
        candidate(
          'POST',
          '/v1/telemetry',
          204,
          8,
          'https://telemetry.example.test',
        ),
      ]).recommendation.outcome,
    ).toBe('no_candidate');
  });

  it('is deterministic and uses a stable tie breaker for equal evidence', () => {
    const evidence = [
      candidate('POST', '/api/beta', 201, 10),
      candidate('POST', '/api/alpha', 201, 10),
    ];
    const first = rank(evidence);
    const second = rank([...evidence].reverse());

    expect(first).toEqual(second);
    expect(first.candidates.map((item) => item.pathname)).toEqual([
      '/api/alpha',
      '/api/beta',
    ]);
    expect(first.candidates.map((item) => item.candidateId)).toEqual(
      second.candidates.map((item) => item.candidateId),
    );
  });
});

function rank(candidates: readonly DiscoveredRequest[]) {
  return rankRequestCandidates({
    candidates,
    targetOrigin,
    journeyName: 'Create tenant',
    targetStepName: 'Submit tenant',
    targetPathname: '/portal/tenants/new',
  });
}

function candidate(
  method: string,
  pathname: string,
  status: number | null,
  relativeTimestampMs: number,
  origin = targetOrigin,
): DiscoveredRequest {
  return {
    method,
    pathname,
    origin,
    status,
    failed: false,
    relativeTimestampMs,
    occurrences: 1,
  };
}
