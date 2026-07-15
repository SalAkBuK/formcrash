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

export async function getServerHealth(
  signal?: AbortSignal,
): Promise<HealthResponse> {
  const response = await fetch(
    new URL('/health', getServerBaseUrl()),
    signal === undefined ? undefined : { signal },
  );

  if (!response.ok) {
    throw new Error(
      `Control server health check failed with ${response.status}.`,
    );
  }

  return (await response.json()) as HealthResponse;
}
