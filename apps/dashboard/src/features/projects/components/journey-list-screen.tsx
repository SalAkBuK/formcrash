'use client';

import Link from 'next/link';
import { useEffect, useMemo, useState } from 'react';
import type { PersistedJourney } from '@formcrash/contracts';

import { StateMessage } from '../../../components/ui/state-message';
import { StatusBadge } from '../../../components/ui/status-badge';
import { formatLocalDateTime } from '../../../lib/formatters';
import { listJourneys } from '../api/projects';

export function JourneyListScreen({
  projectId,
}: {
  readonly projectId: string;
}) {
  const [journeys, setJourneys] = useState<readonly PersistedJourney[]>([]);
  const [query, setQuery] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let active = true;
    void listJourneys(projectId)
      .then((items) => {
        if (active) setJourneys(items);
      })
      .catch((reason: unknown) => {
        if (active) setError(messageOf(reason));
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [projectId]);

  const groups = useMemo(() => {
    const normalized = query.trim().toLowerCase();
    const grouped = new Map<string, PersistedJourney[]>();
    for (const journey of journeys) {
      if (normalized !== '' && !journey.name.toLowerCase().includes(normalized))
        continue;
      const group = grouped.get(journey.name) ?? [];
      group.push(journey);
      grouped.set(journey.name, group);
    }
    return [...grouped.values()];
  }, [journeys, query]);

  return (
    <main className="dashboard-shell crm-screen">
      <header className="crm-page-heading crm-compact-heading">
        <div>
          <p className="eyebrow">Journey directory</p>
          <h2>Journeys</h2>
          <p>Saved browser paths grouped by name with immutable versions.</p>
        </div>
        <Link
          className="button button-primary"
          href={`/projects/${projectId}/journeys/new`}
        >
          Record journey
        </Link>
      </header>

      {error !== null ? (
        <StateMessage variant="error">{error}</StateMessage>
      ) : null}
      <section className="panel crm-list-panel">
        <div className="crm-list-toolbar">
          <div>
            <h3>Saved journeys</h3>
            <span>{groups.length} journey groups</span>
          </div>
          <label>
            <span className="visually-hidden">Search journeys</span>
            <input
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Search journeys"
              type="search"
              value={query}
            />
          </label>
        </div>
        {loading ? (
          <StateMessage variant="loading">Loading journeys…</StateMessage>
        ) : groups.length === 0 ? (
          <div className="empty-state">
            <h3>
              {journeys.length === 0
                ? 'No journeys recorded'
                : 'No matching journeys'}
            </h3>
            <p>
              {journeys.length === 0
                ? 'Record a successful browser path to create the first immutable version.'
                : 'Try a different search.'}
            </p>
            {journeys.length === 0 ? (
              <Link
                className="button button-primary"
                href={`/projects/${projectId}/journeys/new`}
              >
                Record journey
              </Link>
            ) : null}
          </div>
        ) : (
          <div className="crm-table-wrap">
            <table className="crm-table">
              <thead>
                <tr>
                  <th>Journey</th>
                  <th>Latest version</th>
                  <th>Steps</th>
                  <th>Capture</th>
                  <th>Created</th>
                  <th aria-label="Actions" />
                </tr>
              </thead>
              <tbody>
                {groups.map((versions) => {
                  const latest = versions[0]!;
                  return (
                    <tr key={latest.name}>
                      <td data-label="Journey">
                        <Link
                          className="crm-primary-link"
                          href={`/projects/${projectId}/journeys/${latest.id}`}
                        >
                          <strong>{latest.name}</strong>
                          <span>
                            {versions.length} immutable version
                            {versions.length === 1 ? '' : 's'}
                          </span>
                        </Link>
                      </td>
                      <td data-label="Latest version">
                        Version {latest.version}
                      </td>
                      <td data-label="Steps">{latest.steps.length}</td>
                      <td data-label="Capture">
                        <StatusBadge
                          tone={
                            latest.replayFormat === 'hybrid-v2'
                              ? 'browser'
                              : 'neutral'
                          }
                        >
                          {latest.replayFormat ?? 'semantic'}
                        </StatusBadge>
                      </td>
                      <td data-label="Created">
                        {formatLocalDateTime(latest.createdAt)}
                      </td>
                      <td data-label="Actions">
                        <Link
                          className="button button-secondary button-compact"
                          href={`/projects/${projectId}/journeys/${latest.id}`}
                        >
                          Open
                        </Link>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </main>
  );
}

function messageOf(reason: unknown): string {
  return reason instanceof Error
    ? reason.message
    : 'Journeys could not be loaded.';
}
