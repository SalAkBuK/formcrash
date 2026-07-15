import { sseRunEventSchema, type RunEventEnvelope } from '@formcrash/contracts';

export interface RunEventSubscription {
  readonly onEvent: (event: RunEventEnvelope) => void;
  readonly onTerminal: () => void;
  readonly onServerClose: () => void;
}

export class RunEventBroker {
  private readonly subscriptions = new Map<string, Set<RunEventSubscription>>();
  private closed = false;

  publish(eventInput: RunEventEnvelope): void {
    if (this.closed) return;
    const event = sseRunEventSchema.parse(eventInput);
    for (const subscription of this.subscriptions.get(event.runId) ?? []) {
      subscription.onEvent(event);
    }
  }

  complete(runId: string): void {
    if (this.closed) return;
    for (const subscription of this.subscriptions.get(runId) ?? []) {
      subscription.onTerminal();
    }
  }

  subscribe(runId: string, subscription: RunEventSubscription): () => void {
    if (this.closed) {
      subscription.onServerClose();
      return () => undefined;
    }
    const listeners = this.subscriptions.get(runId) ?? new Set();
    listeners.add(subscription);
    this.subscriptions.set(runId, listeners);

    return () => {
      listeners.delete(subscription);
      if (listeners.size === 0) this.subscriptions.delete(runId);
    };
  }

  subscriberCount(runId?: string): number {
    if (runId !== undefined) return this.subscriptions.get(runId)?.size ?? 0;
    return [...this.subscriptions.values()].reduce(
      (total, listeners) => total + listeners.size,
      0,
    );
  }

  close(): void {
    if (this.closed) return;
    this.closed = true;
    for (const listeners of this.subscriptions.values()) {
      for (const subscription of listeners) subscription.onServerClose();
    }
    this.subscriptions.clear();
  }
}
