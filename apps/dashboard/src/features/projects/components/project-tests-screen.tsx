'use client';

import Link from 'next/link';
import { useEffect, useMemo, useState } from 'react';
import type { ExternalExperimentVersion } from '@formcrash/contracts';

import { StateMessage } from '../../../components/ui/state-message';
import { StatusBadge } from '../../../components/ui/status-badge';
import { formatLocalDateTime } from '../../../lib/formatters';
import { listProjectExternalExperiments } from '../api/external-experiments';

export function ProjectTestsScreen({
  projectId,
}: {
  readonly projectId: string;
}) {
  const [versions, setVersions] = useState<
    readonly ExternalExperimentVersion[]
  >([]);
  const [query, setQuery] = useState('');
  const [mode, setMode] = useState('all');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    void listProjectExternalExperiments(projectId)
      .then((items) => {
        if (active) setVersions(items);
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
    const grouped = new Map<string, ExternalExperimentVersion[]>();
    for (const version of versions) {
      if (mode !== 'all' && (mode === 'guided') !== version.guided) continue;
      if (
        normalized !== '' &&
        !`${version.name} ${version.journeySnapshot.name}`
          .toLowerCase()
          .includes(normalized)
      )
        continue;
      const group = grouped.get(version.experimentId) ?? [];
      group.push(version);
      grouped.set(version.experimentId, group);
    }
    return [...grouped.values()];
  }, [mode, query, versions]);

  return (
    <main className="dashboard-shell crm-screen">
      <header className="crm-page-heading crm-compact-heading">
        <div>
          <p className="eyebrow">Test directory</p>
          <h2>Tests</h2>
          <p>Repeated-action tests grouped across immutable versions.</p>
        </div>
        <Link
          className="button button-primary"
          href={`/projects/${projectId}/tests/new?step=outcome`}
        >
          Configure test
        </Link>
      </header>
      {error !== null ? (
        <StateMessage variant="error">{error}</StateMessage>
      ) : null}
      <section className="panel crm-list-panel">
        <div className="crm-list-toolbar">
          <div>
            <h3>Saved tests</h3>
            <span>{groups.length} test groups</span>
          </div>
          <div className="crm-list-filters">
            <label>
              <span className="visually-hidden">Search tests</span>
              <input
                onChange={(event) => setQuery(event.target.value)}
                placeholder="Search tests"
                type="search"
                value={query}
              />
            </label>
            <select
              aria-label="Filter test mode"
              onChange={(event) => setMode(event.target.value)}
              value={mode}
            >
              <option value="all">All modes</option>
              <option value="guided">Guided</option>
              <option value="advanced">Advanced</option>
            </select>
          </div>
        </div>
        {loading ? (
          <StateMessage variant="loading">Loading tests…</StateMessage>
        ) : groups.length === 0 ? (
          <div className="empty-state">
            <h3>
              {versions.length === 0
                ? 'No tests configured'
                : 'No matching tests'}
            </h3>
            <p>
              {versions.length === 0
                ? 'Start with Guided mode to define an outcome, review safety, and create the first test.'
                : 'Adjust the filters to see more tests.'}
            </p>
            {versions.length === 0 ? (
              <Link
                className="button button-primary"
                href={`/projects/${projectId}/tests/new?step=outcome`}
              >
                Configure test
              </Link>
            ) : null}
          </div>
        ) : (
          <div className="crm-table-wrap">
            <table className="crm-table">
              <thead>
                <tr>
                  <th>Test</th>
                  <th>Journey</th>
                  <th>Mode</th>
                  <th>Latest version</th>
                  <th>Assertions</th>
                  <th>Created</th>
                  <th aria-label="Actions" />
                </tr>
              </thead>
              <tbody>
                {groups.map((items) => {
                  const latest = items[0]!;
                  return (
                    <tr key={latest.experimentId}>
                      <td data-label="Test">
                        <Link
                          className="crm-primary-link"
                          href={`/projects/${projectId}/tests/${latest.id}`}
                        >
                          <strong>{latest.name}</strong>
                          <span>
                            Impatient User · {latest.triggerCount} triggers
                          </span>
                        </Link>
                      </td>
                      <td data-label="Journey">
                        <Link
                          href={`/projects/${projectId}/journeys/${latest.journeyId}`}
                        >
                          {latest.journeySnapshot.name} v
                          {latest.journeySnapshot.version}
                        </Link>
                      </td>
                      <td data-label="Mode">
                        <StatusBadge tone={latest.guided ? 'pass' : 'neutral'}>
                          {latest.guided ? 'Guided' : 'Advanced'}
                        </StatusBadge>
                      </td>
                      <td data-label="Latest version">
                        Version {latest.version} · {items.length} total
                      </td>
                      <td data-label="Assertions">
                        {latest.assertions.length}
                      </td>
                      <td data-label="Created">
                        {formatLocalDateTime(latest.createdAt)}
                      </td>
                      <td data-label="Actions">
                        <Link
                          className="button button-secondary button-compact"
                          href={`/projects/${projectId}/tests/${latest.id}`}
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
    : 'Tests could not be loaded.';
}
