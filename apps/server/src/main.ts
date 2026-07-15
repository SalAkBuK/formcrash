import process from 'node:process';

import type { FastifyInstance } from 'fastify';

import { loadConfig } from './app/config.js';
import { createApp } from './app/create-app.js';

let app: FastifyInstance | null = null;
let shuttingDown = false;

async function shutdown(signal: NodeJS.Signals): Promise<void> {
  if (shuttingDown || app === null) return;
  shuttingDown = true;

  app.log.info({ signal }, 'Shutting down control server');
  await app.close();
}

process.once('SIGINT', () => {
  void shutdown('SIGINT');
});
process.once('SIGTERM', () => {
  void shutdown('SIGTERM');
});

try {
  const config = loadConfig();
  app = createApp({ config });
  await app.listen({ host: config.host, port: config.port });
} catch (error: unknown) {
  if (app === null) {
    process.stderr.write(
      `Control server failed before startup: ${error instanceof Error ? error.message : 'unknown error'}\n`,
    );
  } else {
    app.log.fatal({ error }, 'Control server failed to start');
    await app.close();
  }
  process.exitCode = 1;
}
