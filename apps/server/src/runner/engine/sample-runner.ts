import { randomUUID } from 'node:crypto';

import type { ServerConfig } from '../../app/config.js';
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
import {
  IMPATIENT_USER_EXPERIMENT,
  SAMPLE_JOURNEY_SUMMARY,
} from '../journeys/sample-checkout.js';
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

export interface SampleRunnerOptions {
  readonly browserOwner?: BrowserOwner;
  readonly readinessChecker?: TargetReadinessChecker;
}

export class PlaywrightSampleRunExecutor implements SampleRunExecutor {
  private readonly browserOwner: BrowserOwner;
  private readonly readinessChecker: TargetReadinessChecker;

  constructor(
    private readonly config: ServerConfig,
    options: SampleRunnerOptions = {},
  ) {
    this.browserOwner = options.browserOwner ?? new PlaywrightBrowserOwner();
    this.readinessChecker =
      options.readinessChecker ?? new FetchTargetReadinessChecker();
  }

  async run(mode: SampleRunMode): Promise<SampleRunResult> {
    const runId = randomUUID();
    const startedAtMs = Date.now();
    const startedAt = new Date(startedAtMs).toISOString();
    const events = new RunEventLog(runId);
    const state = new RunStateTracker();
    const requests = new Map<string, BrowserRequestEvidence>();
    let session: CheckoutBrowserSession | null = null;
    let applicationState: SampleApplicationState | null = null;
    let assertion = createNotEvaluatedAssertion();
    let runnerError: SampleRunnerError | null = null;

    events.append('run.created', { mode });
    state.transition('starting');
    events.append('run.starting', { mode });

    try {
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
        recordRequestObservation(observation, requests, events);
      });

      state.transition('running');
      events.append('run.running', { mode });
      await session.resetSampleState();
      events.append('sample.state.reset', {});
      events.append('journey.started', {
        journeyId: SAMPLE_JOURNEY_SUMMARY.id,
      });
      applicationState = await executeSampleJourney(session, events, {
        baseUrl: this.config.sampleCheckoutBaseUrl,
        mode,
        timeoutMs: this.config.browserTimeoutMs,
      });
      events.append('journey.completed', {
        journeyId: SAMPLE_JOURNEY_SUMMARY.id,
      });

      state.transition('evaluating');
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
        } catch {
          runnerError = {
            code: 'browser_cleanup_failed',
            message: 'Chromium cleanup did not complete successfully.',
            failedStep: null,
          };
          events.append('browser.closed', { success: false });
        }
      }
    }

    let finalStatus: 'passed' | 'failed' | 'runner_error';
    if (runnerError !== null) {
      state.transition('runner_error');
      finalStatus = 'runner_error';
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
    } else {
      finalStatus = assertion.status === 'passed' ? 'passed' : 'failed';
      state.transition(finalStatus);
      events.append(`run.${finalStatus}`, { mode });
    }

    const completedAtMs = Date.now();
    return {
      runId,
      status: finalStatus,
      mode,
      startedAt,
      completedAt: new Date(completedAtMs).toISOString(),
      durationMs: Math.max(0, completedAtMs - startedAtMs),
      journey: SAMPLE_JOURNEY_SUMMARY,
      experiment: IMPATIENT_USER_EXPERIMENT,
      assertions: [assertion],
      events: events.snapshot(),
      observed:
        applicationState === null
          ? null
          : createObservedState(applicationState, requests),
      runnerError,
    };
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
