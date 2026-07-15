export type BrowserWorkload =
  | 'sample_execution'
  | 'recording'
  | 'replay'
  | 'auth_capture'
  | 'request_discovery'
  | 'external_experiment';

export class BrowserOwnershipConflictError extends Error {
  constructor(readonly activeWorkload: BrowserWorkload) {
    super(
      `Chromium is currently owned by ${activeWorkload.replace('_', ' ')}. Stop it or wait for it to finish.`,
    );
    this.name = 'BrowserOwnershipConflictError';
  }
}

export class BrowserOwnership {
  private active: BrowserWorkload | null = null;

  get activeWorkload(): BrowserWorkload | null {
    return this.active;
  }

  acquire(workload: BrowserWorkload): () => void {
    if (this.active !== null)
      throw new BrowserOwnershipConflictError(this.active);
    this.active = workload;
    let released = false;
    return () => {
      if (released) return;
      released = true;
      this.active = null;
    };
  }
}
