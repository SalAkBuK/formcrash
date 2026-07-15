interface PublicSchema<T> {
  readonly parse: (value: unknown) => T;
}

export class FormCrashApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = 'FormCrashApiError';
  }
}

export interface HealthResponse {
  readonly service: 'formcrash-server';
  readonly status: 'ok';
  readonly timestamp: string;
}

export function getServerBaseUrl(): string {
  return (
    process.env.NEXT_PUBLIC_FORMCRASH_SERVER_URL ?? 'http://localhost:4100'
  );
}

export function resolveApiUrl(pathname: string): string {
  return new URL(pathname, getServerBaseUrl()).toString();
}

export async function requestJson<T>(
  pathname: string,
  schema: PublicSchema<T>,
  init?: RequestInit,
): Promise<T> {
  let response: Response;
  try {
    response = await fetch(resolveApiUrl(pathname), {
      ...init,
      cache: 'no-store',
    });
  } catch {
    throw new FormCrashApiError(
      0,
      'SERVER_UNAVAILABLE',
      'The FormCrash control server is unavailable.',
    );
  }

  if (!response.ok) {
    const error = await readApiError(response);
    throw new FormCrashApiError(response.status, error.code, error.message);
  }
  try {
    return schema.parse(await response.json());
  } catch {
    throw new FormCrashApiError(
      response.status,
      'INVALID_SERVER_RESPONSE',
      'The FormCrash server returned an invalid response.',
    );
  }
}

export async function getServerHealth(
  signal?: AbortSignal,
): Promise<HealthResponse> {
  const response = await fetch(resolveApiUrl('/health'), {
    cache: 'no-store',
    ...(signal === undefined ? {} : { signal }),
  });
  if (!response.ok) {
    throw new FormCrashApiError(
      response.status,
      'HEALTH_CHECK_FAILED',
      `Control server health check failed with ${response.status}.`,
    );
  }
  return (await response.json()) as HealthResponse;
}

async function readApiError(
  response: Response,
): Promise<{ readonly code: string; readonly message: string }> {
  try {
    const body = (await response.json()) as unknown;
    if (typeof body === 'object' && body !== null && 'error' in body) {
      const value = body.error;
      if (typeof value === 'object' && value !== null) {
        const code = 'code' in value ? value.code : undefined;
        const message = 'message' in value ? value.message : undefined;
        if (typeof code === 'string' && typeof message === 'string') {
          return { code, message };
        }
      }
    }
  } catch {
    // The status still produces a safe public fallback below.
  }
  return {
    code: 'FORMCRASH_API_ERROR',
    message: `The FormCrash server returned HTTP ${response.status}.`,
  };
}
