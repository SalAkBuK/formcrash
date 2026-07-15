import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { z } from 'zod';

const repositoryRoot = fileURLToPath(new URL('../../../../', import.meta.url));

const serverConfigSchema = z.object({
  FORMCRASH_BROWSER_HEADLESS: z
    .enum(['true', 'false'])
    .default('false')
    .transform((value) => value === 'true'),
  FORMCRASH_BROWSER_TIMEOUT_MS: z.coerce
    .number()
    .int()
    .min(1_000)
    .max(60_000)
    .default(10_000),
  FORMCRASH_LOG_LEVEL: z
    .enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent'])
    .default('info'),
  FORMCRASH_DATABASE_PATH: z
    .string()
    .min(1)
    .default('./var/database/formcrash.db'),
  FORMCRASH_ARTIFACT_ROOT: z.string().min(1).default('./var'),
  FORMCRASH_DASHBOARD_ORIGINS: z
    .string()
    .default('http://localhost:3000')
    .transform((value, context) => {
      const origins = value
        .split(',')
        .map((origin) => origin.trim())
        .filter((origin) => origin.length > 0);
      if (
        origins.length === 0 ||
        origins.some((origin) => {
          if (!z.url().safeParse(origin).success) return true;
          const parsed = new URL(origin);
          return (
            !['http:', 'https:'].includes(parsed.protocol) ||
            parsed.origin !== origin
          );
        })
      ) {
        context.addIssue({
          code: 'custom',
          message:
            'Dashboard origins must be comma-separated HTTP(S) origins without paths.',
        });
        return z.NEVER;
      }
      return [...new Set(origins)];
    }),
  SERVER_HOST: z.string().min(1).default('127.0.0.1'),
  SERVER_PORT: z.coerce.number().int().min(1).max(65_535).default(4100),
  SAMPLE_CHECKOUT_BASE_URL: z.url().default('http://localhost:4200'),
});

export interface ServerConfig {
  readonly artifactRoot: string;
  readonly browserHeadless: boolean;
  readonly browserTimeoutMs: number;
  readonly databasePath: string;
  readonly dashboardOrigins: readonly string[];
  readonly host: string;
  readonly logLevel:
    'fatal' | 'error' | 'warn' | 'info' | 'debug' | 'trace' | 'silent';
  readonly port: number;
  readonly sampleCheckoutBaseUrl: string;
}

export function loadConfig(
  environment: NodeJS.ProcessEnv = process.env,
): ServerConfig {
  const parsed = serverConfigSchema.safeParse(environment);

  if (!parsed.success) {
    throw new Error(
      `Invalid server configuration: ${z.prettifyError(parsed.error)}`,
    );
  }

  return {
    artifactRoot: resolveRepositoryPath(parsed.data.FORMCRASH_ARTIFACT_ROOT),
    browserHeadless: parsed.data.FORMCRASH_BROWSER_HEADLESS,
    browserTimeoutMs: parsed.data.FORMCRASH_BROWSER_TIMEOUT_MS,
    databasePath: resolveRepositoryPath(parsed.data.FORMCRASH_DATABASE_PATH),
    dashboardOrigins: parsed.data.FORMCRASH_DASHBOARD_ORIGINS,
    host: parsed.data.SERVER_HOST,
    logLevel: parsed.data.FORMCRASH_LOG_LEVEL,
    port: parsed.data.SERVER_PORT,
    sampleCheckoutBaseUrl: parsed.data.SAMPLE_CHECKOUT_BASE_URL,
  };
}

function resolveRepositoryPath(value: string): string {
  return path.isAbsolute(value) ? value : path.resolve(repositoryRoot, value);
}
