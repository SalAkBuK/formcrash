import { randomUUID } from 'node:crypto';

import {
  requestDiscoveryResultSchema,
  type EphemeralRuntimeValues,
  type RecordedJourneyStep,
  type RequestDiscoveryResult,
} from '@formcrash/contracts';

import type { ServerConfig } from '../../app/config.js';
import type { ProjectJourneyRepository } from '../../persistence/project-journey-repository.js';
import type { ProjectSettingsRepository } from '../../persistence/project-settings-repository.js';
import { RunEventLog } from '../engine/event-log.js';
import type { BrowserOwnership } from '../infrastructure/browser-ownership.js';
import {
  PlaywrightExternalBrowserOwner,
  type ExternalBrowserOwner,
  type ReplayBrowserSession,
} from '../recording/external-browser.js';
import type { AuthStateStore } from './auth-session.js';
import { executeHttpHook } from './http-hooks.js';
import { createGuidedJourneySnapshot } from './guided-journey.js';
import { executeRecordedStep } from './journey-actions.js';
import { NetworkEvidenceCollector } from './network-evidence.js';
import { rankRequestCandidates } from './request-recommendation.js';
import {
  isStepValueSensitive,
  redactSensitiveText,
  resolveHook,
  resolveRuntime,
  resolveStepValue,
  type ResolvedRuntime,
} from './runtime-values.js';
import { assertProductionConfirmed } from './production-safety.js';

export class RequestDiscoveryService {
  private readonly browserOwner: ExternalBrowserOwner;

  constructor(
    private readonly config: ServerConfig,
    private readonly projects: ProjectJourneyRepository,
    private readonly settings: ProjectSettingsRepository,
    private readonly authStore: AuthStateStore,
    private readonly ownership: BrowserOwnership,
    browserOwner?: ExternalBrowserOwner,
  ) {
    this.browserOwner = browserOwner ?? new PlaywrightExternalBrowserOwner();
  }

  async discover(input: {
    readonly journeyId: string;
    readonly targetStepId: string;
    readonly variables: EphemeralRuntimeValues;
    readonly confirmProduction?: boolean;
    readonly normalizeJourney?: boolean;
    readonly stepValueOverrides?: Readonly<Record<string, string>>;
  }): Promise<RequestDiscoveryResult> {
    const storedJourney = this.projects.getJourney(input.journeyId);
    if (storedJourney === null) throw new Error('Journey was not found.');
    const journey = createGuidedJourneySnapshot(
      storedJourney,
      input.stepValueOverrides ?? {},
      input.normalizeJourney ?? false,
    );
    const project = this.projects.getProject(journey.projectId);
    if (project === null) throw new Error('Journey project was not found.');
    assertProductionConfirmed(
      project,
      input.confirmProduction ?? false,
      'Request discovery',
    );
    const targetIndex = journey.steps.findIndex(
      (step) => step.id === input.targetStepId,
    );
    const target = journey.steps[targetIndex];
    if (target === undefined)
      throw new Error('Target journey step was not found.');
    if (target.type !== 'click' && target.type !== 'submit') {
      throw new Error(
        'Request discovery target must be a click or submit step.',
      );
    }
    const discoveryId = randomUUID();
    const discoveredAt = new Date().toISOString();
    const storedSettings = this.settings.get(project.id);
    const runtime = resolveRuntime({
      runId: discoveryId,
      journey,
      declarations: storedSettings.variables,
      ephemeral: input.variables,
      hooks: [storedSettings.beforeRunHook, storedSettings.afterRunHook],
    });
    const storageStatePath = this.authStore.usablePath(project.id);
    const release = this.ownership.acquire('request_discovery');
    const events = new RunEventLog(`discovery-${discoveryId}`);
    let session: ReplayBrowserSession | null = null;
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
      let capture = false;
      const collector = new NetworkEvidenceCollector(null);
      session.observeNetwork((observation) => {
        if (capture) collector.observe(observation);
      });
      await session.navigate(project.targetUrl);
      for (const step of journey.steps.slice(0, targetIndex)) {
        await executeDiscoveryStep(session, step, runtime);
      }
      collector.markDiscoveryActionStarted();
      capture = true;
      await executeDiscoveryStep(session, target, runtime);
      await session.settle(750);
      capture = false;
      const ranked = rankRequestCandidates({
        candidates: collector.discoveryCandidates(),
        targetOrigin: new URL(project.targetUrl).origin,
        journeyName: journey.name,
        targetStepName: target.name,
        targetPathname: new URL(target.url).pathname,
      });
      return requestDiscoveryResultSchema.parse({
        discoveryId,
        discoveredAt,
        journeyId: journey.id,
        targetStepId: target.id,
        ...ranked,
      });
    } finally {
      if (session !== null) await session.close().catch(() => undefined);
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
  }
}

async function executeDiscoveryStep(
  session: ReplayBrowserSession,
  step: RecordedJourneyStep,
  runtime: ResolvedRuntime,
): Promise<void> {
  try {
    await executeRecordedStep(session, step, (item) =>
      resolveStepValue(item, runtime),
    );
  } catch (error: unknown) {
    if (error instanceof Error) {
      error.message = isStepValueSensitive(step, runtime)
        ? `Sensitive journey step “${step.name}” could not be replayed. Its value was omitted from diagnostics.`
        : redactSensitiveText(error.message, runtime);
      throw error;
    }
    throw error;
  }
}
