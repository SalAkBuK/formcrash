import { describe, expect, it } from 'vitest';

import type { ExternalExperimentVersion } from '@formcrash/contracts';

import {
  testSuiteCheckLabel,
  testSuiteRecipeLabel,
  testSuiteSortOrder,
} from '../src/features/projects/models/test-coverage';

describe('journey test suite presentation', () => {
  it('orders the three generated recipes consistently', () => {
    expect(testSuiteSortOrder(version(2, 0))).toBe(0);
    expect(testSuiteSortOrder(version(3, 100))).toBe(1);
    expect(testSuiteSortOrder(version(2, 300))).toBe(2);
  });

  it('only calls the delayed recipe server safety when network proof exists', () => {
    expect(testSuiteRecipeLabel(version(2, 300))).toBe('Delayed repeat');
    expect(testSuiteRecipeLabel(version(2, 300, true))).toBe('Server safety');
  });

  it('shows required browser checks separately from approved network proof', () => {
    expect(testSuiteCheckLabel(version(2, 300, true))).toBe('3/3 + network');
  });
});

function version(
  triggerCount: 2 | 3,
  intervalMs: 0 | 100 | 300,
  withNetwork = false,
): ExternalExperimentVersion {
  return {
    triggerCount,
    intervalMs,
    networkMatcher: withNetwork
      ? { method: 'POST', pathname: '/api/items', host: 'example.test' }
      : null,
    assertions: [
      { type: 'element_visible' },
      ...(withNetwork ? [{ type: 'network_request_max' }] : []),
    ],
    outcomeCheckSnapshot: { checks: [{}, {}] },
  } as ExternalExperimentVersion;
}
