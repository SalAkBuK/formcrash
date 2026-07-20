import {
  externalRunResultPresentationSchema,
  type ExternalAssertionResult,
  type ExternalNetworkObservation,
  type ExternalOutcomeCheckResult,
  type ExternalRunCheckPresentation,
  type ExternalRunnerError,
  type ExternalRunLifecycleStatus,
  type ExternalRunPresentationCondition,
  type ExternalRunResultPresentation,
  type OutcomeAggregate,
  type OutcomeCheck,
  type OutcomeCheckRunSnapshot,
  type OutcomeEvidenceReferences,
  type RunArtifact,
  type RunEventEnvelope,
} from '@formcrash/contracts';

import { describeOutcomeCheck } from './outcome-check-semantics.js';

const DATABASE_UNKNOWN =
  'FormCrash did not inspect the application database or hidden backend state.';

export function presentExternalRun(input: {
  readonly lifecycleStatus: ExternalRunLifecycleStatus;
  readonly outcomeAggregate: OutcomeAggregate;
  readonly triggerAttempts: number;
  readonly snapshot: OutcomeCheckRunSnapshot;
  readonly results: readonly ExternalOutcomeCheckResult[];
  readonly observations: readonly ExternalNetworkObservation[];
  readonly assertions: readonly ExternalAssertionResult[];
  readonly events: readonly RunEventEnvelope[];
  readonly artifacts: readonly RunArtifact[];
  readonly runnerError: ExternalRunnerError | null;
}): ExternalRunResultPresentation {
  const checksById = new Map(
    input.snapshot.checks.map((check) => [check.id, check]),
  );
  const checks = input.results
    .map((result) =>
      presentCheck(result, checksById.get(result.outcomeCheckId)),
    )
    .sort(
      (left, right) => checkPriority(left.type) - checkPriority(right.type),
    );
  const primaryStatus =
    input.lifecycleStatus === 'runner_error' || input.runnerError !== null
      ? 'runner_error'
      : input.outcomeAggregate;
  const definingCheck = selectDefiningCheck(primaryStatus, checks);
  const evidenceReferences = mergeEvidenceReferences(
    input.results.map((result) => result.evidenceReferences),
  );
  const observedFacts = observations(input, evidenceReferences);
  const unknowns = uniqueBounded([
    ...input.results.flatMap((result) => result.unknowns),
    ...(input.results.length > 0 ? [DATABASE_UNKNOWN] : []),
  ]);

  return externalRunResultPresentationSchema.parse({
    primaryStatus,
    headline: primaryHeadline(primaryStatus, definingCheck),
    outcomeSummary: outcomeSummary(primaryStatus, checks, input.runnerError),
    approvedExpectedOutcomeDescription:
      definingCheck?.approvedDescription ?? null,
    expectedCondition: definingCheck?.expectedCondition ?? null,
    observedCondition: definingCheck?.observedCondition ?? null,
    templateBinding: definingCheck?.templateBinding ?? null,
    observations: observedFacts,
    conclusion: conclusion(primaryStatus, definingCheck),
    whyItMatters: whyItMatters(primaryStatus, definingCheck),
    unknowns,
    protectionSuggestions: protectionSuggestions(
      primaryStatus,
      definingCheck,
      input.triggerAttempts,
    ),
    evidenceReferences,
    technicalDetailsAvailable: {
      assertions: input.assertions.length > 0,
      requests: input.observations.length > 0,
      events: input.events.length > 0,
      screenshots: input.artifacts.length > 0,
    },
    checks,
  });
}

function presentCheck(
  result: ExternalOutcomeCheckResult,
  check: OutcomeCheck | undefined,
): ExternalRunCheckPresentation {
  return {
    outcomeCheckId: result.outcomeCheckId,
    type: result.type,
    approvedDescription: bounded(
      check === undefined
        ? 'Approved Outcome Check'
        : describeOutcomeCheck(check),
      500,
    ),
    status: result.status,
    headline: checkHeadline(result),
    expectedCondition: expectedCondition(result, check),
    observedCondition: observedCondition(result),
    templateBinding: result.templateBinding,
    reason: result.reason === null ? null : bounded(result.reason, 1_000),
    evidenceReferences: result.evidenceReferences,
  };
}

