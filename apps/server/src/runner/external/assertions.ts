import { randomUUID } from 'node:crypto';

import type {
  ExternalAssertion,
  ExternalAssertionResult,
  ExternalNetworkObservation,
} from '@formcrash/contracts';

import type { RunEventLog } from '../engine/event-log.js';
import type { ReplayBrowserSession } from '../recording/external-browser.js';
import { resolveTemplate, type ResolvedRuntime } from './runtime-values.js';

export async function evaluateExternalAssertions(input: {
  readonly assertions: readonly ExternalAssertion[];
  readonly session: ReplayBrowserSession;
  readonly observations: readonly ExternalNetworkObservation[];
  readonly runtime: ResolvedRuntime;
  readonly events: RunEventLog;
  readonly disabledDuringRepeatedActionAssertionIds?: ReadonlySet<string>;
}): Promise<readonly ExternalAssertionResult[]> {
  const results: ExternalAssertionResult[] = [];
  for (const assertion of input.assertions) {
    input.events.append('assertion.evaluating', {
      assertionId: assertion.id,
      assertionType: assertion.type,
      description: assertion.description,
    });
    let result: ExternalAssertionResult;
    try {
      result = await evaluateOne(assertion, input);
    } catch {
      result = createResult(assertion, 'error', {
        expected: assertion.description,
        observed: 'The assertion could not be evaluated.',
      });
    }
    results.push(result);
    input.events.append(`assertion.${result.status}`, {
      assertionId: result.assertionId,
      assertionType: result.type,
      observedDescription: result.observedDescription,
    });
  }
  return results;
}

