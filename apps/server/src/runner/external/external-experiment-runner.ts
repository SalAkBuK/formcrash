import { randomUUID } from 'node:crypto';

import type {
  EphemeralRuntimeValues,
  ExternalAssertionResult,
  ExternalExperimentVersion,
  ExternalNetworkObservation,
  ExternalRunDetail,
  ExternalRunnerError,
  ExternalRunWarning,
  ReplayFailure,
} from '@formcrash/contracts';

import {
  ScreenshotCaptureError,
  ScreenshotStore,
  type ScreenshotLabel,
} from '../../artifacts/screenshot-store.js';
import type { ServerConfig } from '../../app/config.js';
import type { ExternalExperimentRepository } from '../../persistence/external-experiment-repository.js';
import type { ProjectJourneyRepository } from '../../persistence/project-journey-repository.js';
import type { ProjectSettingsRepository } from '../../persistence/project-settings-repository.js';
import { RunPersistenceError } from '../../persistence/run-repository.js';
import { RunEventLog } from '../engine/event-log.js';
import type { BrowserOwnership } from '../infrastructure/browser-ownership.js';
import {
  PlaywrightExternalBrowserOwner,
  type ExternalBrowserOwner,
  type ReplayBrowserSession,
} from '../recording/external-browser.js';
import { evaluateExternalAssertions } from './assertions.js';
import type { AuthStateStore } from './auth-session.js';
import { executeHttpHook, HttpHookError } from './http-hooks.js';
import { executeRecordedStep } from './journey-actions.js';
import { NetworkEvidenceCollector } from './network-evidence.js';
import {
  InvalidTemplateError,
  MissingRuntimeVariablesError,
  resolveHook,
  resolveRuntime,
  resolveStepValue,
  type ResolvedRuntime,
} from './runtime-values.js';

export class ExternalExperimentRunner {
  private readonly browserOwner: ExternalBrowserOwner;
  private readonly screenshotStore: ScreenshotStore;

  constructor(
    private readonly config: ServerConfig,
    private readonly projects: ProjectJourneyRepository,
    private readonly settings: ProjectSettingsRepository,
    private readonly authStore: AuthStateStore,
    private readonly repository: ExternalExperimentRepository,
    private readonly ownership: BrowserOwnership,
    browserOwner?: ExternalBrowserOwner,
  ) {
    this.browserOwner = browserOwner ?? new PlaywrightExternalBrowserOwner();
    this.screenshotStore = new ScreenshotStore(config.artifactRoot, repository);
  }

