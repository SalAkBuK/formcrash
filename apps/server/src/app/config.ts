import { z } from 'zod';

const serverConfigSchema = z.object({
  FORMCRASH_LOG_LEVEL: z
    .enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent'])
    .default('info'),
  FORMCRASH_VAR_DIR: z.string().min(1).default('./var'),
  SERVER_HOST: z.string().min(1).default('127.0.0.1'),
  SERVER_PORT: z.coerce.number().int().min(1).max(65_535).default(4100),
});

export interface ServerConfig {
  readonly host: string;
  readonly logLevel:
    'fatal' | 'error' | 'warn' | 'info' | 'debug' | 'trace' | 'silent';
  readonly port: number;
  readonly varDirectory: string;
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
    host: parsed.data.SERVER_HOST,
    logLevel: parsed.data.FORMCRASH_LOG_LEVEL,
    port: parsed.data.SERVER_PORT,
    varDirectory: parsed.data.FORMCRASH_VAR_DIR,
  };
}
