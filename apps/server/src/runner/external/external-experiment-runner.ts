import { randomUUID } from 'node:crypto';

import type {
  EphemeralRuntimeValues,
  ExternalAssertionResult,
  ExternalExperimentVersion,
  ExternalNetworkObservation,
  ExternalOutcomeCheckResult,
  ExternalRunDetail,
  ExternalRunnerError,
  ExternalRunWarning,
  ReplayFailure,
  RunArtifact,
  OutcomeAggregate,
  OutcomeCheckRunSnapshot,
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
import type { OutcomeCheckRepository } from '../../persistence/outcome-check-repository.js';
import { RunPersistenceError } from '../../persistence/run-repository.js';
import { RunEventLog } from '../engine/event-log.js';
import {
  aggregateOutcomeChecks,
  createUnverifiedOutcomeResults,
  evaluateOutcomeChecks,
} from '../outcomes/outcome-evaluator.js';
import type { BrowserOwnership } from '../infrastructure/browser-ownership.js';
import {
  PlaywrightExternalBrowserOwner,
  type ExternalBrowserOwner,
  type ReplayBrowserSession,
} from '../recording/external-browser.js';
import { evaluateExternalAssertions } from './assertions.js';
import type { AuthStateStore } from './auth-session.js';
import {
  assertSavedAuthenticationActive,
  SavedAuthenticationExpiredError,
} from './authentication-redirect.js';
import { executeHttpHook, HttpHookError } from './http-hooks.js';
import {
  executeRecordedStep,
  preferredReplayLocator,
} from './journey-actions.js';
import { NetworkEvidenceCollector } from './network-evidence.js';
import {
  InvalidTemplateError,
  isStepValueSensitive,
  MissingRuntimeVariablesError,
  redactSensitiveText,
  resolveHook,
  resolveRuntime,
  resolveTemplateValue,
  resolveStepRuntimeValue,
  resolveStepValue,
  type ResolvedRuntime,
} from './runtime-values.js';
import { assertProductionConfirmed } from './production-safety.js';

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
    private readonly outcomes?: OutcomeCheckRepository,
  ) {
    this.browserOwner = browserOwner ?? new PlaywrightExternalBrowserOwner();
    this.screenshotStore = new ScreenshotStore(config.artifactRoot, repository);
  }

  async run(
    experimentVersionId: string,
    ephemeral: EphemeralRuntimeValues,
    confirmProduction = false,
  ): Promise<ExternalRunDetail> {
    const experiment = this.repository.getVersion(experimentVersionId);
    if (experiment === null)
      throw new Error('Experiment version was not found.');
    if (
      experiment.networkMatcher === null &&
      experiment.assertions.some((assertion) =>
        assertion.type.startsWith('network_'),
      )
    ) {
      throw new ConfigurationError(
        'A network request matcher is required for network assertions.',
      );
    }
    const project = this.projects.getProject(experiment.projectId);
    if (project === null) throw new Error('Experiment project was not found.');
    assertProductionConfirmed(
      project,
      confirmProduction,
      'External experiment execution',
    );
    const journey = experiment.journeySnapshot;
    const outcomeCheckSnapshot = this.resolveOutcomeCheckSnapshot(experiment);
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
      outcomeChecks: outcomeCheckSnapshot.checks,
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
        safeResolvedValues: createSafeSnapshot(
          journey,
          runtime,
          outcomeCheckSnapshot,
        ),
        outcomeCheckSnapshot,
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
    let outcomeCheckResults: readonly ExternalOutcomeCheckResult[] = [];
    const evidenceArtifacts: RunArtifact[] = [];
    const disabledDuringRepeatedActionAssertionIds = new Set<string>();
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
          .filter(
            (step) =>
              step.locator !== null && isStepValueSensitive(step, runtime),
          )
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
      if (storageStatePath !== null) {
        assertSavedAuthenticationActive(
          project.targetUrl,
          session.currentUrl(),
        );
      }

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
        await executeWithEvents(
          session,
          step,
          index,
          events,
          runtime,
          outcomeCheckSnapshot,
        );
      }

      const beforeArtifact = await this.capture(
        session,
        runId,
        'before-disruption',
        events,
        warnings,
      );
      if (beforeArtifact !== null) evidenceArtifacts.push(beforeArtifact);
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
          preferredReplayLocator(target),
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
        for (const assertion of experiment.assertions) {
          if (
            assertion.type === 'element_disabled' &&
            assertion.observationWindow === 'during_repeated_action' &&
            (await session.isDisabled(assertion.locator))
          ) {
            disabledDuringRepeatedActionAssertionIds.add(assertion.id);
          }
        }
      } catch (error: unknown) {
        throw new ExternalJourneyStepError(
          target,
          targetIndex,
          error,
          isStepValueSensitive(target, runtime),
          runtime,
        );
      }
      await this.settleAfterDisruption(
        session,
        collector,
        experiment.networkMatcher !== null,
      );
      const afterArtifact = await this.capture(
        session,
        runId,
        'after-disruption',
        events,
        warnings,
      );
      if (afterArtifact !== null) evidenceArtifacts.push(afterArtifact);

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
            outcomeCheckSnapshot,
          );
        }
      } else {
        events.append('journey.continuation.skipped', {
          reason:
            'Later steps were not configured to continue after the injected target.',
        });
      }
      await session.settle(900);
      observations = sanitizeNetworkObservations(
        collector.snapshot(),
        runtime,
        outcomeCheckSnapshot,
      );
      this.repository.updateStatus(runId, 'evaluating');
      events.append('run.evaluating', {});
      assertionResults = await evaluateExternalAssertions({
        assertions: experiment.assertions,
        session,
        observations,
        runtime,
        events,
        disabledDuringRepeatedActionAssertionIds,
      });
      const finalArtifact = await this.capture(
        session,
        runId,
        'final-result',
        events,
        warnings,
      );
      if (finalArtifact !== null) evidenceArtifacts.push(finalArtifact);
      outcomeCheckResults = await evaluateOutcomeChecks({
        runId,
        snapshot: outcomeCheckSnapshot,
        session,
        runtime,
        events: events.snapshot(),
        observations,
        artifacts: evidenceArtifacts,
      });
      for (const result of outcomeCheckResults) {
        events.append('outcome_check.evaluated', {
          outcomeCheckId: result.outcomeCheckId,
          type: result.type,
          status: result.status,
          observedCount: result.observedCount,
        });
      }
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
    if (
      runnerError !== null &&
      outcomeCheckResults.length === 0 &&
      outcomeCheckSnapshot.checks.length > 0
    ) {
      outcomeCheckResults = createUnverifiedOutcomeResults({
        runId,
        snapshot: outcomeCheckSnapshot,
        events: events.snapshot(),
        observations,
        artifacts: evidenceArtifacts,
        reason:
          'The runner did not reach a browser state where this approved Outcome Check could be evaluated.',
      });
    }
    const outcomeAggregate: OutcomeAggregate =
      aggregateOutcomeChecks(outcomeCheckResults);
    const assertionAggregate = aggregateAssertions(
      assertionResults,
      experiment.assertions.length,
    );
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
      outcomeAggregate,
      assertionAggregate,
      outcomeCheckResults,
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
  ): Promise<RunArtifact | null> {
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
      return artifact;
    } catch (error: unknown) {
      if (!(error instanceof ScreenshotCaptureError)) throw error;
      const warning: ExternalRunWarning = {
        code: 'screenshot_capture_failed',
        message: error.message,
        label,
      };
      warnings.push(warning);
      events.append('artifact.capture_failed', warning);
      return null;
    }
  }

  private resolveOutcomeCheckSnapshot(
    experiment: ExternalExperimentVersion,
  ): OutcomeCheckRunSnapshot {
    if (this.outcomes === undefined) {
      return { criticalAction: null, checks: [] };
    }
    const criticalAction = this.outcomes.getCriticalAction(
      experiment.journeyId,
    );
    const checks = this.outcomes.listOutcomeChecks(experiment.journeyId);
    if (checks.length === 0) return { criticalAction, checks: [] };
    if (criticalAction === null) {
      throw new ConfigurationError(
        'Outcome Checks exist without an approved Critical Action.',
      );
    }
    if (criticalAction.stepId !== experiment.targetStepId) {
      throw new ConfigurationError(
        'The experiment target must be the approved Critical Action for these Outcome Checks.',
      );
    }
    if (
      checks.some(
        (check) =>
          check.journeyId !== experiment.journeyId ||
          check.criticalActionId !== criticalAction.id,
      )
    ) {
      throw new ConfigurationError(
        'Outcome Checks are not owned by this exact journey version and Critical Action.',
      );
    }
    return { criticalAction, checks: [...checks] };
  }

  private async settleAfterDisruption(
    session: ReplayBrowserSession,
    collector: NetworkEvidenceCollector,
    hasNetworkMatcher: boolean,
  ): Promise<void> {
    if (hasNetworkMatcher) {
      for (let attempt = 0; attempt < 8; attempt += 1) {
        const matched = collector
          .snapshot()
          .filter((observation) => observation.matched);
        if (
          matched.length > 0 &&
          matched.every((observation) => observation.completedAtMs !== null)
        ) {
          break;
        }
        await session.settle(250);
      }
    }
    // Allow dialogs, toasts, loading states, and list refreshes to finish their
    // post-response transition before preserving visual evidence.
    await session.settle(700);
  }
}

