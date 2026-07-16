import type {
  NetworkMatcher,
  RankedRequestCandidate,
  RequestDiscoveryResult,
  RequestSelectionProvenance,
} from '@formcrash/contracts';

export function matcherForCandidate(
  candidate: RankedRequestCandidate,
): NetworkMatcher {
  return {
    method: candidate.method,
    pathname: candidate.pathname,
    host: new URL(candidate.origin).host,
  };
}

export function initialCandidateIndex(
  discovery: RequestDiscoveryResult,
): number {
  if (discovery.recommendation.outcome !== 'recommended') return -1;
  return discovery.candidates.findIndex((candidate) => candidate.recommended);
}

export function selectionProvenance(
  discovery: RequestDiscoveryResult,
  selected: RankedRequestCandidate,
): RequestSelectionProvenance {
  const recommended =
    discovery.candidates.find((candidate) => candidate.recommended) ?? null;
  const selectedMatcher = matcherForCandidate(selected);
  const recommendedMatcher =
    recommended === null ? null : matcherForCandidate(recommended);
  const acceptedRecommendation =
    recommended?.candidateId === selected.candidateId;
  return {
    selectionMode: acceptedRecommendation
      ? 'confirmed_recommendation'
      : 'manual_override',
    discoveryId: discovery.discoveryId,
    discoveredAt: discovery.discoveredAt,
    discoveryOutcome: discovery.recommendation.outcome,
    selectedCandidateId: selected.candidateId,
    selectedCandidateScore: selected.score,
    selectedCandidateConfidence: selected.confidence,
    recommendationReasons: (recommended ?? selected).reasons,
    recommendedMatcher,
    selectedMatcher,
    userOverrodeRecommendation: recommended !== null && !acceptedRecommendation,
  };
}
