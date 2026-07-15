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

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  const reload = useCallback(async () => {
    try {
      const persisted = await getRun(initialRun.runId);
      if (!mounted.current) return;
      setDetail(persisted);
      setEvents(persisted.events);
      setLiveError(null);
      if (isTerminalRunStatus(persisted.status)) {
        setConnectionStatus('complete');
      }
    } catch (error: unknown) {
      if (!mounted.current) return;
      setLiveError(
        error instanceof Error
          ? error.message
          : 'Persisted run state could not be reloaded.',
      );
    }
  }, [initialRun.runId]);

  useEffect(() => {
    let active = true;
    if (isTerminalRunStatus(initialRun.status)) {
      setConnectionStatus('complete');
      return () => {
        active = false;
      };
    }

    const eventSource = new EventSource(getRunEventsUrl(initialRun.runId));
    setConnectionStatus('connecting');
    eventSource.onopen = () => {
      if (!active || !mounted.current) return;
      setConnectionStatus('live');
      setLiveError(null);
    };
    const handleRunEvent = (message: Event) => {
      if (!active || !mounted.current) return;
      try {
        const data: unknown = (message as MessageEvent<unknown>).data;
        if (typeof data !== 'string') throw new Error('SSE data is not text.');
        const event = sseRunEventSchema.parse(JSON.parse(data));
        setEvents((current) => mergeRunEvents(current, event));
        if (terminalEventTypes.has(event.eventType)) {
          eventSource.close();
          setConnectionStatus('complete');
          void reload();
        }
      } catch {
        setLiveError(
          'A live event did not match the public run-event contract.',
        );
      }
    };
    eventSource.addEventListener('run-event', handleRunEvent);
    eventSource.onerror = () => {
      if (!active || !mounted.current) return;
      const disconnected = eventSource.readyState === EventSource.CLOSED;
      setConnectionStatus(disconnected ? 'disconnected' : 'reconnecting');
      if (disconnected) void reload();
    };

    return () => {
      active = false;
      eventSource.removeEventListener('run-event', handleRunEvent);
      eventSource.close();
    };
  }, [initialRun.runId, initialRun.status, reload]);

  return { connectionStatus, detail, events, liveError, reload };
}