async function executeWithEvents(
  session: ReplayBrowserSession,
  step: ExternalExperimentVersion['journeySnapshot']['steps'][number],
  index: number,
  events: RunEventLog,
  runtime: ResolvedRuntime,
  outcomeCheckSnapshot: OutcomeCheckRunSnapshot,
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
    throw new ExternalJourneyStepError(
      step,
      index,
      error,
      isStepValueSensitive(step, runtime) ||
        isOutcomeBoundStep(step, runtime, outcomeCheckSnapshot),
      runtime,
    );
  }
  events.append('journey.step.completed', {
    stepId: step.id,
    stepName: step.name,
    stepNumber: index + 1,
    actionType: step.type,
  });
}

function isOutcomeBoundStep(
  step: ExternalExperimentVersion['journeySnapshot']['steps'][number],
  runtime: ResolvedRuntime,
  snapshot: OutcomeCheckRunSnapshot,
): boolean {
  if (step.value === null) return false;
  const resolved = resolveStepRuntimeValue(step, runtime).value;
  return snapshot.checks.some(
    (check) =>
      check.type === 'matching_item_appears_exactly_once' &&
      resolved.includes(
        resolveTemplateValue(
          check.binding.template,
          runtime.values,
          runtime.context,
        ).value,
      ),
  );
}

