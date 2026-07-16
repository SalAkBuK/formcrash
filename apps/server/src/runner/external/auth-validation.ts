import {
  authValidationResultSchema,
  type AuthValidationResult,
} from '@formcrash/contracts';

import type { ServerConfig } from '../../app/config.js';
import type { ProjectJourneyRepository } from '../../persistence/project-journey-repository.js';
import type { BrowserOwnership } from '../infrastructure/browser-ownership.js';
import {
  PlaywrightExternalBrowserOwner,
  type ExternalBrowserOwner,
  type ReplayBrowserSession,
} from '../recording/external-browser.js';
import type { AuthStateStore } from './auth-session.js';

export class AuthValidationService {
  private readonly browserOwner: ExternalBrowserOwner;

  constructor(
    private readonly config: ServerConfig,
    private readonly projects: ProjectJourneyRepository,
    private readonly store: AuthStateStore,
    private readonly ownership: BrowserOwnership,
    browserOwner?: ExternalBrowserOwner,
  ) {
    this.browserOwner = browserOwner ?? new PlaywrightExternalBrowserOwner();
  }

  async validate(projectId: string): Promise<AuthValidationResult> {
    const project = this.projects.getProject(projectId);
    if (project === null) throw new Error('Project was not found.');
    const checkedAt = new Date().toISOString();
    let storageStatePath: string | null;
    try {
      storageStatePath = this.store.usablePath(projectId);
    } catch (error: unknown) {
      return result(
        projectId,
        'invalid',
        null,
        error instanceof Error
          ? error.message
          : 'Saved authentication state is unavailable.',
        checkedAt,
      );
    }
    if (storageStatePath === null) {
      return result(
        projectId,
        'invalid',
        null,
        'No saved authentication state exists for this project.',
        checkedAt,
      );
    }

    const release = this.ownership.acquire('auth_validation');
    let session: ReplayBrowserSession | null = null;
    try {
      session = await this.browserOwner.launchReplay({
        targetUrl: project.targetUrl,
        headless: this.config.browserHeadless,
        timeoutMs: this.config.browserTimeoutMs,
        storageStatePath,
      });
      await session.navigate(project.targetUrl);
      const currentUrl = session.currentUrl();
      const target = new URL(project.targetUrl);
      const current = new URL(currentUrl);
      const redirectedToAuthentication =
        current.origin !== target.origin ||
        (!looksLikeAuthenticationPath(target.pathname) &&
          looksLikeAuthenticationPath(current.pathname));
      return result(
        projectId,
        redirectedToAuthentication ? 'invalid' : 'valid',
        currentUrl,
        redirectedToAuthentication
          ? 'The saved session was redirected to a login or authentication page.'
          : 'The saved browser state reached the configured target without an obvious login redirect.',
        checkedAt,
      );
    } catch {
      return result(
        projectId,
        'runner_error',
        safeCurrentUrl(session),
        'Authentication validation could not load the configured target.',
        checkedAt,
      );
    } finally {
      if (session !== null) await session.close().catch(() => undefined);
      release();
    }
  }
}

function result(
  projectId: string,
  status: AuthValidationResult['status'],
  currentUrl: string | null,
  message: string,
  checkedAt: string,
): AuthValidationResult {
  return authValidationResultSchema.parse({
    projectId,
    status,
    currentUrl,
    message,
    checkedAt,
  });
}

function looksLikeAuthenticationPath(pathname: string): boolean {
  return /(?:^|\/)(?:login|log-in|signin|sign-in|auth|authenticate)(?:\/|$)/iu.test(
    pathname,
  );
}

function safeCurrentUrl(session: ReplayBrowserSession | null): string | null {
  if (session === null) return null;
  try {
    return session.currentUrl();
  } catch {
    return null;
  }
}
