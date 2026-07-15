import type { CreatedOrdersAssertionResult } from '../sample/types.js';

export function evaluateMaxCreatedOrders(
  observedCount: number,
): CreatedOrdersAssertionResult {
  const passed = observedCount <= 1;

  return {
    assertionType: 'max_created_orders',
    expectedMaximum: 1,
    observedCount,
    status: passed ? 'passed' : 'failed',
    expectedDescription: 'No more than one order should be created.',
    observedDescription: `${observedCount} order${observedCount === 1 ? '' : 's'} were created.`,
  };
}

export function createNotEvaluatedAssertion(): CreatedOrdersAssertionResult {
  return {
    assertionType: 'max_created_orders',
    expectedMaximum: 1,
    observedCount: null,
    status: 'not_evaluated',
    expectedDescription: 'No more than one order should be created.',
    observedDescription: 'The application state could not be evaluated.',
  };
}