  async run(
    experimentVersionId: string,
    ephemeral: EphemeralRuntimeValues,
  ): Promise<ExternalRunDetail> {
    const experiment = this.repository.getVersion(experimentVersionId);
    if (experiment === null)
      throw new Error('Experiment version was not found.');
    const project = this.projects.getProject(experiment.projectId);
    if (project === null) throw new Error('Experiment project was not found.');
    const journey = experiment.journeySnapshot;
    const storedSettings = this.settings.get(project.id);
    const runId = randomUUID();
    const startedAtMs = Date.now();
    const startedAt = new Date(startedAtMs).toISOString();
    const runtime = resolveRuntime({
      runId,
      journey,
      declarations: storedSettings.variables,
      ephemeral,
      hooks: [storedSettings.beforeRunHook, storedSettings.afterRunHook],
      assertions: experiment.assertions,
    });
    const storageStatePath = this.authStore.usablePath(project.id);
    const release = this.ownership.acquire('external_experiment');
    try {
      this.repository.createRun({
        runId,
        experiment,
        targetUrl: project.targetUrl,
        projectName: project.name,
        journeyName: journey.name,
        safeResolvedValues: createSafeSnapshot(journey, runtime),
        startedAt,
      });
    } catch (error: unknown) {
      release();
      throw error;
    }
    const events = new RunEventLog(runId, (event) =>
      this.repository.appendEvent(event),
    );
    let session: ReplayBrowserSession | null = null;
    let triggerAttempts = 0;
    let observations: readonly ExternalNetworkObservation[] = [];
    let assertionResults: readonly ExternalAssertionResult[] = [];
    const warnings: ExternalRunWarning[] = [];
    let runnerError: ExternalRunnerError | null = null;

    try {
      events.append('run.created', {
        experimentVersionId: experiment.id,
        experimentType: 'impatient_user',
      });
      this.repository.updateStatus(runId, 'starting');
      events.append('run.starting', {});
      if (storedSettings.beforeRunHook !== null) {
        await executeHttpHook(
          'before',
          resolveHook(
            storedSettings.beforeRunHook,
            runtime.values,
            runtime.context,
          ),
          events,
        );
      }
      try {
        session = await this.browserOwner.launchReplay({
          targetUrl: project.targetUrl,
          headless: this.config.browserHeadless,
          timeoutMs: this.config.browserTimeoutMs,
          ...(storageStatePath === null ? {} : { storageStatePath }),
        });
      } catch (error: unknown) {
        throw new BrowserLaunchError(error);
      }
      session.setScreenshotMasks(
        journey.steps
          .filter((step) => step.sensitive && step.locator !== null)
          .map((step) => step.locator)
          .filter((locator) => locator !== null),
      );
      const collector = new NetworkEvidenceCollector(experiment.networkMatcher);
      session.observeNetwork((observation) => collector.observe(observation));
      this.repository.updateStatus(runId, 'running');
      events.append('browser.launched', {
        headless: this.config.browserHeadless,
        authenticationRestored: storageStatePath !== null,
      });
      events.append('run.running', {});
      await session.navigate(project.targetUrl);

      const targetIndex = journey.steps.findIndex(
        (step) => step.id === experiment.targetStepId,
      );
      const target = journey.steps[targetIndex];
      if (
        target === undefined ||
        (target.type !== 'click' && target.type !== 'submit')
      ) {
        throw new ConfigurationError(
          'The experiment target is no longer a compatible journey step.',
        );
      }
      for (const [index, step] of journey.steps
        .slice(0, targetIndex)
        .entries()) {
        await executeWithEvents(session, step, index, events, runtime);
      }

      await this.capture(session, runId, 'before-disruption', events, warnings);
      if (target.locator === null)
        throw new ConfigurationError(
          'Experiment target has no replay locator.',
        );
      events.append('experiment.injected', {
        experimentType: 'impatient_user',
        targetStepId: target.id,
        triggerCount: experiment.triggerCount,
        intervalMs: experiment.intervalMs,
      });
      try {
        await session.triggerRepeated(
          target.locator,
          target.type,
          experiment.triggerCount,
          experiment.intervalMs,
          (attempt) => {
            triggerAttempts = attempt;
            events.append('experiment.triggered', {
              experimentType: 'impatient_user',
              targetStepId: target.id,
              triggerNumber: attempt,
            });
          },
        );
      } catch (error: unknown) {
        throw new ExternalJourneyStepError(target, targetIndex, error);
      }
      await session.settle(500);
      await this.capture(session, runId, 'after-disruption', events, warnings);

      if (experiment.continueAfterTarget) {
        for (const [offset, step] of journey.steps
          .slice(targetIndex + 1)
          .entries()) {
          await executeWithEvents(
            session,
            step,
            targetIndex + 1 + offset,
            events,
            runtime,
          );
        }
      } else {
        events.append('journey.continuation.skipped', {
          reason:
            'Later steps were not configured to continue after the injected target.',
        });
      }
      await session.settle(750);
      observations = collector.snapshot();
      this.repository.updateStatus(runId, 'evaluating');
      events.append('run.evaluating', {});
      assertionResults = await evaluateExternalAssertions({
        assertions: experiment.assertions,
        session,
        observations,
        runtime,
        events,
      });
      await this.capture(session, runId, 'final-result', events, warnings);
    } catch (error: unknown) {
      runnerError = mapRunnerError(error);
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
            missingVariables: [],
          };
          events.append('browser.closed', { success: false });
        }
      }
      if (storedSettings.afterRunHook !== null) {
        try {
          await executeHttpHook(
            'after',
            resolveHook(
              storedSettings.afterRunHook,
              runtime.values,
              runtime.context,
            ),
            events,
          );
        } catch {
          warnings.push({
            code: 'cleanup_hook_failed',
            message:
              'The optional cleanup hook failed. Verify test-data integrity before another run.',
            label: null,
          });
        }
      }
      release();
    }

    const status =
      runnerError !== null
        ? 'runner_error'
        : assertionResults.every((result) => result.status === 'passed')
          ? 'passed'
          : 'failed';
    const completedAtMs = Date.now();
    this.repository.finalizeRun({
      runId,
      status,
      completedAt: new Date(completedAtMs).toISOString(),
      durationMs: Math.max(0, completedAtMs - startedAtMs),
      triggerAttempts,
      networkObservations: observations,
      runnerError,
      warnings,
      assertions: assertionResults,
    });
    events.append(
      runnerError === null ? `run.${status}` : 'runner.error',
      runnerError === null
        ? { status }
        : { code: runnerError.code, message: runnerError.message },
    );
    const persisted = this.repository.getRun(runId);
    if (persisted === null)
      throw new Error('Finalized external run is missing.');
    return persisted;
  }

  private async capture(
    session: ReplayBrowserSession,
    runId: string,
    label: ScreenshotLabel,
    events: RunEventLog,
    warnings: ExternalRunWarning[],
  ): Promise<void> {
    try {
      const artifact = await this.screenshotStore.capture(
        session,
        runId,
        label,
      );
      events.append('artifact.captured', {
        artifactId: artifact.artifactId,
        label,
        captureSequence: artifact.captureSequence,
      });
    } catch (error: unknown) {
      if (!(error instanceof ScreenshotCaptureError)) throw error;
      const warning: ExternalRunWarning = {
        code: 'screenshot_capture_failed',
        message: error.message,
        label,
      };
      warnings.push(warning);
      events.append('artifact.capture_failed', warning);
    }
  }
}