function expectedCondition(
  result: ExternalOutcomeCheckResult,
  check: OutcomeCheck | undefined,
): ExternalRunPresentationCondition {
  if (result.type === 'matching_item_appears_exactly_once') {
    return {
      kind: 'visible_match_count',
      count: 1,
      description: 'Exactly 1 visible matching result.',
    };
  }
  if (result.type === 'visible_element_exists') {
    return {
      kind: 'approved_target_visibility',
      visible: true,
      visibleMatchCount: null,
      description: 'The approved target should be visible.',
    };
  }
  const pathname =
    check?.type === 'final_pathname_matches'
      ? check.expectedPathname
      : readPathname(result.expected);
  return pathname === null
    ? {
        kind: 'unavailable',
        description: 'The approved expected pathname is unavailable.',
      }
    : {
        kind: 'pathname',
        pathname,
        description: pathname,
      };
}

function observedCondition(
  result: ExternalOutcomeCheckResult,
): ExternalRunPresentationCondition {
  const unavailable =
    result.reason ?? 'The observed browser-visible condition is unavailable.';
  if (result.type === 'matching_item_appears_exactly_once') {
    return {
      kind: 'visible_match_count',
      count: result.observedCount,
      description:
        result.observedCount === null
          ? bounded(unavailable, 500)
          : `${result.observedCount} visible matching result${result.observedCount === 1 ? '' : 's'}.`,
    };
  }
  if (result.type === 'visible_element_exists') {
    return {
      kind: 'approved_target_visibility',
      visible: result.observedCount === null ? null : result.observedCount > 0,
      visibleMatchCount: result.observedCount,
      description:
        result.observedCount === null
          ? bounded(unavailable, 500)
          : `${result.observedCount} visible match${result.observedCount === 1 ? '' : 'es'}.`,
    };
  }
  const pathname = readPathname(result.observed);
  return pathname === null
    ? {
        kind: 'unavailable',
        description: bounded(unavailable, 1_000),
      }
    : {
        kind: 'pathname',
        pathname,
        description: pathname,
      };
}

function checkHeadline(result: ExternalOutcomeCheckResult): string {
  if (result.status === 'could_not_verify') {
    return 'Could not verify the approved outcome.';
  }
  if (result.type === 'matching_item_appears_exactly_once') {
    if (result.status === 'passed') {
      return 'Passed: The intended result occurred exactly once.';
    }
    if (result.observedCount === 0) {
      return 'Failed: The expected result did not appear.';
    }
    if (result.observedCount === 2) {
      return 'Failed: The expected result appeared twice instead of once.';
    }
    if (result.observedCount !== null && result.observedCount > 1) {
      return `Failed: The expected result appeared ${result.observedCount} times instead of once.`;
    }
    return 'Failed: The intended exact-once result was not observed.';
  }
  if (result.type === 'visible_element_exists') {
    return result.status === 'passed'
      ? 'Passed: The expected confirmation was visible.'
      : 'Failed: The expected confirmation was not visible.';
  }
  return result.status === 'passed'
    ? 'Passed: The journey ended at the expected pathname.'
    : 'Failed: The journey ended on a different page.';
}

function primaryHeadline(
  status: ExternalRunResultPresentation['primaryStatus'],
  definingCheck: ExternalRunCheckPresentation | undefined,
): string {
  if (status === 'runner_error') {
    return 'FormCrash could not complete the journey.';
  }
  if (status === 'could_not_verify') {
    return 'FormCrash completed the experiment but could not reliably verify the expected outcome.';
  }
  if (status === 'not_configured') {
    return 'This run has technical evidence, but no approved Outcome Check was configured.';
  }
  return (
    definingCheck?.headline ??
    (status === 'passed'
      ? 'Passed: All approved outcomes occurred.'
      : 'Failed: An approved outcome did not occur.')
  );
}

