import { randomUUID } from 'node:crypto';

import type { EvidenceWarning, RunStatus } from '@formcrash/contracts';

import type { ScreenshotLabel } from '../../artifacts/screenshot-store.js';
import {
  ScreenshotCaptureError,
  type ScreenshotStore,
} from '../../artifacts/screenshot-store.js';
import type { ServerConfig } from '../../app/config.js';
import {
  RunPersistenceError,
  type RunRepository,
} from '../../persistence/run-repository.js';
import {
  createNotEvaluatedAssertion,
  evaluateMaxCreatedOrders,
} from '../assertions/max-created-orders.js';
import {
  executeSampleJourney,
  JourneyStepExecutionError,
} from '../actions/execute-journey.js';
import type {
  BrowserOwner,
  CheckoutBrowserSession,
  OrderRequestObservation,
} from '../infrastructure/browser-session.js';
import { PlaywrightBrowserOwner } from '../infrastructure/playwright-browser.js';
import type {
  BrowserRequestEvidence,
  SampleApplicationState,
  SampleObservedState,
  SampleRunnerError,
  SampleRunExecutor,
  SampleRunMode,
  SampleRunResult,
} from '../sample/types.js';
import { RunEventLog } from './event-log.js';
import { RunStateTracker } from './state-machine.js';

export interface TargetReadinessChecker {
  assertReachable(baseUrl: string, timeoutMs: number): Promise<void>;
}

export class FetchTargetReadinessChecker implements TargetReadinessChecker {
  async assertReachable(baseUrl: string, timeoutMs: number): Promise<void> {
    try {
      const response = await fetch(new URL('/', baseUrl), {
        signal: AbortSignal.timeout(timeoutMs),
      });
      if (!response.ok) {
        throw new Error(`Target returned HTTP ${response.status}.`);
      }
    } catch (error: unknown) {
      throw new TargetUnavailableError(
        `Sample checkout is unavailable at ${baseUrl}.`,
        error,
      );
    }
  }
}

class TargetUnavailableError extends Error {
  constructor(message: string, cause: unknown) {
    super(message, { cause });
    this.name = 'TargetUnavailableError';
  }
}

class BrowserLaunchError extends Error {
  constructor(cause: unknown) {
    super('Chromium could not be launched for the sample run.', { cause });
    this.name = 'BrowserLaunchError';
  }
}

export interface SampleRunnerDependencies {
  readonly repository: RunRepository;
  readonly screenshotStore: ScreenshotStore;
  readonly browserOwner?: BrowserOwner;
  readonly readinessChecker?: TargetReadinessChecker;
}

export class PlaywrightSampleRunExecutor implements SampleRunExecutor {
  private readonly browserOwner: BrowserOwner;
  private readonly readinessChecker: TargetReadinessChecker;

  constructor(
    private readonly config: ServerConfig,
    private readonly dependencies: SampleRunnerDependencies,
  ) {
    this.browserOwner =
      dependencies.browserOwner ?? new PlaywrightBrowserOwner();
    this.readinessChecker =
      dependencies.readinessChecker ?? new FetchTargetReadinessChecker();
  }

