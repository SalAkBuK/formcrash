import { randomUUID } from 'node:crypto';

import {
  controlledTargetUrlSchema,
  recordedJourneyStepSchema,
  recordingWarningSchema,
  replayLocatorSchema,
  targetFingerprintSchema,
  type PersistedJourney,
  type RecordedJourneyStep,
  type RecordingSession,
  type RecordingWarning,
  type SaveRecordedJourneyRequest,
} from '@formcrash/contracts';
import { z } from 'zod';

import type { ServerConfig } from '../../app/config.js';
import type { ProjectJourneyRepository } from '../../persistence/project-journey-repository.js';
import type { BrowserOwnership } from '../infrastructure/browser-ownership.js';
import {
  PlaywrightExternalBrowserOwner,
  type ExternalBrowserOwner,
  type RawRecordingEvent,
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
}

interface PendingRecording {
  readonly projectId: string;
  readonly sessionId: string;
  readonly steps: RecordedJourneyStep[];
  readonly warnings: RecordingWarning[];
}

export class RecordingNotActiveError extends Error {
  constructor() {
    super('The recording session is not active.');
    this.name = 'RecordingNotActiveError';
  }
}

export class RecordingManager {
  private readonly browserOwner: ExternalBrowserOwner;
  private active: ActiveRecording | null = null;

  constructor(
    private readonly config: ServerConfig,
    private readonly repository: ProjectJourneyRepository,
    private readonly ownership: BrowserOwnership,
    browserOwner?: ExternalBrowserOwner,
  ) {
    this.browserOwner = browserOwner ?? new PlaywrightExternalBrowserOwner();
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
    };
    this.repository.updateRecordingSession({
      id: created.id,
      status: 'launching',
    });

    try {
      const browser = await this.browserOwner.launchRecording(
        {
          targetUrl: project.targetUrl,
          headless: this.config.browserHeadless,
          timeoutMs: this.config.browserTimeoutMs,
        },
        {
          onEvent: (event, topFrame) =>
            this.captureEvent(pending, event, topFrame),
          onWarning: (warning, topFrame) =>
            this.captureWarning(pending, warning, topFrame),
          onNavigation: (url, timestamp) =>
            this.captureNavigation(pending, url, timestamp, project.targetUrl),
        },
      );
      this.active = { ...pending, browser, releaseOwnership };
      return this.repository.updateRecordingSession({
        id: created.id,
        status: 'recording',
      });
    } catch (error: unknown) {
      releaseOwnership();
      return this.repository.updateRecordingSession({
        id: created.id,
        status: 'runner_error',
        errorMessage: publicError(
          error,
          'Chromium could not start the recording.',
        ),
        completedAt: new Date().toISOString(),
      });
    }
  }

  get(sessionId: string): RecordingSession | null {
    const persisted = this.repository.getRecordingSession(sessionId);
    if (persisted === null) return null;
    if (this.active?.sessionId !== sessionId) return persisted;
    return {
      ...persisted,
      steps: [...this.active.steps],
      warnings: [...this.active.warnings],
    };
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
    let cleanupError: unknown;
    try {
      await active.browser.close();
    } catch (error: unknown) {
      cleanupError = error;
    } finally {
      active.releaseOwnership();
    }
    const completedAt = new Date().toISOString();
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
          'Consecutive input events for one locator are coalesced. A top-frame navigation immediately caused by a recorded click or submit is omitted.',
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
  ): void {
    if (!topFrame) {
      this.addWarning(pending, {
        code: 'iframe',
        message: 'Iframe interactions are unsupported and were not recorded.',
        timestamp: Date.now(),
        url: this.projectUrl(pending.projectId),
      });
      return;
    }
    const parsed = rawEventSchema.safeParse(input);
    if (!parsed.success) return;
    if (parsed.data.kind === 'navigate') {
      this.captureNavigation(
        pending,
        parsed.data.url,
        parsed.data.timestamp,
        this.projectUrl(pending.projectId),
      );
      return;
    }
    const event: RawRecordingEvent = parsed.data;
    const value = event.sensitive
      ? {
          kind: 'sensitive' as const,
          variableName: variableName(pending.sessionId, pending.steps.length),
        }
      : event.value === null
        ? null
        : { kind: 'safe' as const, value: event.value };
    const step = recordedJourneyStepSchema.parse({
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
    const previous = pending.steps.at(-1);
    if (
      step.type === 'fill' &&
      previous?.type === 'fill' &&
      previous.locator !== null &&
      JSON.stringify(previous.locator) === JSON.stringify(step.locator) &&
      step.timestamp - previous.timestamp <= 1_500
    ) {
      pending.steps[pending.steps.length - 1] = { ...step, id: previous.id };
      return;
    }
    pending.steps.push(step);
  }

  private captureNavigation(
    pending: PendingRecording,
    url: string,
    timestamp: number,
    fallbackUrl: string,
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
    pending.steps.push(
      recordedJourneyStepSchema.parse({
        id: randomUUID(),
        name: `Navigate to ${new URL(parsedUrl.data).pathname || '/'}`,
        type: 'navigate',
        timestamp,
        url: parsedUrl.data,
        locator: null,
        fingerprint: null,
        value: null,
        sensitive: false,
      }),
    );
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
  return `${verb} ${target}`;
}

function publicError(error: unknown, fallback: string): string {
  return error instanceof Error && error.message !== ''
    ? error.message
    : fallback;
}
