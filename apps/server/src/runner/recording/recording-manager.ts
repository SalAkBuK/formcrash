import { randomUUID } from 'node:crypto';
import path from 'node:path';

import {
  controlledTargetUrlSchema,
  hybridTraceManifestSchema,
  recordedBrowserEnvironmentSchema,
  recordedInteractionSchema,
  recordedPostconditionSchema,
  recordedJourneyStepSchema,
  recordedTargetCandidateSchema,
  recordedTargetGeometrySchema,
  recordingWarningSchema,
  replayLocatorSchema,
  targetFingerprintSchema,
  traceSummarySchema,
  type HybridTraceManifest,
  type RecordedBrowserEnvironment,
  type RecordedInteraction,
  type RecordedVideoArtifact,
  type PersistedJourney,
  type RecordedJourneyStep,
  type RecordingSession,
  type RecordingWarning,
  type TraceSummary,
  type SaveRecordedJourneyRequest,
} from '@formcrash/contracts';
import { z } from 'zod';

import type { ServerConfig } from '../../app/config.js';
import { JourneyTraceStore } from '../../artifacts/journey-trace-store.js';
import type { ProjectJourneyRepository } from '../../persistence/project-journey-repository.js';
import type { AuthStateStore } from '../external/auth-session.js';
import { NetworkEvidenceCollector } from '../external/network-evidence.js';
import {
  isAuthenticationRedirect,
  SavedAuthenticationExpiredError,
} from '../external/authentication-redirect.js';
import type { BrowserOwnership } from '../infrastructure/browser-ownership.js';
import {
  PlaywrightExternalBrowserOwner,
  type ExternalBrowserOwner,
  type RawRecordingEvent,
  type RawTraceEvent,
  type RecordingEventContext,
  type RecordingBrowserSession,
} from './external-browser.js';

const rawEventSchema = z.discriminatedUnion('kind', [
  z.object({
    kind: z.enum(['click', 'fill', 'checkbox', 'radio', 'select', 'submit']),
    timestamp: z.number().int().nonnegative(),
    url: controlledTargetUrlSchema,
    locator: replayLocatorSchema,
    fingerprint: targetFingerprintSchema,
    value: z.string().max(10_000).nullable(),
    sensitive: z.boolean(),
    pointerType: z.enum(['mouse', 'pen', 'touch']).nullable().default(null),
    targetCandidates: z
      .array(recordedTargetCandidateSchema)
      .max(12)
      .default([]),
    geometry: recordedTargetGeometrySchema.nullable().default(null),
    postconditions: z.array(recordedPostconditionSchema).max(12).default([]),
  }),
  z.object({
    kind: z.literal('navigate'),
    timestamp: z.number().int().nonnegative(),
    url: controlledTargetUrlSchema,
  }),
]);

interface ActiveRecording {
  readonly projectId: string;
  readonly sessionId: string;
  readonly browser: RecordingBrowserSession;
  readonly releaseOwnership: () => void;
  readonly steps: RecordedJourneyStep[];
  readonly warnings: RecordingWarning[];
  readonly interactions: RecordedInteraction[];
  readonly traceEvents: unknown[];
  readonly pageIds: Set<string>;
  readonly framePaths: Set<string>;
  readonly networkEvidence: NetworkEvidenceCollector;
  environment: RecordedBrowserEnvironment | null;
  readonly maximumDurationTimer: NodeJS.Timeout;
}

interface PendingRecording {
  readonly projectId: string;
  readonly sessionId: string;
  readonly steps: RecordedJourneyStep[];
  readonly warnings: RecordingWarning[];
  readonly interactions: RecordedInteraction[];
  readonly traceEvents: unknown[];
  readonly pageIds: Set<string>;
  readonly framePaths: Set<string>;
  readonly networkEvidence: NetworkEvidenceCollector;
  environment: RecordedBrowserEnvironment | null;
}

