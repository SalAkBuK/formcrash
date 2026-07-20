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
import { isAuthenticationRedirect } from './authentication-redirect.js';

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
      const checked = result(
        projectId,
        'invalid',
        'authentication_expired',
        null,
        error instanceof Error
          ? error.message
          : 'Saved authentication state is unavailable.',
        checkedAt,
      );
      this.store.recordAccess({
        projectId,
        requirement: 'required',
        verification: 'expired',
        lastCheckedAt: checkedAt,
      });
      return checked;
    }

    const release = this.ownership.acquire('auth_validation');
    let session: ReplayBrowserSession | null = null;
    try {
      session = await this.browserOwner.launchReplay({
        targetUrl: project.targetUrl,
        headless: this.config.browserHeadless,
        timeoutMs: this.config.browserTimeoutMs,
        ...(storageStatePath === null ? {} : { storageStatePath }),
      });
      await session.navigate(project.targetUrl);
      const currentUrl = session.currentUrl();
      const redirectedToAuthentication =
        currentUrl === null
          ? false
          : isAuthenticationRedirect(project.targetUrl, currentUrl);
      const visibleAuthenticationRequirement =
        await session.detectAuthenticationRequired?.();
      const authenticationRequired =
        redirectedToAuthentication ||
        (visibleAuthenticationRequirement !== undefined &&
          visibleAuthenticationRequirement !== null);
      if (currentUrl === null && !authenticationRequired) {
        this.store.recordAccess({
          projectId,
          requirement: this.store.status(projectId).requirement ?? 'unknown',
          verification: 'inconclusive',
          lastCheckedAt: checkedAt,
        });
        return result(
          projectId,
          'runner_error',
          'inconclusive',
          null,
          'FormCrash loaded the target but could not determine its final address.',
          checkedAt,
        );
      }
      const previous = this.store.status(projectId);
      const outcome = authenticationRequired
        ? storageStatePath === null
          ? 'authentication_required'
          : 'authentication_expired'
        : storageStatePath === null
          ? 'target_accessible'
          : 'authenticated';
      this.store.recordAccess({
        projectId,
        requirement:
          outcome === 'target_accessible'
            ? normalizeRequirement(previous.requirement)
            : 'required',
        verification:
          outcome === 'authentication_expired'
            ? 'expired'
            : outcome === 'authentication_required'
              ? 'not_checked'
              : outcome === 'target_accessible'
                ? 'not_checked'
                : 'valid',
        lastCheckedAt: checkedAt,
      });
      return result(
        projectId,
        authenticationRequired ? 'invalid' : 'valid',
        outcome,
        currentUrl,
        authenticationRequired
          ? (visibleAuthenticationRequirement?.message ??
              (storageStatePath === null
                ? 'The configured target redirected to a login or authentication page.'
                : 'The saved session was redirected to a login or authentication page.'))
          : storageStatePath === null
            ? 'The configured URL loaded without redirecting to a recognized sign-in page. Protected areas may still require authentication.'
            : 'The saved browser state reached the configured target without an obvious login redirect.',
        checkedAt,
      );
    } catch {
      const previous = this.store.status(projectId);
      this.store.recordAccess({
        projectId,
        requirement: previous.requirement ?? 'unknown',
        verification: 'failed',
        lastCheckedAt: checkedAt,
      });
      return result(
        projectId,
        'runner_error',
        'target_unavailable',
        safeCurrentUrl(session),
        'FormCrash could not load the configured target to check access.',
        checkedAt,
      );
    } finally {
      if (session !== null) await session.close().catch(() => undefined);
      release();
    }
  }
}

function normalizeRequirement(
  requirement: ReturnType<AuthStateStore['status']>['requirement'],
): 'unknown' | 'user_confirmed_public' | 'required' {
  return requirement === 'user_confirmed_public' || requirement === 'required'
    ? requirement
    : 'unknown';
}

function result(
  projectId: string,
  status: AuthValidationResult['status'],
  outcome: NonNullable<AuthValidationResult['outcome']>,
  currentUrl: string | null,
  message: string,
  checkedAt: string,
): AuthValidationResult {
  return authValidationResultSchema.parse({
    projectId,
    status,
    outcome,
    currentUrl,
    message,
    checkedAt,
  });
}

function safeCurrentUrl(session: ReplayBrowserSession | null): string | null {
  if (session === null) return null;
  try {
    return session.currentUrl();
  } catch {
    return null;
  }
}
