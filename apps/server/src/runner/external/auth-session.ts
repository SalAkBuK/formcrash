import { existsSync, mkdirSync, renameSync, rmSync } from 'node:fs';
import path from 'node:path';

import {
  chromium,
  type Browser,
  type BrowserContext,
  type Page,
} from 'playwright';
import type {
  AuthCaptureSession,
  ProjectAuthStatus,
} from '@formcrash/contracts';

import type { ServerConfig } from '../../app/config.js';
import type { ProjectJourneyRepository } from '../../persistence/project-journey-repository.js';
import type {
  ProjectSettingsRepository,
  StoredAuthSession,
} from '../../persistence/project-settings-repository.js';
import type { BrowserOwnership } from '../infrastructure/browser-ownership.js';

interface AuthBrowserSession {
  saveStorageState(destination: string): Promise<void>;
  close(): Promise<void>;
}

export interface AuthenticationBrowserOwner {
  launch(options: {
    readonly targetUrl: string;
    readonly headless: boolean;
    readonly timeoutMs: number;
  }): Promise<AuthBrowserSession>;
}

class PlaywrightAuthBrowserSession implements AuthBrowserSession {
  private closed = false;

  constructor(
    private readonly browser: Browser,
    private readonly context: BrowserContext,
  ) {}

  async saveStorageState(destination: string): Promise<void> {
    await this.context.storageState({ path: destination });
  }

  async close(): Promise<void> {
    if (this.closed) return;
    this.closed = true;
    await this.context.close();
    await this.browser.close();
  }
}

export class PlaywrightAuthenticationBrowserOwner implements AuthenticationBrowserOwner {
  constructor(
    private readonly afterPageReady?: (page: Page) => Promise<void>,
  ) {}

  async launch(options: {
    readonly targetUrl: string;
    readonly headless: boolean;
    readonly timeoutMs: number;
  }): Promise<AuthBrowserSession> {
    const browser = await chromium.launch({ headless: options.headless });
    try {
      const context = await browser.newContext();
      const page = await context.newPage();
      page.setDefaultTimeout(options.timeoutMs);
      await page.goto(options.targetUrl, { waitUntil: 'load' });
      await this.afterPageReady?.(page);
      return new PlaywrightAuthBrowserSession(browser, context);
    } catch (error: unknown) {
      await browser.close().catch(() => undefined);
      throw error;
    }
  }
}

export class AuthStateStore {
  readonly root: string;

  constructor(
    artifactRoot: string,
    private readonly repository: ProjectSettingsRepository,
  ) {
    this.root = path.resolve(artifactRoot);
  }

  status(projectId: string): ProjectAuthStatus {
    const metadata = this.repository.getAuthSession(projectId);
    const access = this.repository.getAuthAccess(projectId);
    if (metadata === null) {
      return {
        configured: false,
        available: false,
        capturedAt: null,
        missingReason: null,
        requirement: access.requirement,
        verification: access.verification,
        lastCheckedAt: access.lastCheckedAt,
      };
    }
    const available = existsSync(this.resolve(metadata.relativePath));
    return {
      configured: true,
      available,
      capturedAt: metadata.capturedAt,
      missingReason: available
        ? null
        : 'Saved authentication state is missing from local runtime storage.',
      requirement: access.requirement,
      verification: access.verification,
      lastCheckedAt: access.lastCheckedAt,
    };
  }

  recordAccess(input: {
    readonly projectId: string;
    readonly requirement: 'unknown' | 'not_required' | 'required';
    readonly verification:
      'not_checked' | 'valid' | 'expired' | 'failed' | 'inconclusive';
    readonly lastCheckedAt: string | null;
  }): void {
    this.repository.saveAuthAccess(input);
  }

  usablePath(projectId: string): string | null {
    const metadata = this.repository.getAuthSession(projectId);
    if (metadata === null) return null;
    const resolved = this.resolve(metadata.relativePath);
    if (!existsSync(resolved)) {
      throw new Error(
        'Saved authentication state is missing from local runtime storage.',
      );
    }
    return resolved;
  }

  async save(projectId: string, session: AuthBrowserSession): Promise<void> {
    assertSafeId(projectId);
    const relativePath = path.posix.join(
      'auth',
      projectId,
      'storage-state.json',
    );
    const destination = this.resolve(relativePath);
    const temporary = `${destination}.tmp`;
    mkdirSync(path.dirname(destination), { recursive: true });
    try {
      await session.saveStorageState(temporary);
      renameSync(temporary, destination);
      const now = new Date().toISOString();
      const metadata: StoredAuthSession = {
        projectId,
        relativePath,
        capturedAt: now,
        updatedAt: now,
      };
      this.repository.saveAuthSession(metadata);
      this.repository.saveAuthAccess({
        projectId,
        requirement: 'required',
        verification: 'not_checked',
        lastCheckedAt: null,
      });
    } finally {
      rmSync(temporary, { force: true });
    }
  }