export class RecordingNotActiveError extends Error {
  constructor() {
    super('The recording session is not active.');
    this.name = 'RecordingNotActiveError';
  }
}

export class RecordingManager {
  private readonly browserOwner: ExternalBrowserOwner;
  private readonly traceStore: JourneyTraceStore;
  private pending: PendingRecording | null = null;
  private active: ActiveRecording | null = null;

  constructor(
    private readonly config: ServerConfig,
    private readonly repository: ProjectJourneyRepository,
    private readonly ownership: BrowserOwnership,
    browserOwner?: ExternalBrowserOwner,
    private readonly authStore?: AuthStateStore,
  ) {
    this.browserOwner = browserOwner ?? new PlaywrightExternalBrowserOwner();
    this.traceStore = new JourneyTraceStore(config.artifactRoot, repository);
  }

  async start(projectId: string): Promise<RecordingSession> {
    const project = this.repository.getProject(projectId);
    if (project === null) throw new Error('Project was not found.');
    const releaseOwnership = this.ownership.acquire('recording');
    const created = this.repository.createRecordingSession(projectId);
    const pending: PendingRecording = {
      projectId,
      sessionId: created.id,
      steps: [],
      warnings: [],
      interactions: [],
      traceEvents: [],
      pageIds: new Set(['page-1']),
      framePaths: new Set(['']),
      networkEvidence: new NetworkEvidenceCollector(null),
      environment: null,
    };
    this.pending = pending;
    this.repository.updateRecordingSession({
      id: created.id,
      status: 'launching',
    });

    try {
      const storageStatePath = this.authStore?.usablePath(projectId) ?? null;
      const browser = await this.browserOwner.launchRecording(
        {
          targetUrl: project.targetUrl,
          headless: this.config.browserHeadless,
          timeoutMs: this.config.browserTimeoutMs,
          recordVideoDirectory: path.join(
            this.config.artifactRoot,
            'journey-traces',
            created.id,
            'videos',
          ),
          ...(storageStatePath === null ? {} : { storageStatePath }),
        },
        {
          onEvent: (event, topFrame, context) =>
            this.captureEvent(pending, event, topFrame, context),
          onWarning: (warning, topFrame) =>
            this.captureWarning(pending, warning, topFrame),
          onNavigation: (url, timestamp, context) =>
            this.captureNavigation(
              pending,
              url,
              timestamp,
              project.targetUrl,
              context,
            ),
          onTraceEvent: (event, context) =>
            this.captureTraceEvent(pending, event, context),
          onEnvironment: (environment) => {
            pending.environment =
              recordedBrowserEnvironmentSchema.parse(environment);
          },
        },
      );
      browser.observeNetwork?.((observation) =>
        pending.networkEvidence.observe(observation),
      );
      try {
        const currentUrl = browser.currentUrl?.();
        const visibleRequirement =
          await browser.detectAuthenticationRequired?.();
        if (
          (currentUrl !== undefined &&
            isAuthenticationRedirect(project.targetUrl, currentUrl)) ||
          (visibleRequirement !== undefined && visibleRequirement !== null)
        ) {
          throw new SavedAuthenticationExpiredError();
        }
      } catch (error: unknown) {
        await browser.close().catch(() => undefined);
        throw error;
      }
      const maximumDurationTimer = setTimeout(
        () => {
          if (this.active?.sessionId === created.id) {
            void this.stop(created.id).catch(() => undefined);
          }
        },
        30 * 60 * 1_000,
      );
      maximumDurationTimer.unref();
      this.active = {
        ...pending,
        browser,
        releaseOwnership,
        maximumDurationTimer,
      };
      this.pending = null;
      return this.repository.updateRecordingSession({
        id: created.id,
        status: 'recording',
      });
    } catch (error: unknown) {
      if (this.pending?.sessionId === created.id) this.pending = null;
      releaseOwnership();
      this.traceStore.removeRecording(created.id);
      const authenticationRequired =
        error instanceof SavedAuthenticationExpiredError;
      const failed = this.repository.updateRecordingSession({
        id: created.id,
        status: 'runner_error',
        authenticationRequired,
        errorMessage: publicError(
          error,
          'Chromium could not start the recording.',
        ),
        completedAt: new Date().toISOString(),
        ...(authenticationRequired
          ? { steps: [], warnings: [], traceStatus: 'not_captured' as const }
          : {}),
      });
      if (authenticationRequired) throw error;
      return failed;
    }
  }

