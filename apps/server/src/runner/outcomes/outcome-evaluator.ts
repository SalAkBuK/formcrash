import { randomUUID } from 'node:crypto';

import {
  externalOutcomeCheckResultSchema,
  type ExternalNetworkObservation,
  type ExternalOutcomeCheckResult,
  type OutcomeAggregate,
  type OutcomeCheckRunSnapshot,
  type OutcomeEvidenceReferences,
  type RunArtifact,
  type RunEventEnvelope,
} from '@formcrash/contracts';

import type { ReplayBrowserSession } from '../recording/external-browser.js';
import {
  redactSensitiveText,
  resolveTemplateValue,
  type ResolvedRuntime,
} from '../external/runtime-values.js';

const BROWSER_ONLY_UNKNOWN =
  'FormCrash evaluated browser-visible state only; database records, hidden records, and backend side effects were not inspected.';

export async function evaluateOutcomeChecks(input: {
  readonly runId: string;
  readonly snapshot: OutcomeCheckRunSnapshot;
  readonly session: ReplayBrowserSession;
  readonly runtime: ResolvedRuntime;
  readonly events: readonly RunEventEnvelope[];
  readonly observations: readonly ExternalNetworkObservation[];
  readonly artifacts: readonly RunArtifact[];
}): Promise<readonly ExternalOutcomeCheckResult[]> {
  const evidenceReferences = references(input);
  const results: ExternalOutcomeCheckResult[] = [];
  for (const check of input.snapshot.checks) {
    const evaluatedAt = new Date().toISOString();
    try {
      if (check.type === 'final_pathname_matches') {
        const expectedPathname = normalizePathname(check.expectedPathname);
        const observedPathname = sanitizeObservedPathname(
          normalizeBrowserPathname(input.session.currentUrl()),
          input.snapshot,
          input.runtime,
        );
        results.push(
          externalOutcomeCheckResultSchema.parse({
            outcomeCheckResultId: randomUUID(),
            runId: input.runId,
            outcomeCheckId: check.id,
            journeyId: check.journeyId,
            criticalActionId: check.criticalActionId,
            type: check.type,
            expected: { pathname: expectedPathname },
            observed: { pathname: observedPathname },
            expectedCount: null,
            observedCount: null,
            status: observedPathname === expectedPathname ? 'passed' : 'failed',
            reason:
              observedPathname === expectedPathname
                ? null
                : 'The final browser pathname did not match the approved pathname.',
            evidenceReferences,
            templateBinding: null,
            unknowns: [BROWSER_ONLY_UNKNOWN],
            evaluatedAt,
          }),
        );
        continue;
      }

      if (input.session.countVisibleMatches === undefined) {
        throw new Error(
          'The browser session cannot perform bounded visible-match evaluation.',
        );
      }
      const binding =
        check.type === 'matching_item_appears_exactly_once'
          ? resolveTemplateValue(
              check.binding.template,
              input.runtime.values,
              input.runtime.context,
            ).value
          : undefined;
      const matchCount = await input.session.countVisibleMatches(
        check.target.locator,
        binding,
      );
      if (matchCount.truncated) {
        results.push(
          externalOutcomeCheckResultSchema.parse({
            outcomeCheckResultId: randomUUID(),
            runId: input.runId,
            outcomeCheckId: check.id,
            journeyId: check.journeyId,
            criticalActionId: check.criticalActionId,
            type: check.type,
            expected:
              check.type === 'matching_item_appears_exactly_once'
                ? {
                    visibleMatchCount: 1,
                    description: check.description,
                    template: check.binding.template,
                  }
                : { visible: true, description: check.description },
            observed: {
              verified: false,
              examinedLocatorMatchCount: matchCount.examinedCount,
              visibleMatchesWithinLimit: matchCount.visibleCount,
              totalLocatorMatchCount: matchCount.totalLocatorMatchCount,
              evaluationLimit: 100,
            },
            expectedCount:
              check.type === 'matching_item_appears_exactly_once' ? 1 : null,
            observedCount: null,
            status: 'could_not_verify',
            reason:
              'More than 100 elements matched the approved locator; FormCrash did not evaluate a complete visible-match count.',
            evidenceReferences,
            templateBinding:
              check.type === 'matching_item_appears_exactly_once'
                ? check.binding
                : null,
            unknowns: [BROWSER_ONLY_UNKNOWN],
            evaluatedAt,
          }),
        );
        continue;
      }
      const observedCount = matchCount.visibleCount;
      const expectedCount =
        check.type === 'matching_item_appears_exactly_once' ? 1 : null;
      const passed =
        expectedCount === null ? observedCount >= 1 : observedCount === 1;
      results.push(
        externalOutcomeCheckResultSchema.parse({
          outcomeCheckResultId: randomUUID(),
          runId: input.runId,
          outcomeCheckId: check.id,
          journeyId: check.journeyId,
          criticalActionId: check.criticalActionId,
          type: check.type,
          expected:
            check.type === 'matching_item_appears_exactly_once'
              ? {
                  visibleMatchCount: 1,
                  description: check.description,
                  template: check.binding.template,
                }
              : { visible: true, description: check.description },
          observed: {
            visibleMatchCount: observedCount,
            description:
              expectedCount === null
                ? `${observedCount} visible element(s) matched the approved locator.`
                : `${observedCount} visible item(s) matched the approved generated identity.`,
          },
          expectedCount,
          observedCount,
          status: passed ? 'passed' : 'failed',
          reason: passed
            ? null
            : expectedCount === null
              ? 'No visible element matched the approved locator.'
              : `Expected exactly one visible matching item; observed ${observedCount}.`,
          evidenceReferences,
          templateBinding:
            check.type === 'matching_item_appears_exactly_once'
              ? check.binding
              : null,
          unknowns: [BROWSER_ONLY_UNKNOWN],
          evaluatedAt,
        }),
      );
    } catch {
      results.push(
        externalOutcomeCheckResultSchema.parse({
          outcomeCheckResultId: randomUUID(),
          runId: input.runId,
          outcomeCheckId: check.id,
          journeyId: check.journeyId,
          criticalActionId: check.criticalActionId,
          type: check.type,
          expected:
            check.type === 'final_pathname_matches'
              ? { pathname: check.expectedPathname }
              : check.type === 'matching_item_appears_exactly_once'
                ? { visibleMatchCount: 1, template: check.binding.template }
                : { visible: true },
          observed: { verified: false },
          expectedCount:
            check.type === 'matching_item_appears_exactly_once' ? 1 : null,
          observedCount: null,
          status: 'could_not_verify',
          reason:
            'The approved browser-visible condition could not be evaluated reliably.',
          evidenceReferences,
          templateBinding:
            check.type === 'matching_item_appears_exactly_once'
              ? check.binding
              : null,
          unknowns: [BROWSER_ONLY_UNKNOWN],
          evaluatedAt,
        }),
      );
    }
  }
  return results;
}

