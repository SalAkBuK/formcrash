import {
  discoveredRequestSchema,
  externalNetworkObservationSchema,
  type DiscoveredRequest,
  type ExternalNetworkObservation,
  type NetworkMatcher,
  type RecordedRequestEvidence,
  type RecordedJourneyStep,
} from '@formcrash/contracts';

import type { NetworkObservation } from '../recording/external-browser.js';

export class NetworkEvidenceCollector {
  private readonly observations = new Map<string, ExternalNetworkObservation>();
  private readonly startedAt = Date.now();
  private discoveryActionStartedAtMs: number | null = null;

  constructor(private readonly matcher: NetworkMatcher | null) {}

  observe(observation: NetworkObservation): void {
    if (observation.kind === 'started') {
      let url: URL;
      try {
        url = new URL(observation.url);
      } catch {
        return;
      }
      this.observations.set(
        observation.requestId,
        externalNetworkObservationSchema.parse({
          requestId: observation.requestId,
          method: observation.method,
          pathname: url.pathname,
          origin: url.origin,
          startedAtMs: Math.max(0, observation.timestampMs - this.startedAt),
          completedAtMs: null,
          status: null,
          failed: false,
          matched:
            this.matcher === null
              ? false
              : matchesRequest(this.matcher, observation.method, url),
        }),
      );
      return;
    }
    const current = this.observations.get(observation.requestId);
    if (current === undefined) return;
    this.observations.set(
      observation.requestId,
      externalNetworkObservationSchema.parse({
        ...current,
        completedAtMs: Math.max(
          current.startedAtMs,
          observation.timestampMs - this.startedAt,
        ),
        status: observation.status,
        failed: observation.failed,
      }),
    );
  }

  snapshot(): readonly ExternalNetworkObservation[] {
    const observations = [...this.observations.values()];
    return this.matcher === null
      ? observations.slice(0, 500)
      : observations.filter((item) => item.matched).slice(0, 500);
  }

  markDiscoveryActionStarted(timestampMs = Date.now()): void {
    this.discoveryActionStartedAtMs = Math.max(0, timestampMs - this.startedAt);
  }

  discoveryCandidates(): readonly DiscoveredRequest[] {
    const grouped = new Map<string, DiscoveredRequest>();
    for (const observation of this.observations.values()) {
      const key = [
        observation.method,
        observation.pathname,
        observation.origin,
        observation.status ?? 'pending',
      ].join('|');
      const current = grouped.get(key);
      if (current === undefined) {
        grouped.set(
          key,
          discoveredRequestSchema.parse({
            method: observation.method,
            pathname: observation.pathname,
            origin: observation.origin,
            status: observation.status,
            failed: observation.failed,
            relativeTimestampMs: Math.max(
              0,
              observation.startedAtMs - (this.discoveryActionStartedAtMs ?? 0),
            ),
            occurrences: 1,
          }),
        );
      } else {
        grouped.set(key, {
          ...current,
          failed: current.failed || observation.failed,
          occurrences: current.occurrences + 1,
        });
      }
    }
    return [...grouped.values()].sort((left, right) => {
      const methodPriority =
        mutationPriority(left.method) - mutationPriority(right.method);
      return methodPriority !== 0
        ? methodPriority
        : left.relativeTimestampMs - right.relativeTimestampMs ||
            left.origin.localeCompare(right.origin) ||
            left.pathname.localeCompare(right.pathname) ||
            (left.status ?? 1_000) - (right.status ?? 1_000);
    });
  }

  recordingEvidence(
    actions: readonly Pick<RecordedJourneyStep, 'id' | 'timestamp'>[],
  ): readonly RecordedRequestEvidence[] {
    const sortedActions = [...actions].sort(
      (left, right) => left.timestamp - right.timestamp,
    );
    const grouped = new Map<string, RecordedRequestEvidence>();
    for (const observation of this.observations.values()) {
      const absoluteStartedAt = this.startedAt + observation.startedAtMs;
      const action = [...sortedActions]
        .reverse()
        .find((candidate) => candidate.timestamp <= absoluteStartedAt);
      if (action === undefined) continue;
      const relativeTimestampMs = absoluteStartedAt - action.timestamp;
      if (relativeTimestampMs < 0 || relativeTimestampMs > 5_000) continue;
      const url = new URL(observation.origin);
      const key = [
        action.id,
        observation.method,
        observation.origin,
        observation.pathname,
        observation.status ?? 'pending',
        observation.failed,
      ].join('|');
      const current = grouped.get(key);
      if (current === undefined) {
        grouped.set(key, {
          actionStepId: action.id,
          method: observation.method,
          origin: observation.origin,
          host: url.host,
          pathname: observation.pathname,
          status: observation.status,
          failed: observation.failed,
          relativeTimestampMs,
          occurrences: 1,
          observedAt: new Date(absoluteStartedAt).toISOString(),
        });
      } else {
        grouped.set(key, {
          ...current,
          failed: current.failed || observation.failed,
          relativeTimestampMs: Math.min(
            current.relativeTimestampMs,
            relativeTimestampMs,
          ),
          occurrences: current.occurrences + 1,
        });
      }
    }
    return [...grouped.values()]
      .sort(
        (left, right) =>
          left.relativeTimestampMs - right.relativeTimestampMs ||
          left.method.localeCompare(right.method) ||
          left.origin.localeCompare(right.origin) ||
          left.pathname.localeCompare(right.pathname),
      )
      .slice(0, 500);
  }
}

function mutationPriority(method: string): number {
  return ['POST', 'PUT', 'PATCH', 'DELETE'].includes(method) ? 0 : 1;
}

export function matchesRequest(
  matcher: NetworkMatcher,
  method: string,
  url: URL,
): boolean {
  return (
    method.toUpperCase() === matcher.method.toUpperCase() &&
    url.pathname === matcher.pathname &&
    (matcher.host === null || url.host === matcher.host)
  );
}