  get(sessionId: string): RecordingSession | null {
    const persisted = this.repository.getRecordingSession(sessionId);
    if (persisted === null) return null;
    const inMemory =
      this.active?.sessionId === sessionId
        ? this.active
        : this.pending?.sessionId === sessionId
          ? this.pending
          : null;
    if (inMemory === null) return persisted;
    return {
      ...persisted,
      steps: [...inMemory.steps],
      warnings: [...inMemory.warnings],
    };
  }

  getActiveForProject(projectId: string): RecordingSession | null {
    const session =
      this.active?.projectId === projectId
        ? this.active
        : this.pending?.projectId === projectId
          ? this.pending
          : null;
    return session === null ? null : this.get(session.sessionId);
  }

  async stop(sessionId: string): Promise<RecordingSession> {
    const active = this.active;
    if (active === null || active.sessionId !== sessionId) {
      throw new RecordingNotActiveError();
    }
    this.repository.updateRecordingSession({
      id: sessionId,
      status: 'stopping',
    });
    this.active = null;
    clearTimeout(active.maximumDurationTimer);
    let cleanupError: unknown;
    try {
      await active.browser.close();
    } catch (error: unknown) {
      cleanupError = error;
    } finally {
      active.releaseOwnership();
    }
    const completedAt = new Date().toISOString();
    let traceStatus: 'complete' | 'truncated' | 'corrupt';
    let traceSummary: TraceSummary | null = null;
    if (cleanupError === undefined) {
      try {
        const videos = this.traceStore.describeVideos(
          active.browser.recordedVideoPaths?.() ?? [],
        );
        const manifest = this.traceManifest(active, videos);
        this.traceStore.persist(sessionId, manifest, active.traceEvents);
        traceStatus = manifest.truncated ? 'truncated' : 'complete';
        traceSummary = traceSummarySchema.parse({
          interactionCount: manifest.interactions.length,
          eventCount: manifest.eventCount,
          pageCount: manifest.pageCount,
          frameCount: manifest.frameCount,
          videoCaptured: manifest.videoCaptured,
          truncated: manifest.truncated,
        });
      } catch {
        traceStatus = 'corrupt';
        this.traceStore.removeRecording(sessionId);
      }
    } else {
      traceStatus = 'corrupt';
      this.traceStore.removeRecording(sessionId);
    }
    return this.repository.updateRecordingSession({
      id: sessionId,
      status: cleanupError === undefined ? 'completed' : 'runner_error',
      steps: active.steps,
      warnings: active.warnings,
      errorMessage:
        cleanupError === undefined
          ? null
          : 'Chromium cleanup did not complete successfully.',
      completedAt,
      traceStatus,
      traceSummary,
      requestEvidence: active.networkEvidence.recordingEvidence(
        active.steps.filter((step) => ['click', 'submit'].includes(step.type)),
      ),
    });
  }