  clear(projectId: string): void {
    const metadata = this.repository.getAuthSession(projectId);
    if (metadata !== null) {
      rmSync(this.resolve(metadata.relativePath), { force: true });
    }
    this.repository.clearAuthSession(projectId);
  }

  private resolve(relativePath: string): string {
    if (path.isAbsolute(relativePath))
      throw new Error('Authentication path must be relative.');
    const resolved = path.resolve(this.root, relativePath);
    const relation = path.relative(this.root, resolved);
    if (relation.startsWith('..') || path.isAbsolute(relation)) {
      throw new Error('Authentication path escapes runtime storage.');
    }
    return resolved;
  }
}

interface ActiveCapture {
  readonly id: string;
  readonly projectId: string;
  readonly browser: AuthBrowserSession;
  readonly release: () => void;
}

export class AuthCaptureManager {
  private active: ActiveCapture | null = null;

  constructor(
    private readonly config: ServerConfig,
    private readonly projects: ProjectJourneyRepository,
    private readonly repository: ProjectSettingsRepository,
    private readonly store: AuthStateStore,
    private readonly ownership: BrowserOwnership,
    private readonly browserOwner: AuthenticationBrowserOwner = new PlaywrightAuthenticationBrowserOwner(),
  ) {}

  async start(projectId: string): Promise<AuthCaptureSession> {
    const project = this.projects.getProject(projectId);
    if (project === null) throw new Error('Project was not found.');
    const release = this.ownership.acquire('auth_capture');
    let created: AuthCaptureSession;
    try {
      created = this.repository.createAuthCapture(projectId);
      this.repository.updateAuthCapture({
        id: created.id,
        status: 'launching',
      });
    } catch (error: unknown) {
      release();
      throw error;
    }
    try {
      const browser = await this.browserOwner.launch({
        targetUrl: project.targetUrl,
        headless: this.config.browserHeadless,
        timeoutMs: this.config.browserTimeoutMs,
      });
      this.active = { id: created.id, projectId, browser, release };
      return this.repository.updateAuthCapture({
        id: created.id,
        status: 'awaiting_confirmation',
      });
    } catch {
      release();
      return this.repository.updateAuthCapture({
        id: created.id,
        status: 'runner_error',
        errorMessage: 'Chromium could not start authentication capture.',
        completedAt: new Date().toISOString(),
      });
    }
  }

  get(id: string): AuthCaptureSession | null {
    return this.repository.getAuthCapture(id);
  }

  async confirm(id: string): Promise<AuthCaptureSession> {
    const active = this.active;
    if (active === null || active.id !== id) {
      throw new Error('Authentication capture is not active.');
    }
    this.repository.updateAuthCapture({ id, status: 'stopping' });
    this.active = null;
    try {
      await this.store.save(active.projectId, active.browser);
      await active.browser.close();
      return this.repository.updateAuthCapture({
        id,
        status: 'completed',
        errorMessage: null,
        completedAt: new Date().toISOString(),
      });
    } catch {
      await active.browser.close().catch(() => undefined);
      return this.repository.updateAuthCapture({
        id,
        status: 'runner_error',
        errorMessage: 'Authentication state could not be saved locally.',
        completedAt: new Date().toISOString(),
      });
    } finally {
      active.release();
    }
  }

  async cancel(id: string): Promise<AuthCaptureSession> {
    const active = this.active;
    if (active === null || active.id !== id) {
      throw new Error('Authentication capture is not active.');
    }
    this.active = null;
    try {
      await active.browser.close();
      return this.repository.updateAuthCapture({
        id,
        status: 'cancelled',
        errorMessage: null,
        completedAt: new Date().toISOString(),
      });
    } finally {
      active.release();
    }
  }

  async close(): Promise<void> {
    if (this.active === null) return;
    const active = this.active;
    this.active = null;
    await active.browser.close().catch(() => undefined);
    active.release();
    this.repository.updateAuthCapture({
      id: active.id,
      status: 'runner_error',
      errorMessage: 'Authentication capture ended because the server stopped.',
      completedAt: new Date().toISOString(),
    });
  }
}

function assertSafeId(value: string): void {
  if (!/^[a-zA-Z0-9-]+$/u.test(value)) {
    throw new Error('Project ID is unsafe for authentication storage.');
  }
}
