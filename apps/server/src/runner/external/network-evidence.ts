import {
  discoveredRequestSchema,
  externalNetworkObservationSchema,
  type DiscoveredRequest,
  type ExternalNetworkObservation,
  type NetworkMatcher,
} from '@formcrash/contracts';

import type { NetworkObservation } from '../recording/external-browser.js';

export class NetworkEvidenceCollector {
  private readonly observations = new Map<string, ExternalNetworkObservation>();
  private readonly startedAt = Date.now();

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

  discoveryCandidates(): readonly DiscoveredRequest[] {
    const grouped = new Map<string, DiscoveredRequest>();
    for (const observation of this.observations.values()) {
      if (isStaticAsset(observation.pathname)) continue;
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
            relativeTimestampMs: observation.startedAtMs,
            occurrences: 1,
          }),
        );
      } else {
        grouped.set(key, { ...current, occurrences: current.occurrences + 1 });
      }
    }
    return [...grouped.values()].sort((left, right) => {
      const methodPriority =
        mutationPriority(left.method) - mutationPriority(right.method);
      return methodPriority !== 0
        ? methodPriority
        : left.relativeTimestampMs - right.relativeTimestampMs;
    });
  }
}

function mutationPriority(method: string): number {
  return ['POST', 'PUT', 'PATCH', 'DELETE'].includes(method) ? 0 : 1;
}

function isStaticAsset(pathname: string): boolean {
  return (
    pathname.startsWith('/_next/') ||
    pathname.startsWith('/assets/') ||
    /\.(?:avif|css|gif|ico|jpe?g|js|map|png|svg|webp|woff2?|ttf)$/iu.test(
      pathname,
    )
  );
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