  save(
    projectId: string,
    sessionId: string,
    input: SaveRecordedJourneyRequest,
  ): PersistedJourney {
    const session = this.repository.getRecordingSession(sessionId);
    if (session === null || session.projectId !== projectId) {
      throw new Error('Recording session was not found for this project.');
    }
    if (session.status !== 'completed') {
      throw new Error('Only a completed recording can be saved as a journey.');
    }
    const supplied = input.steps ?? session.steps;
    const steps = recordedJourneyStepSchema
      .array()
      .min(1)
      .parse(
        supplied.map((step, index) => sanitizeStep(step, sessionId, index)),
      );
    const project = this.repository.getProject(projectId);
    if (project === null) throw new Error('Project was not found.');
    const expectedOrigin = new URL(project.targetUrl).origin;
    if (steps.some((step) => new URL(step.url).origin !== expectedOrigin)) {
      throw new Error(
        'Recorded journey steps must remain on the project origin.',
      );
    }
    return this.repository.saveJourney({
      projectId,
      name: input.name,
      steps,
      metadata: {
        recordingSessionId: sessionId,
        recordedAt: session.startedAt,
        warningCount: session.warnings.length,
        normalizationRule:
          'Consecutive input events for one locator are coalesced until another recorded action occurs. A top-frame navigation immediately caused by a recorded click or submit is omitted.',
      },
    });
  }

  async close(): Promise<void> {
    if (this.active !== null) await this.stop(this.active.sessionId);
  }

  private captureEvent(
    pending: PendingRecording,
    input: unknown,
    topFrame: boolean,
    context?: RecordingEventContext,
  ): void {
    const parsed = rawEventSchema.safeParse(input);
    if (!parsed.success) return;
    if (parsed.data.kind === 'navigate') {
      this.captureNavigation(
        pending,
        parsed.data.url,
        parsed.data.timestamp,
        this.projectUrl(pending.projectId),
        context,
      );
      return;
    }
    const event: RawRecordingEvent = parsed.data;
    if (context !== undefined) {
      pending.pageIds.add(context.pageId);
      pending.framePaths.add(
        `${context.pageId}:${context.framePath.join('/')}`,
      );
    }
    if (
      !topFrame &&
      new URL(event.url).origin !==
        new URL(this.projectUrl(pending.projectId)).origin
    ) {
      this.addWarning(pending, {
        code: 'iframe',
        message:
          'Cross-origin iframe interaction was not recorded because the frame origin is not allowlisted.',
        timestamp: event.timestamp,
        url: this.projectUrl(pending.projectId),
      });
      return;
    }
    const value = event.sensitive
      ? {
          kind: 'sensitive' as const,
          variableName: variableName(pending.sessionId, pending.steps.length),
        }
      : event.value === null
        ? null
        : { kind: 'safe' as const, value: event.value };
    const parsedStep = recordedJourneyStepSchema.safeParse({
      id: randomUUID(),
      name: defaultStepName(event),
      type: event.kind,
      timestamp: event.timestamp,
      url: event.url,
      locator: event.locator,
      fingerprint: event.fingerprint,
      value,
      sensitive: event.sensitive,
    });
    if (!parsedStep.success) return;
    const step = parsedStep.data;
    const previous = pending.steps.at(-1);
    if (
      step.type === 'fill' &&
      previous?.type === 'fill' &&
      previous.locator !== null &&
      JSON.stringify(previous.locator) === JSON.stringify(step.locator)
    ) {
      pending.steps[pending.steps.length - 1] = { ...step, id: previous.id };
      pending.interactions[pending.interactions.length - 1] =
        this.interactionFor(
          { ...step, id: previous.id },
          event,
          pending.interactions.length,
          context,
        );
      return;
    }
    pending.steps.push(step);
    pending.interactions.push(
      this.interactionFor(step, event, pending.interactions.length, context),
    );
  }