function outcomeSummary(
  status: ExternalRunResultPresentation['primaryStatus'],
  checks: readonly ExternalRunCheckPresentation[],
  runnerError: ExternalRunnerError | null,
): string {
  if (status === 'runner_error') {
    return bounded(
      runnerError?.message ??
        'The runner stopped before the journey could complete.',
      1_000,
    );
  }
  if (status === 'failed') {
    const failed = checks.filter((check) => check.status === 'failed').length;
    return `${failed} of ${checks.length} approved Outcome Check${checks.length === 1 ? '' : 's'} failed.`;
  }
  if (status === 'could_not_verify') {
    const reason = checks.find(
      (check) => check.status === 'could_not_verify',
    )?.reason;
    return bounded(
      reason ?? 'At least one approved Outcome Check could not be verified.',
      1_000,
    );
  }
  if (status === 'not_configured') {
    return 'Technical assertions and captured evidence remain available below, but they do not establish an approved application outcome.';
  }
  return `All ${checks.length} approved Outcome Check${checks.length === 1 ? '' : 's'} passed.`;
}

function observations(
  input: Parameters<typeof presentExternalRun>[0],
  evidenceReferences: OutcomeEvidenceReferences,
): ExternalRunResultPresentation['observations'] {
  const facts: ExternalRunResultPresentation['observations'][number][] = [];
  const criticalAction = input.snapshot.criticalAction;
  if (criticalAction !== null && input.triggerAttempts > 0) {
    facts.push({
      kind: 'action',
      text: `FormCrash triggered "${bounded(criticalAction.label, 160)}" ${countAdverb(input.triggerAttempts)}.`,
      evidenceReferences: {
        ...emptyEvidenceReferences(),
        triggerEventIds: evidenceReferences.triggerEventIds,
      },
    });
  }

  const referencedRequests = new Set(evidenceReferences.requestObservationIds);
  const successfulRequests = input.observations.filter(
    (observation) =>
      referencedRequests.has(observation.requestId) &&
      observation.matched &&
      observation.completedAtMs !== null &&
      observation.status !== null &&
      observation.status >= 200 &&
      observation.status < 400 &&
      !observation.failed,
  );
  if (successfulRequests.length > 0) {
    facts.push({
      kind: 'request',
      text: `${countWord(successfulRequests.length)} matching request${successfulRequests.length === 1 ? '' : 's'} completed successfully.`,
      evidenceReferences: {
        ...emptyEvidenceReferences(),
        requestObservationIds: successfulRequests.map(
          (observation) => observation.requestId,
        ),
      },
    });
  }

  for (const result of input.results) {
    const text = browserObservation(result);
    if (text !== null) {
      facts.push({
        kind: 'browser',
        text,
        evidenceReferences: result.evidenceReferences,
      });
    }
  }
  return facts.slice(0, 20);
}

function browserObservation(result: ExternalOutcomeCheckResult): string | null {
  if (result.status === 'could_not_verify') return null;
  if (result.type === 'matching_item_appears_exactly_once') {
    if (result.observedCount === null) return null;
    return `${countWord(result.observedCount)} visible result${result.observedCount === 1 ? '' : 's'} matched the approved generated identity.`;
  }
  if (result.type === 'visible_element_exists') {
    if (result.observedCount === null) return null;
    return result.observedCount > 0
      ? 'The approved browser target was visible.'
      : 'The approved browser target was not visible.';
  }
  const pathname = readPathname(result.observed);
  return pathname === null
    ? null
    : `The journey ended at pathname ${pathname}.`;
}

function conclusion(
  status: ExternalRunResultPresentation['primaryStatus'],
  check: ExternalRunCheckPresentation | undefined,
): string | null {
  if (status === 'runner_error' || status === 'not_configured') return null;
  if (status === 'could_not_verify') {
    return 'The available evidence does not support a reliable pass or fail conclusion for every approved Outcome Check.';
  }
  if (check === undefined) return null;
  if (check.type === 'matching_item_appears_exactly_once') {
    const count = conditionCount(check.observedCondition);
    if (status === 'passed') {
      return 'The approved exact-once browser-visible outcome passed.';
    }
    return count === null
      ? 'The approved exact-once browser-visible outcome failed.'
      : `The approved exact-once outcome failed because ${countWord(count)} visible result${count === 1 ? '' : 's'} matched the generated identity.`;
  }
  if (check.type === 'visible_element_exists') {
    return status === 'passed'
      ? 'The approved browser-visible confirmation was present.'
      : 'The approved browser-visible confirmation was absent.';
  }
  return status === 'passed'
    ? 'The final pathname matched the developer-approved pathname.'
    : 'The final pathname did not match the developer-approved pathname.';
}

