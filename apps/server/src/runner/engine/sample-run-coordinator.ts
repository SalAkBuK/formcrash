import {
  startSampleRunAcceptedSchema,
  type SampleRunMode,
  type StartSampleRunAccepted,
} from '@formcrash/contracts';

import type { SampleRunExecutor } from '../sample/types.js';

export class ActiveSampleRunError extends Error {
  constructor() {
    super(
      'A browser run is already active. Wait for it to finish before retrying.',
    );
    this.name = 'ActiveSampleRunError';
  }
}

export interface SampleRunCoordinatorOptions {
  readonly onAsyncError?: (error: unknown, runId: string) => void;
}

export class SampleRunCoordinator {
  private active = false;
  private activeCompletion: Promise<void> | null = null;

  constructor(
    private readonly executor: SampleRunExecutor,
    private readonly options: SampleRunCoordinatorOptions = {},
  ) {}

  get isActive(): boolean {
    return this.active;
  }

  start(mode: SampleRunMode): StartSampleRunAccepted {
    if (this.active) throw new ActiveSampleRunError();
    this.active = true;

    let execution: ReturnType<SampleRunExecutor['prepare']>;
    try {
      execution = this.executor.prepare(mode);
    } catch (error: unknown) {
      this.active = false;
      throw error;
    }

    const runId = execution.runId;
    const completion = new Promise<void>((resolve) => {
      setImmediate(resolve);
    })
      .then(async () => execution.execute())
      .then(() => undefined)
      .catch((error: unknown) => {
        this.reportAsyncError(error, runId);
      })
      .finally(() => {
        this.active = false;
        this.activeCompletion = null;
      });
    this.activeCompletion = completion;

    return startSampleRunAcceptedSchema.parse({
      runId,
      status: 'created',
      detailUrl: `/api/runs/${runId}`,
      eventsUrl: `/api/runs/${runId}/events`,
    });
  }

  async waitForIdle(): Promise<void> {
    await this.activeCompletion;
  }

  private reportAsyncError(error: unknown, runId: string): void {
    try {
      this.options.onAsyncError?.(error, runId);
    } catch (loggingError: unknown) {
      const message =
        loggingError instanceof Error
          ? loggingError.message
          : 'unknown logging error';
      process.stderr.write(
        `Could not report asynchronous run ${runId} failure: ${message}\n`,
      );
    }
  }
}