async function evaluateOne(
  assertion: ExternalAssertion,
  input: {
    readonly session: ReplayBrowserSession;
    readonly observations: readonly ExternalNetworkObservation[];
    readonly runtime: ResolvedRuntime;
    readonly disabledDuringRepeatedActionAssertionIds?: ReadonlySet<string>;
  },
): Promise<ExternalAssertionResult> {
  const matched = input.observations.filter((item) => item.matched);
  switch (assertion.type) {
    case 'network_request_max': {
      const count = matched.length;
      return createResult(
        assertion,
        count <= assertion.maximum ? 'passed' : 'failed',
        {
          expected: `No more than ${assertion.maximum} matching browser request${assertion.maximum === 1 ? '' : 's'} should occur.`,
          observed: `${count} matching browser request${count === 1 ? '' : 's'} occurred.`,
        },
      );
    }
    case 'network_request_exact': {
      const count = matched.length;
      return createResult(
        assertion,
        count === assertion.expected ? 'passed' : 'failed',
        {
          expected: `Exactly ${assertion.expected} matching browser request${assertion.expected === 1 ? '' : 's'} should occur.`,
          observed: `${count} matching browser request${count === 1 ? '' : 's'} occurred.`,
        },
      );
    }
    case 'network_success_max': {
      const count = matched.filter(isSuccessful).length;
      return createResult(
        assertion,
        count <= assertion.maximum ? 'passed' : 'failed',
        {
          expected: `No more than ${assertion.maximum} successful matching response${assertion.maximum === 1 ? '' : 's'} should occur.`,
          observed: `${count} successful matching response${count === 1 ? '' : 's'} occurred.`,
        },
      );
    }
    case 'network_success_exact': {
      const count = matched.filter(isSuccessful).length;
      return createResult(
        assertion,
        count === assertion.expected ? 'passed' : 'failed',
        {
          expected: `Exactly ${assertion.expected} successful matching response${assertion.expected === 1 ? '' : 's'} should occur.`,
          observed: `${count} successful matching response${count === 1 ? '' : 's'} occurred.`,
        },
      );
    }
    case 'network_expected_status': {
      const found = matched.some(
        (item) => item.status === assertion.expectedStatus,
      );
      return createResult(assertion, found ? 'passed' : 'failed', {
        expected: `At least one matching response should have HTTP ${assertion.expectedStatus}.`,
        observed: found
          ? `A matching HTTP ${assertion.expectedStatus} response was observed.`
          : `No matching HTTP ${assertion.expectedStatus} response was observed.`,
      });
    }
    case 'network_all_status': {
      const unexpected = matched.filter(
        (item) =>
          item.status === null ||
          !assertion.allowedStatuses.includes(item.status),
      );
      return createResult(
        assertion,
        matched.length > 0 && unexpected.length === 0 ? 'passed' : 'failed',
        {
          expected: `Every matching response should have one of these statuses: ${assertion.allowedStatuses.join(', ')}.`,
          observed:
            matched.length === 0
              ? 'No matching responses were observed.'
              : unexpected.length === 0
                ? `All ${matched.length} matching responses had an allowed status.`
                : `${unexpected.length} of ${matched.length} matching responses had a missing or unexpected status.`,
        },
      );
    }
    case 'network_no_server_errors': {
      const errors = matched.filter(
        (item) => item.status !== null && item.status >= 500,
      );
      return createResult(
        assertion,
        matched.length > 0 && errors.length === 0 ? 'passed' : 'failed',
        {
          expected: 'No matching response should return HTTP 5xx.',
          observed:
            matched.length === 0
              ? 'No matching responses were observed.'
              : errors.length === 0
                ? `No server errors occurred across ${matched.length} matching responses.`
                : `${errors.length} matching response${errors.length === 1 ? '' : 's'} returned HTTP 5xx.`,
        },
      );
    }
    case 'element_visible': {
      const visible = await input.session.isVisible(assertion.locator);
      return createResult(assertion, visible ? 'passed' : 'failed', {
        expected: `${assertion.targetDescription} should become visible.`,
        observed: visible
          ? `${assertion.targetDescription} was visible.`
          : `${assertion.targetDescription} was missing or not visible.`,
      });
    }
    case 'element_not_visible': {
      const visible = await input.session.isVisible(assertion.locator);
      return createResult(assertion, visible ? 'failed' : 'passed', {
        expected: `${assertion.targetDescription} should not become visible.`,
        observed: visible
          ? `${assertion.targetDescription} was visible.`
          : `${assertion.targetDescription} was missing or not visible.`,
      });
    }
    case 'element_disabled': {
      const disabled =
        assertion.observationWindow === 'during_repeated_action'
          ? (input.disabledDuringRepeatedActionAssertionIds?.has(
              assertion.id,
            ) ?? false)
          : await input.session.isDisabled(assertion.locator);
      return createResult(assertion, disabled ? 'passed' : 'failed', {
        expected:
          assertion.observationWindow === 'during_repeated_action'
            ? `${assertion.targetDescription} should become disabled during repeated triggering.`
            : `${assertion.targetDescription} should become disabled.`,
        observed: disabled
          ? assertion.observationWindow === 'during_repeated_action'
            ? `${assertion.targetDescription} was observed disabled during repeated triggering.`
            : `${assertion.targetDescription} was disabled.`
          : assertion.observationWindow === 'during_repeated_action'
            ? `${assertion.targetDescription} was not observed disabled during repeated triggering.`
            : `${assertion.targetDescription} was missing or remained enabled.`,
      });
    }
    case 'text_appeared': {
      const text = resolveTemplate(
        assertion.text,
        input.runtime.values,
        input.runtime.context,
      );
      const visible = await input.session.textVisible(text);
      return createResult(assertion, visible ? 'passed' : 'failed', {
        expected: 'The selected text should appear.',
        observed: visible
          ? 'The selected text appeared.'
          : 'The selected text was missing or not visible.',
      });
    }
    case 'field_retained': {
      const expected =
        assertion.expectedValue.kind === 'safe'
          ? resolveTemplate(
              assertion.expectedValue.value,
              input.runtime.values,
              input.runtime.context,
            )
          : input.runtime.values.get(assertion.expectedValue.variableName)
              ?.value;
      if (expected === undefined)
        throw new Error('Expected variable is unavailable.');
      const observed = await input.session.inputValue(assertion.locator);
      const retained = observed === expected;
      return createResult(assertion, retained ? 'passed' : 'failed', {
        expected: `${assertion.targetDescription} should retain its configured value.`,
        observed: retained
          ? `${assertion.targetDescription} retained its configured value.`
          : observed === null
            ? `${assertion.targetDescription} was missing or was not a field.`
            : `${assertion.targetDescription} did not retain its configured value.`,
      });
    }
    case 'final_url_contains': {
      const value = resolveTemplate(
        assertion.value,
        input.runtime.values,
        input.runtime.context,
      );
      const matchedUrl = input.session.currentUrl().includes(value);
      return createResult(assertion, matchedUrl ? 'passed' : 'failed', {
        expected: 'The final URL should contain the configured value.',
        observed: matchedUrl
          ? 'The final URL contained the configured value.'
          : 'The final URL did not contain the configured value.',
      });
    }
    case 'final_url_not_contains': {
      const value = resolveTemplate(
        assertion.value,
        input.runtime.values,
        input.runtime.context,
      );
      const matchedUrl = input.session.currentUrl().includes(value);
      return createResult(assertion, matchedUrl ? 'failed' : 'passed', {
        expected: 'The final URL should not contain the configured value.',
        observed: matchedUrl
          ? 'The final URL contained the prohibited value.'
          : 'The final URL did not contain the prohibited value.',
      });
    }
  }
}

function isSuccessful(observation: ExternalNetworkObservation): boolean {
  return (
    observation.status !== null &&
    observation.status >= 200 &&
    observation.status < 400 &&
    !observation.failed
  );
}

function createResult(
  assertion: ExternalAssertion,
  status: ExternalAssertionResult['status'],
  descriptions: { readonly expected: string; readonly observed: string },
): ExternalAssertionResult {
  return {
    assertionResultId: randomUUID(),
    assertionId: assertion.id,
    type: assertion.type,
    status,
    description: assertion.description,
    expectedDescription: descriptions.expected,
    observedDescription: descriptions.observed,
    evaluatedAt: new Date().toISOString(),
  };
}
