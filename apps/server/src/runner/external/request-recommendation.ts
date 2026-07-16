import { createHash } from 'node:crypto';

import {
  rankedRequestCandidateSchema,
  requestDiscoveryRecommendationSchema,
  type DiscoveredRequest,
  type RankedRequestCandidate,
  type RequestCandidateClassification,
  type RequestDiscoveryRecommendation,
  type RequestRecommendationReason,
} from '@formcrash/contracts';

const mutationMethods = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);
const backgroundTerms = new Set([
  'config',
  'configuration',
  'feature',
  'features',
  'flag',
  'flags',
  'health',
  'heartbeat',
  'metric',
  'metrics',
  'poll',
  'refresh',
  'session',
  'status',
]);
const ignoredSimilarityTerms = new Set([
  'action',
  'api',
  'button',
  'click',
  'create',
  'form',
  'new',
  'save',
  'submit',
  'update',
]);

export interface RankRequestCandidatesInput {
  readonly candidates: readonly DiscoveredRequest[];
  readonly targetOrigin: string;
  readonly journeyName: string;
  readonly targetStepName: string;
  readonly targetPathname: string;
}

export interface RankedRequestCandidates {
  readonly candidates: readonly RankedRequestCandidate[];
  readonly recommendation: RequestDiscoveryRecommendation;
}

interface ScoredCandidate {
  readonly candidate: DiscoveredRequest;
  readonly candidateId: string;
  readonly classification: RequestCandidateClassification;
  readonly score: number;
  readonly reasons: readonly RequestRecommendationReason[];
}

export function rankRequestCandidates(
  input: RankRequestCandidatesInput,
): RankedRequestCandidates {
  const mutationPaths = new Set(
    input.candidates
      .filter((candidate) => isMutation(candidate.method))
      .map((candidate) => candidate.pathname),
  );
  const scored = input.candidates
    .map((candidate) => scoreCandidate(candidate, input, mutationPaths))
    .sort(compareScoredCandidates);
  const plausible = scored.filter(isPlausible);
  const first = plausible[0];
  const second = plausible[1];
  const margin =
    first === undefined
      ? 0
      : second === undefined
        ? Number.POSITIVE_INFINITY
        : first.score - second.score;

  let recommendation: RequestDiscoveryRecommendation;
  if (first === undefined || first.score < 15) {
    recommendation = requestDiscoveryRecommendationSchema.parse({
      outcome: 'no_candidate',
      recommendedCandidateId: null,
      explanation:
        input.candidates.length === 0
          ? 'No browser request was observed after the selected action.'
          : 'FormCrash observed only static, analytics, background, or otherwise unsuitable traffic.',
    });
  } else if (isAmbiguousPair(first, second, margin)) {
    recommendation = requestDiscoveryRecommendationSchema.parse({
      outcome: 'ambiguous',
      recommendedCandidateId: null,
      explanation:
        'Multiple plausible state-changing requests have similar evidence. Select the intended business operation explicitly.',
    });
  } else if (isHighConfidence(first, input.targetOrigin, margin)) {
    recommendation = requestDiscoveryRecommendationSchema.parse({
      outcome: 'recommended',
      recommendedCandidateId: first.candidateId,
      explanation:
        'FormCrash found one same-origin successful state-changing request with a clear evidence lead.',
    });
  } else {
    recommendation = requestDiscoveryRecommendationSchema.parse({
      outcome: 'review',
      recommendedCandidateId: null,
      explanation:
        'One request appears strongest, but its method, origin, response, classification, or score margin requires review.',
    });
  }

  const ambiguousIds =
    recommendation.outcome === 'ambiguous'
      ? new Set(
          plausible
            .filter(
              (candidate) =>
                first !== undefined &&
                isMutation(candidate.candidate.method) &&
                first.score - candidate.score < 15,
            )
            .map((candidate) => candidate.candidateId),
        )
      : new Set<string>();
  return {
    candidates: scored.map((candidate, index) =>
      rankedRequestCandidateSchema.parse({
        ...candidate.candidate,
        candidateId: candidate.candidateId,
        rank: index + 1,
        score: candidate.score,
        classification: candidate.classification,
        confidence:
          recommendation.recommendedCandidateId === candidate.candidateId
            ? 'high'
            : ambiguousIds.has(candidate.candidateId)
              ? 'ambiguous'
              : 'review',
        recommended:
          recommendation.recommendedCandidateId === candidate.candidateId,
        reasons: candidate.reasons,
      }),
    ),
    recommendation,
  };
}

