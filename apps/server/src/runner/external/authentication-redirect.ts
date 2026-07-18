export class SavedAuthenticationExpiredError extends Error {
  constructor(
    message = 'The saved authentication session appears to have expired. Sign in again and recapture authentication before retrying.',
  ) {
    super(message);
    this.name = 'SavedAuthenticationExpiredError';
  }
}

export function authenticationInterruptedBeforeStep(
  stepNumber: number,
  stepName: string,
): SavedAuthenticationExpiredError {
  const previousStep = Math.max(stepNumber - 1, 1);
  return new SavedAuthenticationExpiredError(
    `The application required sign-in before step ${stepNumber}, “${stepName}”. The saved session loaded successfully at replay start, so it either expired during the run or step ${previousStep} redirected or signed out. Review the preceding action before recapturing authentication.`,
  );
}

export function assertSavedAuthenticationActive(
  targetUrl: string,
  currentUrl: string,
): void {
  if (isAuthenticationRedirect(targetUrl, currentUrl)) {
    throw new SavedAuthenticationExpiredError();
  }
}

export async function assertSavedAuthenticationSessionActive(
  targetUrl: string,
  session: ReplayBrowserSession,
): Promise<void> {
  assertSavedAuthenticationActive(targetUrl, session.currentUrl());
  await assertNoVisibleAuthenticationRequirement(session);
}

export async function assertNoVisibleAuthenticationRequirement(
  session: ReplayBrowserSession,
): Promise<void> {
  const detection = await session.detectAuthenticationRequired?.();
  if (detection !== undefined && detection !== null) {
    throw new SavedAuthenticationExpiredError();
  }
}

export function isAuthenticationRedirect(
  targetUrl: string,
  currentUrl: string,
): boolean {
  const target = new URL(targetUrl);
  const current = new URL(currentUrl);
  return (
    current.origin !== target.origin ||
    (!looksLikeAuthenticationPath(target.pathname) &&
      looksLikeAuthenticationPath(current.pathname))
  );
}

function looksLikeAuthenticationPath(pathname: string): boolean {
  return /(?:^|\/)(?:login|log-in|signin|sign-in|auth|authenticate)(?:\/|$)/iu.test(
    pathname,
  );
}
import type { ReplayBrowserSession } from '../recording/external-browser.js';
