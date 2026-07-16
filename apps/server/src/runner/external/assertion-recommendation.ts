import { createHash } from 'node:crypto';

import {
  assertionRecommendationSetSchema,
  type AssertionRecommendation,
  type AssertionRecommendationRecipe,
  type AssertionRecommendationSet,
  type ExternalAssertion,
  type NormalActionObservation,
  type RankedRequestCandidate,
  type RecordedJourneyStep,
  type RequestDiscoveryOutcome,
} from '@formcrash/contracts';

const mutationMethods = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);
type ExternalAssertionDraft = ExternalAssertion extends infer Assertion
  ? Assertion extends ExternalAssertion
    ? Omit<Assertion, 'id'>
    : never
  : never;

export function recommendAssertions(input: {
  readonly recipe: AssertionRecommendationRecipe;
  readonly candidate: RankedRequestCandidate | null;
  readonly discoveryOutcome: RequestDiscoveryOutcome;
  readonly target: RecordedJourneyStep;
  readonly normalAction: NormalActionObservation;
}): AssertionRecommendationSet {
  const recommendations: AssertionRecommendation[] = [];
  const limitations: string[] = [];
  const confidence =
    input.candidate?.recommended === true &&
    input.candidate.confidence === 'high' &&
    input.discoveryOutcome === 'recommended'
      ? 'high'
      : 'review';

  if (
    input.candidate !== null &&
    mutationMethods.has(input.candidate.method) &&
    input.candidate.classification === 'likely_business_mutation'
  ) {
    recommendations.push(
      recommendation({
        category: 'request_count',
        confidence,
        defaultEnabled: confidence === 'high',
        reasonCode: 'repeated_action_request_limit',
        explanation: `FormCrash observed one ${input.candidate.method} ${input.candidate.pathname} request during the normal recorded ${input.target.type} action. Because this recipe repeats the action ${input.recipe.triggerCount} times, it recommends bounding matching requests without claiming how many business records exist.`,
        evidenceIds: [
          input.candidate.candidateId,
          `recipe-${input.recipe.type}`,
          `target-${input.target.type}`,
        ],
        source: 'request_discovery',
        assertion: {
          type: 'network_request_max',
          maximum:
            input.recipe.type === 'server_duplicate_handling'
              ? input.recipe.triggerCount
              : 1,
          description:
            input.recipe.type === 'server_duplicate_handling'
              ? `No more than ${input.recipe.triggerCount} matching requests are sent.`
              : 'At most one matching request is sent.',
        },
      }),
      recommendation({
        category: 'response_outcome',
        confidence,
        defaultEnabled: confidence === 'high',
        reasonCode: 'repeated_action_success_limit',
        explanation:
          'The normal mutation completed once. During repeated triggering, FormCrash recommends allowing at most one successful matching response. This does not assert that exactly one database record exists.',
        evidenceIds: [
          input.candidate.candidateId,
          `recipe-${input.recipe.type}`,
          `target-${input.target.type}`,
        ],
        source: 'request_discovery',
        assertion: {
          type: 'network_success_max',
          maximum: 1,
          description: 'At most one matching request completes successfully.',
        },
      }),
      recommendation({
        category: 'server_error',
        confidence,
        defaultEnabled: confidence === 'high',
        reasonCode: 'repeated_action_no_server_error',
        explanation:
          'Repeated triggering should not turn the selected mutation into an HTTP 5xx response.',
        evidenceIds: [
          input.candidate.candidateId,
          `recipe-${input.recipe.type}`,
          `target-${input.target.type}`,
        ],
        source: 'recipe',
        assertion: {
          type: 'network_no_server_errors',
          description: 'No matching response returns HTTP 5xx.',
        },
      }),
    );

    if (
      !input.candidate.failed &&
      input.candidate.status !== null &&
      input.candidate.status >= 200 &&
      input.candidate.status < 400
    ) {
      const allowedStatuses =
        input.recipe.type === 'server_duplicate_handling'
          ? [...new Set([input.candidate.status, 409])]
          : [input.candidate.status];
      recommendations.push(
        recommendation({
          category: 'response_outcome',
          confidence,
          defaultEnabled: confidence === 'high',
          reasonCode: 'observed_response_status',
          explanation: `The normal selected request completed with HTTP ${input.candidate.status}. FormCrash uses that observed status${allowedStatuses.includes(409) ? ' and the recipe-compatible duplicate response HTTP 409' : ''} as the narrow allowed set.`,
          evidenceIds: [input.candidate.candidateId],
          source: 'request_discovery',
          assertion: {
            type: 'network_all_status',
            allowedStatuses,
            description: `Every matching response uses ${allowedStatuses.join(' or ')}.`,
          },
        }),
      );
    } else {
      limitations.push(
        'The selected request did not produce a successful completed status, so no expected-success status assertion was recommended.',
      );
    }
  } else {
    limitations.push(
      'FormCrash did not have a selected mutation request, so it did not recommend request-count or response assertions.',
    );
  }

  if (
    input.normalAction.targetWasDisabledDuringPending === true &&
    input.normalAction.targetControlLocator !== null
  ) {
    recommendations.push(
      recommendation({
        category: 'submit_state',
        confidence: 'review',
        defaultEnabled: false,
        reasonCode: 'normal_action_disabled_pending',
        explanation:
          'The target control became disabled while the normal action was pending. Enable this check to require the same protection during repeated triggering.',
        evidenceIds: ['normal-action-target-disabled'],
        source: 'normal_action_state',
        assertion: {
          type: 'element_disabled',
          locator: input.normalAction.targetControlLocator,
          targetDescription: 'The triggering control',
          observationWindow: 'during_repeated_action',
          description:
            'The triggering control becomes disabled during repeated action.',
        },
      }),
    );
  } else {
    limitations.push(
      'FormCrash did not directly observe a stable target control becoming disabled while the normal action was pending.',
    );
  }

  const success = input.normalAction.elements.find(
    (element) =>
      element.classification === 'success' &&
      !element.visibleBefore &&
      element.visibleAfter,
  );
  if (success !== undefined) {
    recommendations.push(
      recommendation({
        category: 'success_interface',
        confidence: 'review',
        defaultEnabled: false,
        reasonCode: 'normal_success_indicator_appeared',
        explanation:
          'A stable success-classified element changed from hidden to visible after the normal action. FormCrash does not persist or assert its page text.',
        evidenceIds: [success.observationId],
        source: 'normal_interface_state',
        assertion: {
          type: 'element_visible',
          locator: success.locator,
          targetDescription: 'The observed success indicator',
          description: 'The observed success indicator becomes visible.',
        },
      }),
    );
  } else {
    limitations.push(
      'FormCrash did not observe a stable success indicator, so no success-interface assertion was recommended.',
    );
  }

  const error = input.normalAction.elements.find(
    (element) =>
      element.classification === 'error' &&
      !element.visibleBefore &&
      !element.visibleAfter,
  );
  if (error !== undefined) {
    recommendations.push(
      recommendation({
        category: 'error_interface',
        confidence: 'review',
        defaultEnabled: false,
        reasonCode: 'known_error_indicator_absent',
        explanation:
          'A stable error-classified element was known and remained hidden during the successful normal action.',
        evidenceIds: [error.observationId],
        source: 'normal_interface_state',
        assertion: {
          type: 'element_not_visible',
          locator: error.locator,
          targetDescription: 'The observed error indicator',
          description: 'The observed error indicator remains hidden.',
        },
      }),
    );
  }

  const safePathname = stablePathname(input.normalAction.finalPathname);
  if (safePathname !== null) {
    recommendations.push(
      recommendation({
        category: 'navigation',
        confidence: 'review',
        defaultEnabled: false,
        reasonCode: 'normal_final_pathname',
        explanation:
          safePathname === input.normalAction.finalPathname
            ? `The normal action finished on the stable pathname ${safePathname}. Query parameters are excluded.`
            : `The normal action finished on a pathname with a volatile segment. FormCrash reduced it to the stable prefix ${safePathname} and excluded query parameters.`,
        evidenceIds: [`pathname-${shortHash(safePathname)}`],
        source: 'normal_navigation',
        assertion: {
          type: 'final_url_contains',
          value: safePathname,
          description: `The final URL remains under ${safePathname}.`,
        },
      }),
    );
  } else {
    limitations.push(
      'The normal final pathname was missing or too dynamic to support a safe navigation assertion.',
    );
  }

  limitations.push(
    'FormCrash did not observe generic business-record state, so it did not recommend a database or created-record assertion.',
    'The current assertion model cannot prove that a success notification appeared only once.',
  );

  return assertionRecommendationSetSchema.parse({
    recipeType: input.recipe.type,
    selectedRequestCandidateId: input.candidate?.candidateId ?? null,
    recommendations,
    limitations: [...new Set(limitations)],
  });
}