function scoreCandidate(
  candidate: DiscoveredRequest,
  input: RankRequestCandidatesInput,
  mutationPaths: ReadonlySet<string>,
): ScoredCandidate {
  const classification = classifyCandidate(candidate, mutationPaths);
  const reasons: RequestRecommendationReason[] = [];
  const add = (
    code: RequestRecommendationReason['code'],
    label: string,
    scoreImpact: number,
  ): void => {
    reasons.push({ code, label, scoreImpact });
  };

  if (isMutation(candidate.method)) {
    add('mutation_method', `${candidate.method} can change server state.`, 50);
  } else {
    add('read_only_method', `${candidate.method} is normally read-only.`, -25);
  }

  if (candidate.origin === input.targetOrigin) {
    add('same_origin', 'Request uses the target application origin.', 20);
  } else {
    add(
      'cross_origin',
      'Request uses a different origin from the target application.',
      -20,
    );
  }

  if (candidate.failed) {
    add('failed_request', 'The browser reported that the request failed.', -30);
  } else if (candidate.status === null) {
    add('missing_status', 'No completed response status was observed.', -12);
  } else if (candidate.status >= 200 && candidate.status < 400) {
    add(
      'successful_status',
      `HTTP ${candidate.status} is a successful response.`,
      15,
    );
  } else if (candidate.status >= 500) {
    add(
      'server_error_status',
      `HTTP ${candidate.status} is a server error response.`,
      -25,
    );
  }

  if (candidate.relativeTimestampMs <= 250) {
    add(
      'immediate_after_action',
      'Request began immediately after the selected action.',
      12,
    );
  } else if (candidate.relativeTimestampMs <= 1_000) {
    add(
      'soon_after_action',
      'Request began shortly after the selected action.',
      8,
    );
  } else {
    add(
      'delayed_after_action',
      'Request began well after the selected action.',
      candidate.relativeTimestampMs <= 3_000 ? 3 : -5,
    );
  }

  if (looksApiLike(candidate.pathname)) {
    add(
      'api_like_path',
      'Path resembles a resource-oriented application endpoint.',
      8,
    );
  }

  const actionOverlap = tokenOverlap(
    candidate.pathname,
    `${input.targetStepName} ${input.targetPathname}`,
  );
  if (actionOverlap > 0) {
    add(
      'action_path_similarity',
      'Path shares bounded terms with the selected action.',
      Math.min(12, actionOverlap * 6),
    );
  }
  const journeyOverlap = tokenOverlap(candidate.pathname, input.journeyName);
  if (journeyOverlap > 0) {
    add(
      'journey_path_similarity',
      'Path shares bounded terms with the journey name.',
      Math.min(8, journeyOverlap * 4),
    );
  }

  if (candidate.occurrences === 1) {
    add(
      'single_occurrence',
      'Request appeared once during the discovery action.',
      3,
    );
  } else {
    add(
      'repeated_occurrence',
      `Request appeared ${candidate.occurrences} times during discovery.`,
      candidate.occurrences === 2 ? 2 : -4,
    );
  }

  if (classification === 'background_refresh') {
    add(
      'background_refresh',
      'Request resembles a list refresh or background application request.',
      -30,
    );
  } else if (classification === 'analytics') {
    add(
      'analytics_endpoint',
      'Request resembles analytics, telemetry, advertising, or error reporting.',
      -100,
    );
  } else if (classification === 'static_asset') {
    add('static_asset', 'Request is a static browser asset.', -100);
  } else if (isBackgroundEndpoint(candidate.pathname)) {
    add(
      'background_endpoint',
      'Path resembles health, session, configuration, or polling traffic.',
      -30,
    );
  }

  return {
    candidate,
    candidateId: candidateIdentity(candidate),
    classification,
    score: reasons.reduce((total, reason) => total + reason.scoreImpact, 0),
    reasons,
  };
}

function classifyCandidate(
  candidate: DiscoveredRequest,
  mutationPaths: ReadonlySet<string>,
): RequestCandidateClassification {
  if (isStaticAssetPath(candidate.pathname)) return 'static_asset';
  if (isAnalyticsRequest(candidate)) return 'analytics';
  if (isBackgroundEndpoint(candidate.pathname)) return 'background_refresh';
  if (!isMutation(candidate.method) && mutationPaths.has(candidate.pathname)) {
    return 'background_refresh';
  }
  return isMutation(candidate.method) ? 'likely_business_mutation' : 'other';
}

