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
  private latestResult: SampleRunResult | null = null;

  constructor(private readonly executor: SampleRunExecutor) {}

  get isActive(): boolean {
    return this.active;
  }

  get latest(): SampleRunResult | null {
    return this.latestResult === null
      ? null
      : structuredClone(this.latestResult);
  }

  async run(mode: SampleRunMode): Promise<SampleRunResult> {
    if (this.active) throw new ActiveSampleRunError();
    this.active = true;

    try {
      const result = await this.executor.run(mode);
      this.latestResult = structuredClone(result);
      return result;
    } finally {
      this.active = false;
    }
  }
}
