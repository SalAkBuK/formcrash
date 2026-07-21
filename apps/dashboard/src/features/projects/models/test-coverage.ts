import type { ExternalExperimentVersion } from '@formcrash/contracts';

const NETWORK_ASSERTION_PREFIX = 'network_';

export function hasEvaluatedNetworkCoverage(
  version: ExternalExperimentVersion,
): boolean {
  return (
    version.networkMatcher !== null &&
    version.assertions.some((assertion) =>
      assertion.type.startsWith(NETWORK_ASSERTION_PREFIX),
    )
  );
}

export function testCoverageLabel(
  version: ExternalExperimentVersion,
): 'Browser and network coverage' | 'Browser outcome coverage only' {
  return hasEvaluatedNetworkCoverage(version)
    ? 'Browser and network coverage'
    : 'Browser outcome coverage only';
}

export function testRecipeLabel(version: ExternalExperimentVersion): string {
  if (version.triggerCount === 2 && version.intervalMs === 0)
    return 'Accidental double-click';
  if (version.triggerCount === 3 && version.intervalMs === 100)
    return 'Impatient triple-click';
  if (version.triggerCount === 2 && version.intervalMs === 300)
    return 'Delayed repeated action';
  return 'Custom repeated action';
}

export function testSuiteRecipeLabel(
  version: ExternalExperimentVersion,
): string {
  if (version.triggerCount === 2 && version.intervalMs === 0)
    return 'Double-click';
  if (version.triggerCount === 3 && version.intervalMs === 100)
    return 'Triple-click';
  if (version.triggerCount === 2 && version.intervalMs === 300)
    return hasEvaluatedNetworkCoverage(version)
      ? 'Server safety'
      : 'Delayed repeat';
  return 'Custom';
}

export function testSuiteCheckLabel(
  version: ExternalExperimentVersion,
): string {
  const outcomeCount = version.outcomeCheckSnapshot.checks.length;
  const technicalCount = version.assertions.filter(
    (assertion) => !assertion.type.startsWith(NETWORK_ASSERTION_PREFIX),
  ).length;
  const configuredCount = outcomeCount + technicalCount;
  return `${configuredCount}/${configuredCount}${hasEvaluatedNetworkCoverage(version) ? ' + network' : ''}`;
}

export function testSuiteSortOrder(version: ExternalExperimentVersion): number {
  if (version.triggerCount === 2 && version.intervalMs === 0) return 0;
  if (version.triggerCount === 3 && version.intervalMs === 100) return 1;
  if (version.triggerCount === 2 && version.intervalMs === 300) return 2;
  return 3;
}

export function testCheckCoverageLabel(
  version: ExternalExperimentVersion,
): string {
  const outcomeCount = version.outcomeCheckSnapshot.checks.length;
  const technicalCount = version.assertions.filter(
    (assertion) => !assertion.type.startsWith(NETWORK_ASSERTION_PREFIX),
  ).length;
  return `${outcomeCount} required Outcome Check${outcomeCount === 1 ? '' : 's'} · ${technicalCount} custom technical check${technicalCount === 1 ? '' : 's'}`;
}