  private captureNavigation(
    pending: PendingRecording,
    url: string,
    timestamp: number,
    fallbackUrl: string,
    context?: RecordingEventContext,
  ): void {
    const parsedUrl = controlledTargetUrlSchema.safeParse(url);
    if (!parsedUrl.success) return;
    if (new URL(parsedUrl.data).origin !== new URL(fallbackUrl).origin) {
      this.addWarning(pending, {
        code: 'third_party_payment',
        message:
          'Cross-origin and third-party payment navigation is unsupported.',
        timestamp,
        url: fallbackUrl,
      });
      return;
    }
    if (isAuthenticationRedirect(fallbackUrl, parsedUrl.data)) {
      void this.stopForAuthentication(pending.sessionId);
      return;
    }
    const previous = pending.steps.at(-1);
    if (
      previous !== undefined &&
      ['click', 'submit'].includes(previous.type) &&
      timestamp - previous.timestamp <= 1_500
    ) {
      return;
    }
    if (previous?.type === 'navigate' && previous.url === parsedUrl.data)
      return;
    const parsedStep = recordedJourneyStepSchema.safeParse({
      id: randomUUID(),
      name: boundedStepName(
        `Navigate to ${new URL(parsedUrl.data).pathname || '/'}`,
      ),
      type: 'navigate',
      timestamp,
      url: parsedUrl.data,
      locator: null,
      fingerprint: null,
      value: null,
      sensitive: false,
    });
    if (parsedStep.success) {
      pending.steps.push(parsedStep.data);
      if (context !== undefined) {
        pending.pageIds.add(context.pageId);
        pending.framePaths.add(
          `${context.pageId}:${context.framePath.join('/')}`,
        );
      }
      pending.interactions.push(
        recordedInteractionSchema.parse({
          id: randomUUID(),
          stepId: parsedStep.data.id,
          sequence: pending.interactions.length + 1,
          pageId: context?.pageId ?? 'page-1',
          framePath: context?.framePath ?? [],
          startedAt: timestamp,
          durationMs: 0,
          intent: 'navigate',
          pointerType: null,
          targetCandidates: [],
          fingerprint: null,
          geometry: null,
          postconditions: [
            { kind: 'url', value: parsedUrl.data, target: null },
          ],
          retrySafety: 'side_effect_possible',
        }),
      );
    }
  }

  private async stopForAuthentication(sessionId: string): Promise<void> {
    const active = this.active;
    if (active === null || active.sessionId !== sessionId) return;

    this.active = null;
    clearTimeout(active.maximumDurationTimer);
    this.repository.updateRecordingSession({
      id: sessionId,
      status: 'runner_error',
      steps: [],
      warnings: [],
      authenticationRequired: true,
      errorMessage:
        'Recording stopped because the application required sign-in. Sign in again and recapture authentication before recording a new journey.',
      completedAt: new Date().toISOString(),
      traceStatus: 'not_captured',
      traceSummary: null,
      requestEvidence: [],
    });
    this.traceStore.removeRecording(sessionId);

    try {
      await active.browser.close();
    } catch {
      // Authentication recovery is still the actionable state when Chromium
      // cleanup also fails, so do not replace it with a generic runner error.
    } finally {
      active.releaseOwnership();
    }
  }

  private captureWarning(
    pending: PendingRecording,
    input: unknown,
    topFrame: boolean,
  ): void {
    const parsed = recordingWarningSchema.safeParse(input);
    if (!topFrame) {
      this.addWarning(pending, {
        code: 'iframe',
        message: 'Iframe interactions are unsupported and were not recorded.',
        timestamp: parsed.success ? parsed.data.timestamp : Date.now(),
        url: parsed.success
          ? parsed.data.url
          : this.projectUrl(pending.projectId),
      });
      return;
    }
    if (parsed.success) this.addWarning(pending, parsed.data);
  }

  private addWarning(
    pending: PendingRecording,
    warning: RecordingWarning,
  ): void {
    const duplicate = pending.warnings.some(
      (item) => item.code === warning.code && item.url === warning.url,
    );
    if (!duplicate)
      pending.warnings.push(recordingWarningSchema.parse(warning));
  }

  private projectUrl(projectId: string): string {
    return (
      this.repository.getProject(projectId)?.targetUrl ?? 'http://localhost/'
    );
  }

