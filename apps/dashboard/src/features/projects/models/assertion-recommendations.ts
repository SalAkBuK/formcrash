import type {
  AssertionRecommendation,
  AssertionRecommendationSet,
  AssertionSelectionProvenanceEntry,
  ExternalAssertion,
  RankedRequestCandidate,
  RequestDiscoveryResult,
} from '@formcrash/contracts';

export interface RecommendationSelection {
  readonly recommendation: AssertionRecommendation;
  readonly assertion: ExternalAssertion;
  readonly enabled: boolean;
}

export function recommendationSetForCandidate(
  discovery: RequestDiscoveryResult,
  candidate: RankedRequestCandidate | null,
): AssertionRecommendationSet {
  return (
    discovery.assertionRecommendationSets.find(
      (set) =>
        set.selectedRequestCandidateId === (candidate?.candidateId ?? null),
    ) ?? discovery.assertionRecommendationSets.at(-1)!
  );
}

export function recommendationSelections(
  set: AssertionRecommendationSet,
): readonly RecommendationSelection[] {
  return set.recommendations.map((recommendation) => ({
    recommendation,
    assertion: recommendation.assertion,
    enabled: recommendation.defaultEnabled,
  }));
}

export function approveRequestRecommendationSelections(
  set: AssertionRecommendationSet,
): readonly RecommendationSelection[] {
  return recommendationSelections(set).map((selection) => ({
    ...selection,
    enabled:
      selection.enabled || selection.assertion.type.startsWith('network_'),
  }));
}

export function selectedAssertions(
  selections: readonly RecommendationSelection[],
): readonly ExternalAssertion[] {
  return selections
    .filter((selection) => selection.enabled)
    .map((selection) => selection.assertion);
}

export function recommendationProvenance(
  selections: readonly RecommendationSelection[],
  manualAssertions: readonly ExternalAssertion[] = [],
): readonly AssertionSelectionProvenanceEntry[] {
  return [
    ...selections.map((selection) => {
      const modified =
        JSON.stringify(selection.assertion) !==
        JSON.stringify(selection.recommendation.assertion);
      return {
        assertionId: selection.enabled ? selection.assertion.id : null,
        recommendationId: selection.recommendation.recommendationId,
        origin: modified ? 'generated_modified' : 'generated',
        confidence: selection.recommendation.confidence,
        reasonCode: selection.recommendation.reasonCode,
        explanation: selection.recommendation.explanation,
        defaultEnabled: selection.recommendation.defaultEnabled,
        action: selection.enabled
          ? modified
            ? 'modified'
            : selection.recommendation.defaultEnabled
              ? 'accepted'
              : 'enabled'
          : 'disabled',
        evidenceIds: selection.recommendation.evidence.evidenceIds,
      } satisfies AssertionSelectionProvenanceEntry;
    }),
    ...manualAssertions.map(
      (assertion) =>
        ({
          assertionId: assertion.id,
          recommendationId: null,
          origin: 'manual',
          confidence: null,
          reasonCode: null,
          explanation: null,
          defaultEnabled: null,
          action: 'manual',
          evidenceIds: [],
        }) satisfies AssertionSelectionProvenanceEntry,
    ),
  ];
}

export function editableAssertionValue(assertion: ExternalAssertion): string {
  switch (assertion.type) {
    case 'network_request_max':
    case 'network_success_max':
      return String(assertion.maximum);
    case 'network_request_exact':
    case 'network_success_exact':
      return String(assertion.expected);
    case 'network_expected_status':
      return String(assertion.expectedStatus);
    case 'network_all_status':
      return assertion.allowedStatuses.join(', ');
    case 'final_url_contains':
    case 'final_url_not_contains':
      return assertion.value;
    default:
      return '';
  }
}

export function assertionWithEditedValue(
  assertion: ExternalAssertion,
  value: string,
): ExternalAssertion {
  if (
    assertion.type === 'network_request_max' ||
    assertion.type === 'network_success_max'
  ) {
    return { ...assertion, maximum: Number(value) };
  }
  if (
    assertion.type === 'network_request_exact' ||
    assertion.type === 'network_success_exact'
  ) {
    return { ...assertion, expected: Number(value) };
  }
  if (assertion.type === 'network_expected_status') {
    return { ...assertion, expectedStatus: Number(value) };
  }
  if (assertion.type === 'network_all_status') {
    return {
      ...assertion,
      allowedStatuses: value
        .split(',')
        .map((item) => Number(item.trim()))
        .filter((item) => Number.isInteger(item)),
    };
  }
  if (
    assertion.type === 'final_url_contains' ||
    assertion.type === 'final_url_not_contains'
  ) {
    return { ...assertion, value };
  }
  return assertion;
}

export function assertionSupportsValueEdit(
  assertion: ExternalAssertion,
): boolean {
  return [
    'network_request_max',
    'network_request_exact',
    'network_success_max',
    'network_success_exact',
    'network_expected_status',
    'network_all_status',
    'final_url_contains',
    'final_url_not_contains',
  ].includes(assertion.type);
}
