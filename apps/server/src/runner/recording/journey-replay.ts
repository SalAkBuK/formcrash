import { randomUUID } from 'node:crypto';

import {
  replayResultSchema,
  type RecordedJourneyStep,
  type ReplayResult,
} from '@formcrash/contracts';

import type { ServerConfig } from '../../app/config.js';
import type { ProjectJourneyRepository } from '../../persistence/project-journey-repository.js';
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
  ) {
    this.browserOwner = browserOwner ?? new PlaywrightExternalBrowserOwner();
  }

  async replay(journeyId: string): Promise<ReplayResult> {
    const journey = this.repository.getJourney(journeyId);
    if (journey === null) throw new Error('Journey was not found.');
    const project = this.repository.getProject(journey.projectId);
    if (project === null) throw new Error('Journey project was not found.');
    const release = this.ownership.acquire('replay');
    const replayId = randomUUID();
    const startedAt = new Date().toISOString();
    let session: ReplayBrowserSession | null = null;
    let result: ReplayResult | null = null;
    try {
      session = await this.browserOwner.launchReplay({
        targetUrl: project.targetUrl,
        headless: this.config.browserHeadless,
        timeoutMs: this.config.browserTimeoutMs,
      });
      await session.navigate(project.targetUrl);
      for (const [index, step] of journey.steps.entries()) {
        try {
          await executeStep(session, step);
        } catch {
          result = replayResultSchema.parse({
            replayId,
            journeyId,
            status: 'failed',
            failedStep: {
              stepId: step.id,
              stepName: step.name,
              stepNumber: index + 1,
              actionType: step.type,
              message: `Step ${index + 1} could not be replayed within the bounded wait.`,
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
      release();
    }
    if (result === null) throw new Error('Replay did not produce a result.');
    return result;
  }
}

async function executeStep(
  session: ReplayBrowserSession,
  step: RecordedJourneyStep,
): Promise<void> {
  if (step.type === 'navigate') {
    await session.navigate(step.url);
    return;
  }
  if (step.locator === null) throw new Error('Recorded step has no locator.');
  switch (step.type) {
    case 'click':
      await session.click(step.locator);
      return;
    case 'fill':
      await session.fill(step.locator, resolveValue(step));
      return;
    case 'checkbox':
    case 'radio':
      await session.setChecked(step.locator, resolveValue(step) === 'true');
      return;
    case 'select':
      await session.select(step.locator, resolveValue(step));
      return;
    case 'submit':
      await session.submit(step.locator);
      return;
  }
}

function resolveValue(step: RecordedJourneyStep): string {
  if (step.value === null) throw new Error('Recorded step has no value.');
  if (step.value.kind === 'safe') return step.value.value;
  const value = process.env[step.value.variableName];
  if (value === undefined) {
    throw new Error(
      `Runtime variable ${step.value.variableName} is not configured.`,
    );
  }
  return value;
}
