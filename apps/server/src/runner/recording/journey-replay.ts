import { randomUUID } from 'node:crypto';

import {
  replayResultSchema,
  type EphemeralRuntimeValues,
  type ReplayInteractionOutcome,
  type ReplayMode,
  type ReplayPacing,
  type ReplayResult,
} from '@formcrash/contracts';

import type { ServerConfig } from '../../app/config.js';
import { JourneyTraceStore } from '../../artifacts/journey-trace-store.js';
import type { ProjectJourneyRepository } from '../../persistence/project-journey-repository.js';
import type { ProjectSettingsRepository } from '../../persistence/project-settings-repository.js';
import { RunEventLog } from '../engine/event-log.js';
import type { AuthStateStore } from '../external/auth-session.js';
import {
  authenticationInterruptedBeforeStep,
  assertNoVisibleAuthenticationRequirement,
  assertSavedAuthenticationSessionActive,
  SavedAuthenticationExpiredError,
} from '../external/authentication-redirect.js';
import { executeHttpHook } from '../external/http-hooks.js';
import {
  executeRecordedStep,
  HybridReplayError,
} from '../external/journey-actions.js';
import {
  isStepValueSensitive,
  redactSensitiveText,
  resolveHook,
  resolveRuntime,
  resolveStepValue,
  type ResolvedRuntime,
} from '../external/runtime-values.js';
import { assertProductionConfirmed } from '../external/production-safety.js';
import type { BrowserOwnership } from '../infrastructure/browser-ownership.js';
import {
  PlaywrightExternalBrowserOwner,
  type ExternalBrowserOwner,
  type ReplayBrowserSession,
} from './external-browser.js';
import { paceReplayStep } from './replay-pacing.js';

export class JourneyReplayService {
  private readonly browserOwner: ExternalBrowserOwner;
  private readonly traceStore: JourneyTraceStore;

  constructor(
    private readonly config: ServerConfig,
    private readonly repository: ProjectJourneyRepository,
    private readonly ownership: BrowserOwnership,
    browserOwner?: ExternalBrowserOwner,
    private readonly settings?: ProjectSettingsRepository,
    private readonly authStore?: AuthStateStore,
  ) {
    this.browserOwner = browserOwner ?? new PlaywrightExternalBrowserOwner();
    this.traceStore = new JourneyTraceStore(config.artifactRoot, repository);
  }

