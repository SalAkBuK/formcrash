import type { HttpHook } from '@formcrash/contracts';

import type { RunEventLog } from '../engine/event-log.js';

export class HttpHookError extends Error {
  constructor(
    readonly phase: 'before' | 'after',
    message: string,
  ) {
    super(message);
    this.name = 'HttpHookError';
  }
}

export async function executeHttpHook(
  phase: 'before' | 'after',
  hook: HttpHook,
  events: RunEventLog,
): Promise<void> {
  events.append('hook.started', {
    phase,
    method: hook.method,
    origin: new URL(hook.url).origin,
    pathname: new URL(hook.url).pathname,
  });
  try {
    const response = await fetch(hook.url, {
      method: hook.method,
      headers: {
        ...hook.headers,
        ...(hook.body === null ? {} : { 'content-type': 'application/json' }),
      },
      ...(hook.body === null ? {} : { body: JSON.stringify(hook.body) }),
      signal: AbortSignal.timeout(hook.timeoutMs),
    });
    if (!response.ok) {
      throw new Error(`Hook returned HTTP ${response.status}.`);
    }
    events.append('hook.completed', {
      phase,
      method: hook.method,
      origin: new URL(hook.url).origin,
      pathname: new URL(hook.url).pathname,
      status: response.status,
    });
  } catch {
    events.append('hook.failed', {
      phase,
      method: hook.method,
      origin: new URL(hook.url).origin,
      pathname: new URL(hook.url).pathname,
      message: 'The controlled HTTP hook did not complete successfully.',
    });
    throw new HttpHookError(
      phase,
      `The ${phase === 'before' ? 'before-run' : 'cleanup'} HTTP hook failed.`,
    );
  }
}