  async run(mode: SampleRunMode): Promise<SampleRunResult> {
    const definition = this.dependencies.repository.loadSeededExperiment();
    const runId = randomUUID();
    const startedAtMs = Date.now();
    const startedAt = new Date(startedAtMs).toISOString();
    this.dependencies.repository.createRun({
      runId,
      experimentVersionId: definition.experimentVersionId,
      mode,
      startedAt,
      targetUrl: this.config.sampleCheckoutBaseUrl,
      journey: definition.journey,
      experiment: definition.experiment,
      assertions: definition.assertions,
    });

    const events = new RunEventLog(runId, (event) =>
      this.dependencies.repository.appendEvent(event),
    );
    const state = new RunStateTracker();
    const requests = new Map<string, BrowserRequestEvidence>();
    const evidenceWarnings: EvidenceWarning[] = [];
    let session: CheckoutBrowserSession | null = null;
    let applicationState: SampleApplicationState | null = null;
    let assertion = createNotEvaluatedAssertion();
    let runnerError: SampleRunnerError | null = null;
    let observationError: unknown = null;

    try {
      state.transition('starting');
      this.dependencies.repository.updateRunStatus(runId, 'starting');
      events.append('run.created', { mode });
      events.append('run.starting', { mode });

      await this.readinessChecker.assertReachable(
        this.config.sampleCheckoutBaseUrl,
        this.config.browserTimeoutMs,
      );

      try {
        session = await this.browserOwner.launch({
          baseUrl: this.config.sampleCheckoutBaseUrl,
          headless: this.config.browserHeadless,
          timeoutMs: this.config.browserTimeoutMs,
        });
      } catch (error: unknown) {
        throw new BrowserLaunchError(error);
      }

      events.append('browser.launched', {
        headless: this.config.browserHeadless,
      });
      session.observeOrderRequests((observation) => {
        if (observationError !== null) return;
        try {
          recordRequestObservation(observation, requests, events);
        } catch (error: unknown) {
          observationError = error;
        }
      });

      transitionRun(state, this.dependencies.repository, runId, 'running');
      events.append('run.running', { mode });
      await session.resetSampleState();
      events.append('sample.state.reset', {});
      events.append('journey.started', {
        journeyId: 'sample-checkout-priority-0',
      });
      applicationState = await executeSampleJourney(session, events, {
        baseUrl: this.config.sampleCheckoutBaseUrl,
        mode,
        timeoutMs: this.config.browserTimeoutMs,
        journey: definition.journey,
        experiment: definition.experiment,
        captureEvidence: (label) =>
          this.captureEvidence(
            session as CheckoutBrowserSession,
            runId,
            label,
            events,
            evidenceWarnings,
          ),
      });
      if (observationError !== null) {
        throw observationError instanceof Error
          ? observationError
          : new Error('Browser request evidence persistence failed.');
      }
      events.append('journey.completed', {
        journeyId: 'sample-checkout-priority-0',
      });

      transitionRun(state, this.dependencies.repository, runId, 'evaluating');
      events.append('run.evaluating', { mode });
      events.append('assertion.evaluating', {
        assertionType: 'max_created_orders',
        expectedMaximum: 1,
      });
      assertion = evaluateMaxCreatedOrders(applicationState.counts.orders);
      events.append(
        assertion.status === 'passed' ? 'assertion.passed' : 'assertion.failed',
        {
          assertionType: assertion.assertionType,
          expectedMaximum: assertion.expectedMaximum,
          observedCount: assertion.observedCount,
        },
      );
    } catch (error: unknown) {
      runnerError = mapRunnerError(error, state.status);
    } finally {
      if (session !== null) {
        try {
          await session.close();
          events.append('browser.closed', { success: true });
        } catch (error: unknown) {
          runnerError =
            error instanceof RunPersistenceError
              ? mapRunnerError(error, state.status)
              : {
                  code: 'browser_cleanup_failed',
                  message: 'Chromium cleanup did not complete successfully.',
                  failedStep: null,
                };
          try {
            events.append('browser.closed', { success: false });
          } catch (eventError: unknown) {
            runnerError = mapRunnerError(eventError, state.status);
          }
        }
      }
    }

    let finalStatus: 'passed' | 'failed' | 'runner_error';
    if (runnerError !== null) {
      finalStatus = 'runner_error';
      transitionToRunnerError(state);
      try {
        events.append('runner.error', {
          code: runnerError.code,
          message: runnerError.message,
          failedStep:
            runnerError.failedStep === null
              ? null
              : {
                  stepId: runnerError.failedStep.stepId,
                  stepName: runnerError.failedStep.stepName,
                  actionType: runnerError.failedStep.actionType,
                  selector: runnerError.failedStep.selector,
                  path: runnerError.failedStep.path,
                },
        });
      } catch (error: unknown) {
        runnerError = mapRunnerError(error, state.status);
      }
    } else {
      finalStatus = assertion.status === 'passed' ? 'passed' : 'failed';
      state.transition(finalStatus);
      events.append(`run.${finalStatus}`, { mode });
    }

    const completedAtMs = Date.now();
    const observed =
      applicationState === null
        ? null
        : createObservedState(applicationState, requests);
    this.dependencies.repository.finalizeRun({
      runId,
      status: finalStatus,
      completedAt: new Date(completedAtMs).toISOString(),
      durationMs: Math.max(0, completedAtMs - startedAtMs),
      observed,
      runnerError,
      evidenceWarnings,
      assertionId: definition.assertionId,
      assertion,
    });

    const persisted = this.dependencies.repository.getRun(runId);
    if (persisted === null) {
      throw new RunPersistenceError(
        'reload the finalized run',
        new Error('Finalized run is missing.'),
      );
    }
    return persisted;
  }