  private captureTraceEvent(
    pending: PendingRecording,
    input: unknown,
    context: RecordingEventContext,
  ): void {
    if (pending.traceEvents.length >= 100_000) return;
    const event = input as RawTraceEvent;
    if (
      typeof event !== 'object' ||
      event === null ||
      typeof event.kind !== 'string' ||
      typeof event.timestamp !== 'number'
    ) {
      return;
    }
    pending.pageIds.add(context.pageId);
    pending.framePaths.add(`${context.pageId}:${context.framePath.join('/')}`);
    pending.traceEvents.push({ ...event, ...context });
  }

  private interactionFor(
    step: RecordedJourneyStep,
    event: RawRecordingEvent,
    index: number,
    context?: RecordingEventContext,
  ): RecordedInteraction {
    return recordedInteractionSchema.parse({
      id: randomUUID(),
      stepId: step.id,
      sequence: index + 1,
      pageId: context?.pageId ?? 'page-1',
      framePath: context?.framePath ?? [],
      startedAt: event.timestamp,
      durationMs: 0,
      intent: event.kind,
      pointerType: event.pointerType,
      targetCandidates:
        event.targetCandidates.length === 0
          ? [{ locator: event.locator, source: 'structure', confidence: 0.5 }]
          : event.targetCandidates,
      fingerprint: event.fingerprint,
      geometry: event.geometry,
      postconditions: event.postconditions,
      retrySafety: ['click', 'submit'].includes(event.kind)
        ? 'side_effect_possible'
        : 'safe',
    });
  }

  private traceManifest(
    recording: ActiveRecording,
    videos: readonly RecordedVideoArtifact[],
  ): HybridTraceManifest {
    const environment =
      recording.environment ??
      recordedBrowserEnvironmentSchema.parse({
        viewportWidth: 1440,
        viewportHeight: 900,
        deviceScaleFactor: 1,
        locale: 'en-US',
        timezoneId: 'UTC',
        userAgent: 'FormCrash controlled Chromium',
        colorScheme: 'light',
        browserName: 'chromium',
        browserVersion: 'unknown',
      });
    return hybridTraceManifestSchema.parse({
      formatVersion: 2,
      environment,
      interactions: recording.interactions,
      eventCount: recording.traceEvents.length,
      pageCount: Math.max(recording.pageIds.size, 1),
      frameCount: Math.max(recording.framePaths.size, 1),
      redactionVersion: 1,
      videoCaptured: videos.length > 0,
      videos,
      truncated: recording.traceEvents.length >= 100_000,
    });
  }
}

function sanitizeStep(
  input: RecordedJourneyStep,
  sessionId: string,
  index: number,
): RecordedJourneyStep {
  const mustMask =
    input.sensitive ||
    input.fingerprint?.inputType?.toLowerCase() === 'password';
  if (!mustMask) return input;
  return {
    ...input,
    sensitive: true,
    value: {
      kind: 'sensitive',
      variableName:
        input.value?.kind === 'sensitive'
          ? input.value.variableName
          : variableName(sessionId, index),
    },
  };
}

function variableName(sessionId: string, index: number): string {
  return `FORMCRASH_SECRET_${sessionId.replace(/[^a-zA-Z0-9]/gu, '_').toUpperCase()}_${index + 1}`;
}

function defaultStepName(event: RawRecordingEvent): string {
  const target =
    event.fingerprint.label ??
    event.fingerprint.accessibleName ??
    event.fingerprint.name ??
    event.fingerprint.tagName;
  const verb = {
    click: 'Click',
    fill: 'Fill',
    checkbox: 'Set checkbox',
    radio: 'Select radio',
    select: 'Select',
    submit: 'Submit',
  }[event.kind];
  return boundedStepName(`${verb} ${target}`);
}

function boundedStepName(value: string): string {
  return value.slice(0, 160).trimEnd();
}

function publicError(error: unknown, fallback: string): string {
  return error instanceof Error && error.message !== ''
    ? error.message
    : fallback;
}
