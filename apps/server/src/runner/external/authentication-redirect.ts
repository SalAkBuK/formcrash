export class SavedAuthenticationExpiredError extends Error {
  constructor() {
    super(
      'The saved authentication session appears to have expired. Sign in again and recapture authentication before retrying.',
    );
    this.name = 'SavedAuthenticationExpiredError';
  }
}

export function assertSavedAuthenticationActive(
  targetUrl: string,
  currentUrl: string,
): void {
  if (isAuthenticationRedirect(targetUrl, currentUrl)) {
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