  async replay(
    journeyId: string,
    ephemeral: EphemeralRuntimeValues = {},
    confirmProduction = false,
    mode: ReplayMode = 'adaptive',
    pacing: ReplayPacing = 'recorded',
  ): Promise<ReplayResult> {
    const journey = this.repository.getJourney(journeyId);
    if (journey === null) throw new Error('Journey was not found.');
    const project = this.repository.getProject(journey.projectId);
    if (project === null) throw new Error('Journey project was not found.');
    assertProductionConfirmed(
      project,
      confirmProduction,
      'Normal journey replay',
    );
    const storedSettings = this.settings?.get(project.id) ?? {
      variables: [],
      beforeRunHook: null,
      afterRunHook: null,
    };
    const replayId = randomUUID();
    const runtime = resolveRuntime({
      runId: replayId,
      journey,
      declarations: storedSettings.variables,
      ephemeral,
      hooks: [storedSettings.beforeRunHook, storedSettings.afterRunHook],
    });
    const storageStatePath = this.authStore?.usablePath(project.id) ?? null;
    const traceRecord = this.repository.getRecordingTraceByJourney(journey.id);
    if (traceRecord !== null) this.traceStore.assertIntegrity(traceRecord);
    const trace = this.repository.getJourneyTraceManifest(journey.id);
    const interactions = new Map(
      (trace?.interactions ?? []).map((interaction) => [
        interaction.stepId,
        interaction,
      ]),
    );
    const release = this.ownership.acquire('replay');
    const startedAt = new Date().toISOString();
    const events = new RunEventLog(`replay-${replayId}`);
    let session: ReplayBrowserSession | null = null;
    let result: ReplayResult | null = null;
    const interactionOutcomes: ReplayInteractionOutcome[] = [];
    try {
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
      session = await this.browserOwner.launchReplay({
        targetUrl: project.targetUrl,
        headless: this.config.browserHeadless,
        timeoutMs: this.config.browserTimeoutMs,
        ...(trace === null ? {} : { environment: trace.environment }),
        ...(storageStatePath === null ? {} : { storageStatePath }),
      });
      await session.navigate(project.targetUrl);
      if (storageStatePath !== null) {
        await assertSavedAuthenticationSessionActive(
          project.targetUrl,
          session,
        );
      }
      for (const [index, step] of journey.steps.entries()) {
        const interaction = interactions.get(step.id);
        const previousStep = journey.steps[index - 1];
        const previousInteraction =
          previousStep === undefined
            ? undefined
            : interactions.get(previousStep.id);
        try {
          await paceReplayStep({
            session,
            pacing,
            step,
            ...(interaction === undefined ? {} : { interaction }),
            ...(previousStep === undefined ? {} : { previousStep }),
            ...(previousInteraction === undefined
              ? {}
              : { previousInteraction }),
          });
          interactionOutcomes.push(
            await executeRecordedStep(
              session,
              step,
              (item) => resolveStepValue(item, runtime),
              {
                ...(interaction === undefined ? {} : { interaction }),
                mode,
              },
            ),
          );
        } catch (error: unknown) {
          if (error instanceof SavedAuthenticationExpiredError) {
            throw authenticationInterruptedBeforeStep(index + 1, step.name);
          }
          result = replayResultSchema.parse({
            replayId,
            journeyId,
            status: 'failed',
            failedStep: {
              stepId: step.id,
              stepName: step.name,
              stepNumber: index + 1,
              actionType: step.type,
              message: `Step ${index + 1} could not be replayed.`,
              technicalMessage: technicalReplayMessage(
                error,
                isStepValueSensitive(step, runtime),
                runtime,
              ),
              currentUrl: safeCurrentUrl(session, runtime),
              locator: step.locator,
              ...(error instanceof HybridReplayError
                ? {
                    pageId: error.pageId,
                    framePath: error.framePath,
                    resolutionAttempts: error.resolutionAttempts,
                    confidence: error.confidence,
                    expectedState: error.expectedState,
                    observedState: error.observedState,
                    sideEffectObserved: error.sideEffectObserved,
                  }
                : {}),
            },
            startedAt,
            completedAt: new Date().toISOString(),
            mode,
            pacing,
            interactionOutcomes,
          });
          break;
        }
      }
      await assertNoVisibleAuthenticationRequirement(session);
      result ??= replayResultSchema.parse({
        replayId,
        journeyId,
        status: 'passed',
        failedStep: null,
        startedAt,
        completedAt: new Date().toISOString(),
        mode,
        pacing,
        interactionOutcomes,
      });
    } catch (error: unknown) {
      if (error instanceof SavedAuthenticationExpiredError) throw error;
      result = replayResultSchema.parse({
        replayId,
        journeyId,
        status: 'runner_error',
        failedStep: null,
        startedAt,
        completedAt: new Date().toISOString(),
        mode,
        pacing,
        interactionOutcomes,
      });
    } finally {
      if (session !== null) {
        try {
          await session.close();
        } catch {
          result = replayResultSchema.parse({
            replayId,
            journeyId,
            status: 'runner_error',
            failedStep: result?.failedStep ?? null,
            startedAt,
            completedAt: new Date().toISOString(),
            mode,
            pacing,
            interactionOutcomes,
          });
        }
      }
      if (storedSettings.afterRunHook !== null) {
        await executeHttpHook(
          'after',
          resolveHook(
            storedSettings.afterRunHook,
            runtime.values,
            runtime.context,
          ),
          events,
        ).catch(() => undefined);
      }
      release();
    }
    if (result === null) throw new Error('Replay did not produce a result.');
    return result;
  }
}

function technicalReplayMessage(
  error: unknown,
  sensitive: boolean,
  runtime: ResolvedRuntime,
): string {
  if (sensitive) {
    return 'The sensitive field action failed. Its value was omitted from diagnostics.';
  }
  if (!(error instanceof Error) || error.message.trim() === '') {
    return 'The browser action failed without a diagnostic message.';
  }
  return redactSensitiveText(error.message.trim().slice(0, 2_000), runtime);
}

function safeCurrentUrl(
  session: ReplayBrowserSession,
  runtime: ResolvedRuntime,
): string | null {
  try {
    return redactSensitiveText(session.currentUrl(), runtime);
  } catch {
    return null;
  }
}