export function aggregateOutcomeChecks(
  results: readonly ExternalOutcomeCheckResult[],
): OutcomeAggregate {
  if (results.length === 0) return 'not_configured';
  if (results.some((result) => result.status === 'failed')) return 'failed';
  if (results.some((result) => result.status === 'could_not_verify')) {
    return 'could_not_verify';
  }
  return 'passed';
}

export function createUnverifiedOutcomeResults(input: {
  readonly runId: string;
  readonly snapshot: OutcomeCheckRunSnapshot;
  readonly events: readonly RunEventEnvelope[];
  readonly observations: readonly ExternalNetworkObservation[];
  readonly artifacts: readonly RunArtifact[];
  readonly reason: string;
}): readonly ExternalOutcomeCheckResult[] {
  const evidenceReferences = references(input);
  return input.snapshot.checks.map((check) =>
    externalOutcomeCheckResultSchema.parse({
      outcomeCheckResultId: randomUUID(),
      runId: input.runId,
      outcomeCheckId: check.id,
      journeyId: check.journeyId,
      criticalActionId: check.criticalActionId,
      type: check.type,
      expected:
        check.type === 'final_pathname_matches'
          ? { pathname: check.expectedPathname }
          : check.type === 'matching_item_appears_exactly_once'
            ? { visibleMatchCount: 1, template: check.binding.template }
            : { visible: true },
      observed: { verified: false, evidenceBoundary: 'browser_visible_only' },
      expectedCount:
        check.type === 'matching_item_appears_exactly_once' ? 1 : null,
      observedCount: null,
      status: 'could_not_verify',
      reason: input.reason.slice(0, 1_000),
      evidenceReferences,
      templateBinding:
        check.type === 'matching_item_appears_exactly_once'
          ? check.binding
          : null,
      unknowns: [BROWSER_ONLY_UNKNOWN],
      evaluatedAt: new Date().toISOString(),
    }),
  );
}

export function normalizePathname(value: string): string {
  return new URL(value, 'https://formcrash.invalid').pathname;
}

function normalizeBrowserPathname(value: string): string {
  const parsed = new URL(value);
  if (!['http:', 'https:'].includes(parsed.protocol)) {
    throw new Error('Unsupported browser URL context.');
  }
  return parsed.pathname;
}

function sanitizeObservedPathname(
  pathname: string,
  snapshot: OutcomeCheckRunSnapshot,
  runtime: ResolvedRuntime,
): string {
  let sanitized = redactSensitiveText(pathname, runtime);
  for (const check of snapshot.checks) {
    if (check.type !== 'matching_item_appears_exactly_once') continue;
    const resolved = resolveTemplateValue(
      check.binding.template,
      runtime.values,
      runtime.context,
    ).value;
    if (resolved !== '') {
      sanitized = sanitized
        .replaceAll(resolved, '[GENERATED_VALUE]')
        .replaceAll(encodeURIComponent(resolved), '[GENERATED_VALUE]');
    }
  }
  return sanitized.slice(0, 2_000);
}

function references(input: {
  readonly events: readonly RunEventEnvelope[];
  readonly observations: readonly ExternalNetworkObservation[];
  readonly artifacts: readonly RunArtifact[];
}): OutcomeEvidenceReferences {
  const triggerEvents = input.events.filter(
    (event) => event.eventType === 'experiment.triggered',
  );
  return {
    triggerEventIds: triggerEvents.map((event) => event.eventId),
    requestObservationIds: input.observations
      .filter((observation) => observation.matched)
      .map((observation) => observation.requestId)
      .slice(0, 100),
    screenshotArtifactIds: input.artifacts
      .map((artifact) => artifact.artifactId)
      .slice(0, 3),
    runnerEventIds: input.events
      .filter((event) =>
        ['experiment.injected', 'run.evaluating'].includes(event.eventType),
      )
      .map((event) => event.eventId),
  };
}
