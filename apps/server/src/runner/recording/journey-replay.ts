import { randomUUID } from 'node:crypto';

import {
  replayResultSchema,
  type EphemeralRuntimeValues,
  type ReplayResult,
} from '@formcrash/contracts';

import type { ServerConfig } from '../../app/config.js';
import type { ProjectJourneyRepository } from '../../persistence/project-journey-repository.js';
import type { ProjectSettingsRepository } from '../../persistence/project-settings-repository.js';
import { RunEventLog } from '../engine/event-log.js';
import type { AuthStateStore } from '../external/auth-session.js';
import { executeHttpHook } from '../external/http-hooks.js';
import { executeRecordedStep } from '../external/journey-actions.js';
import {
  resolveHook,
  resolveRuntime,
  resolveStepValue,
} from '../external/runtime-values.js';
import { assertProductionConfirmed } from '../external/production-safety.js';
import type { BrowserOwnership } from '../infrastructure/browser-ownership.js';
import {
  PlaywrightExternalBrowserOwner,
  type ExternalBrowserOwner,
  type ReplayBrowserSession,
} from './external-browser.js';

export class JourneyReplayService {
  private readonly browserOwner: ExternalBrowserOwner;

  constructor(
    private readonly config: ServerConfig,
    private readonly repository: ProjectJourneyRepository,
    private readonly ownership: BrowserOwnership,
    browserOwner?: ExternalBrowserOwner,
    private readonly settings?: ProjectSettingsRepository,
    private readonly authStore?: AuthStateStore,
  ) {
    this.browserOwner = browserOwner ?? new PlaywrightExternalBrowserOwner();
  }

  async replay(
    journeyId: string,
    ephemeral: EphemeralRuntimeValues = {},
    confirmProduction = false,
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
    const release = this.ownership.acquire('replay');
    const startedAt = new Date().toISOString();
    const events = new RunEventLog(`replay-${replayId}`);
    let session: ReplayBrowserSession | null = null;
    let result: ReplayResult | null = null;
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
        ...(storageStatePath === null ? {} : { storageStatePath }),
      });
      await session.navigate(project.targetUrl);
      for (const [index, step] of journey.steps.entries()) {
        try {
          await executeRecordedStep(session, step, (item) =>
            resolveStepValue(item, runtime),
          );
        } catch (error: unknown) {
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
              technicalMessage: technicalReplayMessage(error, step.sensitive),
              currentUrl: safeCurrentUrl(session),
              locator: step.locator,
            },
            startedAt,
            completedAt: new Date().toISOString(),
          });
          break;
        }
      }
      result ??= replayResultSchema.parse({
        replayId,
        journeyId,
        status: 'passed',
        failedStep: null,
        startedAt,
        completedAt: new Date().toISOString(),
      });
    } catch {
      result = replayResultSchema.parse({
        replayId,
        journeyId,
        status: 'runner_error',
        failedStep: null,
        startedAt,
        completedAt: new Date().toISOString(),
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

function technicalReplayMessage(error: unknown, sensitive: boolean): string {
  if (sensitive) {
    return 'The sensitive field action failed. Its value was omitted from diagnostics.';
  }
  if (!(error instanceof Error) || error.message.trim() === '') {
    return 'The browser action failed without a diagnostic message.';
  }
  return error.message.trim().slice(0, 2_000);
}

function safeCurrentUrl(session: ReplayBrowserSession): string | null {
  try {
    return session.currentUrl();
  } catch {
    return null;
  }
}