function recommendation(input: {
  readonly assertion: ExternalAssertionDraft;
  readonly category: AssertionRecommendation['category'];
  readonly confidence: AssertionRecommendation['confidence'];
  readonly defaultEnabled: boolean;
  readonly reasonCode: string;
  readonly explanation: string;
  readonly evidenceIds: readonly string[];
  readonly source: AssertionRecommendation['evidence']['source'];
}): AssertionRecommendation {
  const identity = {
    assertion: input.assertion,
    category: input.category,
    reasonCode: input.reasonCode,
    evidenceIds: [...input.evidenceIds].sort(),
  };
  const suffix = shortHash(JSON.stringify(identity));
  return {
    recommendationId: `assertion-rec-${suffix}`,
    assertion: {
      ...input.assertion,
      id: `assertion-draft-${suffix}`,
    },
    category: input.category,
    confidence: input.confidence,
    defaultEnabled: input.defaultEnabled,
    reasonCode: input.reasonCode,
    explanation: input.explanation,
    evidence: {
      evidenceIds: [...input.evidenceIds],
      source: input.source,
    },
  };
}

function stablePathname(pathname: string | null): string | null {
  if (pathname === null || !pathname.startsWith('/')) return null;
  const segments = pathname.split('/').filter(Boolean);
  const volatileIndex = segments.findIndex(
    (segment) =>
      /^\d{4,}$/u.test(segment) ||
      /^[a-f0-9]{16,}$/iu.test(segment) ||
      /^[0-9a-f]{8}-[0-9a-f-]{27,}$/iu.test(segment) ||
      segment.includes('@') ||
      /(?:secret|token|password|credential|api[_-]?key)/iu.test(segment) ||
      segment.length > 40 ||
      /^[A-Za-z0-9_-]{24,}$/u.test(segment),
  );
  const stable =
    volatileIndex === -1 ? segments : segments.slice(0, volatileIndex);
  return stable.length === 0 ? null : `/${stable.join('/')}`;
}

function shortHash(value: string): string {
  return createHash('sha256').update(value).digest('hex').slice(0, 24);
}
