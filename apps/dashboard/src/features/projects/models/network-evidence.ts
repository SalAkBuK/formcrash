import type {
  ExternalAssertion,
  NetworkEvidenceCandidate,
  NetworkEvidenceProvenance,
  NetworkMatcher,
} from '@formcrash/contracts';

import type { GuidedRecipeId } from './guided-recipes';

const mutationMethods = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

export function candidateCanBeApproved(
  candidate: NetworkEvidenceCandidate,
): boolean {
  return (
    mutationMethods.has(candidate.method) &&
    !candidate.failed &&
    candidate.status !== null &&
    candidate.status >= 200 &&
    candidate.status < 400
  );
}

export function matcherForCandidate(
  candidate: NetworkEvidenceCandidate,
): NetworkMatcher {
  return {
    method: candidate.method,
    pathname: candidate.pathname,
    host: candidate.host,
  };
}

export function provenanceForCandidate(
  candidate: NetworkEvidenceCandidate,
  approvedAt = new Date().toISOString(),
): NetworkEvidenceProvenance {
  return {
    source: candidate.source,
    sourceRunId: candidate.sourceRunId,
    actionStepId: candidate.actionStepId,
    candidateId: candidate.candidateId,
    candidateScore: candidate.score,
    candidateConfidence: candidate.confidence,
    recommendationReasons: candidate.reasons,
    matcher: matcherForCandidate(candidate),
    observedStatus: candidate.status,
    observedFailed: candidate.failed,
    relativeTimestampMs: candidate.relativeTimestampMs,
    observedAt: candidate.observedAt,
    approvedAt,
  };
}

export function recipeNetworkAssertions(
  recipeId: GuidedRecipeId,
  triggerCount: 2 | 3,
  candidate: NetworkEvidenceCandidate,
): readonly ExternalAssertion[] {
  return recipeNetworkAssertionsForStatus(
    recipeId,
    triggerCount,
    candidate.status,
  );
}

export function recipeNetworkAssertionsForStatus(
  recipeId: GuidedRecipeId,
  triggerCount: 2 | 3,
  observedStatus: number | null,
): readonly ExternalAssertion[] {
  const prefix = `recipe-network-${recipeId}`;
  const assertions: ExternalAssertion[] = [
    {
      id: `${prefix}-request-max`,
      type: 'network_request_max',
      maximum: triggerCount,
      description: `No more than ${triggerCount} matching requests are attempted.`,
    },
    {
      id: `${prefix}-success-max`,
      type: 'network_success_max',
      maximum: 1,
      description: 'At most one matching request completes successfully.',
    },
    {
      id: `${prefix}-no-5xx`,
      type: 'network_no_server_errors',
      description: 'No matching response returns HTTP 5xx.',
    },
  ];
  if (recipeId === 'server_duplicate_handling') {
    assertions.push({
      id: `${prefix}-allowed-statuses`,
      type: 'network_all_status',
      allowedStatuses: [...new Set([observedStatus ?? 200, 409])],
      description: `Every matching response uses the approved success status ${observedStatus} or duplicate status 409.`,
    });
  }
  return assertions;
}

export function recipeIdForConfiguration(
  triggerCount: 2 | 3,
  intervalMs: 0 | 100 | 300,
): GuidedRecipeId {
  if (triggerCount === 3) return 'rapid_triple_action';
  if (intervalMs === 300) return 'server_duplicate_handling';
  return 'duplicate_action';
}
