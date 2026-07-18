'use client';

import {
  isTerminalRunStatus,
  sseRunEventSchema,
  type PersistedRunDetail,
  type RunEventEnvelope,
} from '@formcrash/contracts';
import { useCallback, useEffect, useRef, useState } from 'react';

import { getRun, getRunEventsUrl } from '../api/get-run';
import { mergeRunEvents } from '../models/event-presentation';

export type ConnectionStatus =
  'connecting' | 'live' | 'reconnecting' | 'complete' | 'disconnected';

export interface LiveRunState {
  readonly connectionStatus: ConnectionStatus;
  readonly detail: PersistedRunDetail;
  readonly events: readonly RunEventEnvelope[];
  readonly liveError: string | null;
  readonly reload: () => Promise<void>;
}

const terminalEventTypes = new Set([
  'run.passed',
  'run.failed',
  'run.incomplete',
  'runner.error',
]);

const RECONCILE_INTERVAL_MS = 750;
const RECONCILE_TIMEOUT_MS = 20_000;

export function useLiveRun(initialRun: PersistedRunDetail): LiveRunState {
  const [detail, setDetail] = useState(initialRun);
  const [events, setEvents] = useState<readonly RunEventEnvelope[]>(
    initialRun.events,
  );
  const [connectionStatus, setConnectionStatus] = useState<ConnectionStatus>(
    isTerminalRunStatus(initialRun.status) ? 'complete' : 'connecting',
  );
  const [liveError, setLiveError] = useState<string | null>(null);
  const mounted = useRef(true);
  const currentRunId = useRef(initialRun.runId);
  const terminalPersisted = useRef(isTerminalRunStatus(initialRun.status));
  const lastProcessedSequence = useRef(lastSequence(initialRun.events));
  const processedSequences = useRef(
    new Set(initialRun.events.map((event) => event.sequence)),
  );
  const persistedTerminalStatus = isTerminalRunStatus(detail.status);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  const applyPersisted = useCallback((persisted: PersistedRunDetail) => {
    if (!mounted.current || persisted.runId !== currentRunId.current) {
      return false;
    }
    const terminal = isTerminalRunStatus(persisted.status);
    if (terminalPersisted.current && !terminal) return true;

    terminalPersisted.current = terminal;
    lastProcessedSequence.current = Math.max(
      lastProcessedSequence.current,
      lastSequence(persisted.events),
    );
    if (terminal) processedSequences.current.clear();
    for (const event of persisted.events) {
      processedSequences.current.add(event.sequence);
    }
    setDetail(persisted);
    setEvents((current) =>
      terminal
        ? persisted.events
        : mergePersistedEvents(current, persisted.events),
    );
    setLiveError(null);
    if (terminal) setConnectionStatus('complete');
    return terminal;
  }, []);

  const reload = useCallback(async () => {
    try {
      const persisted = await getRun(initialRun.runId);
      applyPersisted(persisted);
    } catch (error: unknown) {
      if (!mounted.current || terminalPersisted.current) return;
      setLiveError(
        error instanceof Error
          ? error.message
          : 'Persisted run state could not be reloaded.',
      );
    }
  }, [applyPersisted, initialRun.runId]);

  useEffect(() => {
    let active = true;
    let eventSource: EventSource | null = null;
    let reconcileTimer: ReturnType<typeof setTimeout> | null = null;
    let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
    let reconcileDeadline = 0;

    currentRunId.current = initialRun.runId;
    terminalPersisted.current = isTerminalRunStatus(detail.status);
    lastProcessedSequence.current = Math.max(
      lastProcessedSequence.current,
      lastSequence(detail.events),
    );

    if (terminalPersisted.current) {
      setConnectionStatus('complete');
      return () => {
        active = false;
      };
    }

    const clearTimer = (timer: ReturnType<typeof setTimeout> | null): null => {
      if (timer !== null) clearTimeout(timer);
      return null;
    };
    const closeSource = (): void => {
      if (eventSource === null) return;
      eventSource.removeEventListener('run-event', handleRunEvent);
      eventSource.close();
      eventSource = null;
    };
    const stopReconciliation = (): void => {
      reconcileTimer = clearTimer(reconcileTimer);
      reconnectTimer = clearTimer(reconnectTimer);
      reconcileDeadline = 0;
    };
    const finish = (): void => {
      stopReconciliation();
      closeSource();
    };
    const scheduleReconciliation = (): void => {
      if (!active || terminalPersisted.current) return;
      const remaining = reconcileDeadline - Date.now();
      if (remaining <= 0) {
        reconnectTimer = clearTimer(reconnectTimer);
        closeSource();
        setConnectionStatus('disconnected');
        setLiveError(
          'Live progress disconnected. Automatic reconciliation timed out; reload persisted state to check again.',
        );
        return;
      }
      reconcileTimer = clearTimer(reconcileTimer);
      reconcileTimer = setTimeout(
        () => void reconcile(true),
        Math.min(RECONCILE_INTERVAL_MS, remaining),
      );
    };
    const reconcile = async (bounded: boolean): Promise<void> => {
      if (!active || terminalPersisted.current) return;
      if (bounded && reconcileDeadline === 0) {
        reconcileDeadline = Date.now() + RECONCILE_TIMEOUT_MS;
      }
      try {
        const persisted = await getRun(initialRun.runId);
        if (!active) return;
        if (applyPersisted(persisted)) {
          finish();
          return;
        }
      } catch (error: unknown) {
        if (!active || terminalPersisted.current) return;
        setLiveError(
          error instanceof Error
            ? error.message
            : 'Persisted run state is temporarily unavailable.',
        );
      }
      if (bounded) scheduleReconciliation();
    };
    function handleRunEvent(message: Event): void {
      if (!active || !mounted.current || terminalPersisted.current) return;
      try {
        const data: unknown = (message as MessageEvent<unknown>).data;
        if (typeof data !== 'string') throw new Error('SSE data is not text.');
        const event = sseRunEventSchema.parse(JSON.parse(data));
        if (processedSequences.current.has(event.sequence)) return;
        processedSequences.current.add(event.sequence);
        lastProcessedSequence.current = Math.max(
          lastProcessedSequence.current,
          event.sequence,
        );
        setEvents((current) => mergeRunEvents(current, event));
        if (terminalEventTypes.has(event.eventType)) {
          setConnectionStatus('reconnecting');
          closeSource();
          void reconcile(true);
        }
      } catch {
        setLiveError(
          'A live event did not match the public run-event contract.',
        );
      }
    }
    const connect = (): void => {
      if (!active || terminalPersisted.current) return;
      if (reconcileDeadline !== 0 && Date.now() >= reconcileDeadline) {
        reconnectTimer = clearTimer(reconnectTimer);
        setConnectionStatus('disconnected');
        setLiveError(
          'Live progress disconnected. Automatic reconciliation timed out; reload persisted state to check again.',
        );
        return;
      }
      closeSource();
      const source = new EventSource(
        getRunEventsUrl(initialRun.runId, lastProcessedSequence.current),
      );
      eventSource = source;
      setConnectionStatus('connecting');
      source.onopen = () => {
        if (!active || eventSource !== source || terminalPersisted.current) {
          return;
        }
        stopReconciliation();
        setConnectionStatus('live');
        setLiveError(null);
        void reconcile(false);
      };
      source.addEventListener('run-event', handleRunEvent);
      source.onerror = () => {
        if (!active || eventSource !== source || terminalPersisted.current) {
          return;
        }
        setConnectionStatus('reconnecting');
        void reconcile(true);
        if (source.readyState === EventSource.CLOSED) {
          reconnectTimer = clearTimer(reconnectTimer);
          reconnectTimer = setTimeout(connect, RECONCILE_INTERVAL_MS);
        }
      };
    };

    connect();
    // Close the fetch/subscribe race even if the stream opened after the run
    // had already finalized and its terminal event was missed.
    void reconcile(false);

    return () => {
      active = false;
      finish();
    };
  }, [applyPersisted, initialRun.runId, persistedTerminalStatus]);

  return { connectionStatus, detail, events, liveError, reload };
}

function lastSequence(events: readonly RunEventEnvelope[]): number {
  return events.reduce(
    (highest, event) => Math.max(highest, event.sequence),
    0,
  );
}

function mergePersistedEvents(
  live: readonly RunEventEnvelope[],
  persisted: readonly RunEventEnvelope[],
): readonly RunEventEnvelope[] {
  const bySequence = new Map(live.map((event) => [event.sequence, event]));
  for (const event of persisted) bySequence.set(event.sequence, event);
  return [...bySequence.values()].sort(
    (left, right) => left.sequence - right.sequence,
  );
}
