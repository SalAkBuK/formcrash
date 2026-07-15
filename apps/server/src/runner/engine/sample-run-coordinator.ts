import type {
  SampleRunExecutor,
  SampleRunMode,
  SampleRunResult,
} from '../sample/types.js';

export class ActiveSampleRunError extends Error {
  constructor() {
    super(
      'A browser run is already active. Wait for it to finish before retrying.',
    );
    this.name = 'ActiveSampleRunError';
  }
}

export class SampleRunCoordinator {
  private active = false;

  constructor(private readonly executor: SampleRunExecutor) {}

  get isActive(): boolean {
    return this.active;
  }

  async run(mode: SampleRunMode): Promise<SampleRunResult> {
    if (this.active) throw new ActiveSampleRunError();
    this.active = true;

    try {
      return await this.executor.run(mode);
    } finally {
      this.active = false;
    }
  }
}