  private async captureEvidence(
    session: CheckoutBrowserSession,
    runId: string,
    label: ScreenshotLabel,
    events: RunEventLog,
    warnings: EvidenceWarning[],
  ): Promise<void> {
    try {
      const artifact = await this.dependencies.screenshotStore.capture(
        session,
        runId,
        label,
      );
      events.append('artifact.captured', {
        artifactId: artifact.artifactId,
        artifactType: artifact.artifactType,
        label: artifact.label,
        captureSequence: artifact.captureSequence,
        sizeBytes: artifact.sizeBytes,
      });
    } catch (error: unknown) {
      if (!(error instanceof ScreenshotCaptureError)) throw error;
      const warning = {
        code: 'screenshot_capture_failed',
        label,
        message: error.message,
      } as const;
      warnings.push(warning);
      events.append('artifact.capture_failed', warning);
    }
  }
}

function transitionRun(
  state: RunStateTracker,
  repository: RunRepository,
  runId: string,
  status: RunStatus,
): void {
  state.transition(status);
  repository.updateRunStatus(runId, status);
}

function transitionToRunnerError(state: RunStateTracker): void {
  if (state.status === 'created') state.transition('starting');
  if (
    state.status === 'starting' ||
    state.status === 'running' ||
    state.status === 'evaluating'
  ) {
    state.transition('runner_error');
  }
}

function recordRequestObservation(
  observation: OrderRequestObservation,
  requests: Map<string, BrowserRequestEvidence>,
  events: RunEventLog,
): void {
  if (observation.kind === 'started') {
    requests.set(observation.requestId, {
      requestId: observation.requestId,
      method: observation.method,
      path: observation.path,
      startedAtMs: observation.startedAtMs,
      completedAtMs: null,
      statusCode: null,
      failed: false,
    });
    events.append('request.started', {
      requestId: observation.requestId,
      method: observation.method,
      path: observation.path,
      startedAtMs: observation.startedAtMs,
    });
    return;
  }

  const request = requests.get(observation.requestId);
  if (request === undefined) return;
  requests.set(observation.requestId, {
    ...request,
    completedAtMs: observation.completedAtMs,
    statusCode: observation.statusCode,
    failed: observation.failed,
  });
  events.append('request.completed', {
    requestId: observation.requestId,
    completedAtMs: observation.completedAtMs,
    statusCode: observation.statusCode,
    failed: observation.failed,
  });
}

function createObservedState(
  state: SampleApplicationState,
  requests: Map<string, BrowserRequestEvidence>,
): SampleObservedState {
  return {
    browserOrderRequestCount: requests.size,
    requestAttemptCount: state.counts.requests,
    acceptedCount: state.counts.accepted,
    deduplicatedCount: state.counts.deduplicated,
    rejectedCount: state.counts.rejected,
    createdOrderCount: state.counts.orders,
    orderIds: state.orders.map((order) => order.id),
    requests: [...requests.values()],
  };
}

function mapRunnerError(error: unknown, state: string): SampleRunnerError {
  if (error instanceof RunPersistenceError) {
    return {
      code: 'persistence_failed',
      message: `Durable run storage failed while the run was ${state}.`,
      failedStep: null,
    };
  }
  if (error instanceof TargetUnavailableError) {
    return {
      code: 'target_unavailable',
      message: error.message,
      failedStep: null,
    };
  }
  if (error instanceof BrowserLaunchError) {
    return {
      code: 'browser_launch_failed',
      message: error.message,
      failedStep: null,
    };
  }
  if (error instanceof JourneyStepExecutionError) {
    return {
      code: 'journey_step_failed',
      message: error.message,
      failedStep: error.step,
    };
  }
  return {
    code: 'runner_failure',
    message: `The sample runner failed while the run was ${state}.`,
    failedStep: null,
  };
}