function isHighConfidence(
  candidate: ScoredCandidate,
  targetOrigin: string,
  margin: number,
): boolean {
  return (
    candidate.classification === 'likely_business_mutation' &&
    isMutation(candidate.candidate.method) &&
    candidate.candidate.origin === targetOrigin &&
    !candidate.candidate.failed &&
    candidate.candidate.status !== null &&
    candidate.candidate.status >= 200 &&
    candidate.candidate.status < 400 &&
    candidate.score >= 75 &&
    margin >= 15
  );
}

function isAmbiguousPair(
  first: ScoredCandidate,
  second: ScoredCandidate | undefined,
  margin: number,
): boolean {
  return (
    second !== undefined &&
    first.score >= 45 &&
    second.score >= 45 &&
    isMutation(first.candidate.method) &&
    isMutation(second.candidate.method) &&
    first.classification === 'likely_business_mutation' &&
    second.classification === 'likely_business_mutation' &&
    margin < 15
  );
}

function isPlausible(candidate: ScoredCandidate): boolean {
  return !['analytics', 'static_asset', 'background_refresh'].includes(
    candidate.classification,
  );
}

function compareScoredCandidates(
  left: ScoredCandidate,
  right: ScoredCandidate,
): number {
  if (left.score !== right.score) return right.score - left.score;
  const classificationDifference =
    classificationPriority(left.classification) -
    classificationPriority(right.classification);
  if (classificationDifference !== 0) return classificationDifference;
  return (
    [
      left.candidate.method.localeCompare(right.candidate.method),
      left.candidate.origin.localeCompare(right.candidate.origin),
      left.candidate.pathname.localeCompare(right.candidate.pathname),
      (left.candidate.status ?? 1_000) - (right.candidate.status ?? 1_000),
      left.candidateId.localeCompare(right.candidateId),
    ].find((difference) => difference !== 0) ?? 0
  );
}

function classificationPriority(
  classification: RequestCandidateClassification,
): number {
  return [
    'likely_business_mutation',
    'other',
    'background_refresh',
    'analytics',
    'static_asset',
  ].indexOf(classification);
}

function candidateIdentity(candidate: DiscoveredRequest): string {
  const safeIdentity = [
    candidate.method,
    candidate.origin,
    candidate.pathname,
    candidate.status ?? 'pending',
  ].join('\u0000');
  return `request-${createHash('sha256').update(safeIdentity).digest('hex').slice(0, 24)}`;
}

function isMutation(method: string): boolean {
  return mutationMethods.has(method.toUpperCase());
}

function looksApiLike(pathname: string): boolean {
  const tokens = pathTokens(pathname);
  return (
    pathname.startsWith('/api/') ||
    pathname.startsWith('/graphql') ||
    (tokens.length > 0 && !isStaticAssetPath(pathname))
  );
}

function isBackgroundEndpoint(pathname: string): boolean {
  return pathTokens(pathname).some((token) => backgroundTerms.has(token));
}

function isAnalyticsRequest(candidate: DiscoveredRequest): boolean {
  const value = `${candidate.origin}${candidate.pathname}`.toLowerCase();
  return /(?:analytics|telemetry|segment|sentry|datadog|newrelic|mixpanel|amplitude|googletagmanager|google-analytics|doubleclick|advert|tracking|beacon)/u.test(
    value,
  );
}

export function isStaticAssetPath(pathname: string): boolean {
  return (
    pathname.startsWith('/_next/') ||
    pathname.startsWith('/assets/') ||
    /\.(?:avif|css|gif|ico|jpe?g|js|map|png|svg|webp|woff2?|ttf)$/iu.test(
      pathname,
    )
  );
}

function tokenOverlap(left: string, right: string): number {
  const leftTokens = new Set(
    tokenize(left).filter((token) => !ignoredSimilarityTerms.has(token)),
  );
  return new Set(
    tokenize(right).filter(
      (token) => !ignoredSimilarityTerms.has(token) && leftTokens.has(token),
    ),
  ).size;
}

function tokenize(value: string): readonly string[] {
  return value
    .toLowerCase()
    .split(/[^a-z0-9]+/u)
    .map(singularize)
    .filter((token) => token.length > 2);
}

function pathTokens(pathname: string): readonly string[] {
  return tokenize(pathname);
}

function singularize(value: string): string {
  return value.endsWith('s') && value.length > 4 ? value.slice(0, -1) : value;
}