function whyItMatters(
  status: ExternalRunResultPresentation['primaryStatus'],
  check: ExternalRunCheckPresentation | undefined,
): string | null {
  if (status !== 'failed' || check === undefined) return null;
  if (check.type === 'matching_item_appears_exactly_once') {
    const count = conditionCount(check.observedCondition);
    return count !== null && count > 1
      ? 'Repeated submission can leave the user with duplicate visible results for one intended action.'
      : 'The action completed without producing the browser-visible result the developer approved as evidence of success.';
  }
  if (check.type === 'final_pathname_matches') {
    return 'The journey did not reach the approved final location.';
  }
  return 'The journey did not show the browser-visible confirmation the developer approved as evidence of success.';
}

function protectionSuggestions(
  status: ExternalRunResultPresentation['primaryStatus'],
  check: ExternalRunCheckPresentation | undefined,
  triggerAttempts: number,
): ExternalRunResultPresentation['protectionSuggestions'] {
  if (
    status !== 'failed' ||
    check?.type !== 'matching_item_appears_exactly_once' ||
    (conditionCount(check.observedCondition) ?? 0) <= 1 ||
    triggerAttempts <= 1
  ) {
    return [];
  }
  return [
    {
      area: 'frontend',
      text: 'Prevent additional submission synchronously when the first submission begins.',
    },
    {
      area: 'backend',
      text: 'Use idempotency or an appropriate business-level uniqueness rule.',
    },
  ];
}

function selectDefiningCheck(
  status: ExternalRunResultPresentation['primaryStatus'],
  checks: readonly ExternalRunCheckPresentation[],
): ExternalRunCheckPresentation | undefined {
  if (status === 'failed') {
    return checks.find((check) => check.status === 'failed');
  }
  if (status === 'could_not_verify' || status === 'runner_error') {
    return checks.find((check) => check.status === 'could_not_verify');
  }
  return checks[0];
}

function checkPriority(type: ExternalRunCheckPresentation['type']): number {
  if (type === 'matching_item_appears_exactly_once') return 0;
  if (type === 'visible_element_exists') return 1;
  return 2;
}

function conditionCount(
  condition: ExternalRunPresentationCondition,
): number | null {
  return condition.kind === 'visible_match_count' ? condition.count : null;
}

function readPathname(value: unknown): string | null {
  if (typeof value !== 'object' || value === null || !('pathname' in value)) {
    return null;
  }
  const pathname = value.pathname;
  return typeof pathname === 'string' && pathname.startsWith('/')
    ? pathname.slice(0, 2_000)
    : null;
}

function mergeEvidenceReferences(
  references: readonly OutcomeEvidenceReferences[],
): OutcomeEvidenceReferences {
  return {
    triggerEventIds: unique(
      references.flatMap((item) => item.triggerEventIds),
    ).slice(0, 3),
    requestObservationIds: unique(
      references.flatMap((item) => item.requestObservationIds),
    ).slice(0, 100),
    screenshotArtifactIds: unique(
      references.flatMap((item) => item.screenshotArtifactIds),
    ).slice(0, 3),
    runnerEventIds: unique(
      references.flatMap((item) => item.runnerEventIds),
    ).slice(0, 20),
  };
}

function emptyEvidenceReferences(): OutcomeEvidenceReferences {
  return {
    triggerEventIds: [],
    requestObservationIds: [],
    screenshotArtifactIds: [],
    runnerEventIds: [],
  };
}

function unique(values: readonly string[]): string[] {
  return [...new Set(values)];
}

function uniqueBounded(values: readonly string[]): string[] {
  return unique(
    values.map((value) => bounded(value, 500)).filter(Boolean),
  ).slice(0, 20);
}

function bounded(value: string, maximum: number): string {
  return value.replace(/\s+/gu, ' ').trim().slice(0, maximum) || 'Unavailable.';
}

function countWord(count: number): string {
  if (count === 0) return 'No';
  if (count === 1) return 'One';
  if (count === 2) return 'Two';
  if (count === 3) return 'Three';
  return String(count);
}

function countAdverb(count: number): string {
  if (count === 1) return 'once';
  if (count === 2) return 'twice';
  return `${count} times`;
}