async function executeWithEvents(
  session: ReplayBrowserSession,
  step: ExternalExperimentVersion['journeySnapshot']['steps'][number],
  index: number,
  events: RunEventLog,
  runtime: ResolvedRuntime,
): Promise<void> {
  events.append('journey.step.started', {
    stepId: step.id,
    stepName: step.name,
    stepNumber: index + 1,
    actionType: step.type,
  });
  try {
    await executeRecordedStep(session, step, (item) =>
      resolveStepValue(item, runtime),
    );
  } catch (error: unknown) {
    throw new ExternalJourneyStepError(step, index, error);
  }
  events.append('journey.step.completed', {
    stepId: step.id,
    stepName: step.name,
    stepNumber: index + 1,
    actionType: step.type,
  });
}

function createSafeSnapshot(
  journey: ExternalExperimentVersion['journeySnapshot'],
  runtime: ResolvedRuntime,
): Readonly<Record<string, string>> {
  const snapshot: Record<string, string> = { ...runtime.safeSnapshot };
  for (const [index, step] of journey.steps.entries()) {
    if (step.value?.kind !== 'safe' || !step.value.value.includes('{{'))
      continue;
    snapshot[`RESOLVED_STEP_${index + 1}`] = resolveStepValue(step, runtime);
  }
  return snapshot;
}

function mapRunnerError(error: unknown): ExternalRunnerError {
  if (error instanceof ExternalJourneyStepError) {
    return {
      code: 'journey_step_failed',
      message: error.message,
      failedStep: error.failedStep,
      missingVariables: [],
    };
  }
  if (error instanceof BrowserLaunchError) {
    return {
      code: 'browser_launch_failed',
      message: 'Chromium could not be launched for the external experiment.',
      failedStep: null,
      missingVariables: [],
    };
  }
  if (error instanceof HttpHookError && error.phase === 'before') {
    return {
      code: 'before_hook_failed',
      message: error.message,
      failedStep: null,
      missingVariables: [],
    };
  }
  if (
    error instanceof ConfigurationError ||
    error instanceof InvalidTemplateError
  ) {
    return {
      code: 'configuration_failed',
      message: error.message,
      failedStep: null,
      missingVariables: [],
    };
  }
  if (error instanceof MissingRuntimeVariablesError) {
    return {
      code: 'configuration_failed',
      message: 'Required runtime variables were not configured.',
      failedStep: null,
      missingVariables: [...error.missingVariables],
    };
  }
  if (error instanceof RunPersistenceError) {
    return {
      code: 'persistence_failed',
      message: 'Durable external run storage failed.',
      failedStep: null,
      missingVariables: [],
    };
  }
  return {
    code: 'runner_failure',
    message: 'The external experiment runner could not complete the scenario.',
    failedStep: null,
    missingVariables: [],
  };
}

class BrowserLaunchError extends Error {
  constructor(cause: unknown) {
    super('Chromium launch failed.', { cause });
  }
}

class ConfigurationError extends Error {}

class ExternalJourneyStepError extends Error {
  readonly failedStep: ReplayFailure;

  constructor(
    step: ExternalExperimentVersion['journeySnapshot']['steps'][number],
    index: number,
    cause: unknown,
  ) {
    super(`Journey step “${step.name}” failed during external execution.`, {
      cause,
    });
    this.failedStep = {
      stepId: step.id,
      stepName: step.name,
      stepNumber: index + 1,
      actionType: step.type,
      message:
        'The recorded action could not complete within the bounded wait.',
    };
  }
}
