'use client';

import type { PersistedRunDetail } from '@formcrash/contracts';
import Link from 'next/link';
import { useCallback, useEffect, useRef, useState } from 'react';

import { FormCrashApiError } from '../../../lib/api-client';
import { getRun } from '../api/get-run';
import { RunDetailView } from './run-detail-view';

export function RunDetailRoute({ runId }: { readonly runId: string }) {
  const [run, setRun] = useState<PersistedRunDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const mounted = useRef(true);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const detail = await getRun(runId);
      if (!mounted.current) return;
      setRun(detail);
      setNotFound(false);
      setError(null);
    } catch (loadError: unknown) {
      if (!mounted.current) return;
      if (loadError instanceof FormCrashApiError && loadError.status === 404) {
        setNotFound(true);
        setError(null);
      } else {
        setError(
          loadError instanceof Error
            ? loadError.message
            : 'The persisted run could not be loaded.',
        );
      }
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

  if (run !== null) return <RunDetailView initialRun={run} />;
  return (
    <main className="centered-state-shell">
      <section className="panel centered-state">
        <p className="eyebrow">Persisted run</p>
        {loading ? (
          <>
            <h1>Loading run evidence…</h1>
            <p role="status">Reading the authoritative run snapshot.</p>
          </>
        ) : notFound ? (
          <>
            <h1>Run not found</h1>
            <p>
              No persisted run exists for <code>{runId}</code>.
            </p>
          </>
        ) : (
          <>
            <h1>Run unavailable</h1>
            <p role="alert">{error}</p>
            <button
              className="button button-primary"
              type="button"
              onClick={() => void load()}
            >
              Try again
            </button>
          </>
        )}
        <Link href="/">Return to sample experiment</Link>
      </section>
    </main>
  );
}
