'use client';

import type {
  ExternalRunDetail,
  ExternalRunSummary,
} from '@formcrash/contracts';
import Link from 'next/link';
import { useCallback, useEffect, useRef, useState } from 'react';

import { FormCrashApiError } from '../../../lib/api-client';
import { getExternalRun, listExternalRuns } from '../api/external-experiments';
import { ExternalRunComparison } from './external-run-comparison';
import { ExternalRunResult } from './external-run-result';

export function ExternalRunDetailRoute({ runId }: { readonly runId: string }) {
  const [result, setResult] = useState<ExternalRunDetail | null>(null);
  const [runHistory, setRunHistory] = useState<readonly ExternalRunSummary[]>(
    [],
  );
  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const mounted = useRef(true);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const next = await getExternalRun(runId);
      if (!mounted.current) return;
      setResult(next);
      setNotFound(false);
      setError(null);
      void listExternalRuns(next.projectId)
        .then((history) => {
          if (mounted.current) setRunHistory(history.items);
        })
        .catch(() => {
          if (mounted.current) setRunHistory([]);
        });
    } catch (loadError: unknown) {
      if (!mounted.current) return;
      setNotFound(
        loadError instanceof FormCrashApiError && loadError.status === 404,
      );
      setError(
        loadError instanceof Error
          ? loadError.message
          : 'The persisted external run could not be loaded.',
      );
    } finally {
      if (mounted.current) setLoading(false);
    }
  }, [runId]);

  useEffect(() => {
    mounted.current = true;
    void load();
    return () => {
      mounted.current = false;
    };
  }, [load]);

  if (result !== null) {
    return (
      <main className="dashboard-shell external-result-shell">
        <header className="external-result-page-heading">
          <div>
            <p className="eyebrow">Saved run</p>
            <h1>Run {result.runId.slice(0, 8)}</h1>
          </div>
          <div className="journey-card-actions">
            <Link
              className="button button-secondary button-compact"
              href={`/projects/${result.projectId}/journeys/${result.journeyId}`}
            >
              Journey
            </Link>
            <Link
              className="button button-secondary button-compact"
              href={`/projects/${result.projectId}/tests/${result.experimentSnapshot.experimentId}`}
            >
              Test detail
            </Link>
            <Link
              className="button button-secondary button-compact"
              href={`/projects/${result.projectId}/runs`}
            >
              Project runs
            </Link>
          </div>
        </header>
        <ExternalRunResult eyebrow="Persisted result" result={result} />
        <details className="external-route-comparison">
          <summary>Compare with another run</summary>
          <ExternalRunComparison beforeRun={result} runs={runHistory} />
        </details>
      </main>
    );
  }

  return (
    <main className="centered-state-shell">
      <section className="panel centered-state">
        <p className="eyebrow">Persisted external run</p>
        <h1>
          {loading
            ? 'Loading run evidence…'
            : notFound
              ? 'Run not found'
              : 'Run unavailable'}
        </h1>
        {!loading ? <p role="alert">{error}</p> : null}
        {!loading && !notFound ? (
          <button
            className="button button-primary"
            onClick={() => void load()}
            type="button"
          >
            Try again
          </button>
        ) : null}
        <Link href="/runs">Return to runs</Link>
      </section>
    </main>
  );
}