function createSafeSnapshot(
  journey: ExternalExperimentVersion['journeySnapshot'],
  runtime: ResolvedRuntime,
  outcomeCheckSnapshot: OutcomeCheckRunSnapshot,
): Readonly<Record<string, string>> {
  const outcomeBoundValues = new Set(
    outcomeCheckSnapshot.checks
      .filter((check) => check.type === 'matching_item_appears_exactly_once')
      .map(
        (check) =>
          resolveTemplateValue(
            check.binding.template,
            runtime.values,
            runtime.context,
          ).value,
      ),
  );
  const snapshot: Record<string, string> = Object.fromEntries(
    Object.entries(runtime.safeSnapshot).filter(
      ([, value]) => !containsOutcomeBoundValue(value, outcomeBoundValues),
    ),
  );
  for (const [index, step] of journey.steps.entries()) {
    if (step.value?.kind !== 'safe' || !step.value.value.includes('{{'))
      continue;
    const resolved = resolveStepRuntimeValue(step, runtime);
    if (
      !resolved.sensitive &&
      !containsOutcomeBoundValue(resolved.value, outcomeBoundValues)
    ) {
      snapshot[`RESOLVED_STEP_${index + 1}`] = resolved.value;
    }
  }
  return snapshot;
}

function containsOutcomeBoundValue(
  candidate: string,
  outcomeBoundValues: ReadonlySet<string>,
): boolean {
  return [...outcomeBoundValues].some(
    (value) =>
      value !== '' &&
      (candidate.includes(value) ||
        candidate.includes(encodeURIComponent(value))),
  );
}

function sanitizeNetworkObservations(
  observations: readonly ExternalNetworkObservation[],
  runtime: ResolvedRuntime,
  snapshot: OutcomeCheckRunSnapshot,
): readonly ExternalNetworkObservation[] {
  const protectedValues = snapshot.checks
    .filter((check) => check.type === 'matching_item_appears_exactly_once')
    .map(
      (check) =>
        resolveTemplateValue(
          check.binding.template,
          runtime.values,
          runtime.context,
        ).value,
    );
  return observations.map((observation) => {
    let pathname = redactSensitiveText(observation.pathname, runtime);
    for (const value of protectedValues) {
      if (value === '') continue;
      pathname = pathname
        .replaceAll(value, '[GENERATED_VALUE]')
        .replaceAll(encodeURIComponent(value), '[GENERATED_VALUE]');
    }
    return { ...observation, pathname };
  });
}

function aggregateAssertions(
  results: readonly ExternalAssertionResult[],
  configuredAssertionCount: number,
): OutcomeAggregate {
  if (results.length === 0) {
    return configuredAssertionCount === 0
      ? 'not_configured'
      : 'could_not_verify';
  }
  if (results.some((result) => result.status === 'failed')) return 'failed';
  if (
    results.some(
      (result) =>
        result.status === 'error' || result.status === 'not_evaluated',
    )
  ) {
    return 'could_not_verify';
  }
  return 'passed';
}

function mapRunnerError(error: unknown): ExternalRunnerError {
  if (error instanceof SavedAuthenticationExpiredError) {
    return {
      code: 'authentication_required',
      message: error.message,
      failedStep: null,
      missingVariables: [],
    };
  }
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
    sensitive: boolean,
    runtime: ResolvedRuntime,
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
      technicalMessage:
        sensitive || !(cause instanceof Error)
          ? null
          : redactSensitiveText(
              cause.message.trim().slice(0, 2_000),
              runtime,
            ) || null,
      currentUrl: null,
      locator: step.locator,
    };
  }
}
