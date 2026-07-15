import process from 'node:process';

import { loadConfig } from './app/config.js';
import { createApp } from './app/create-app.js';

const config = loadConfig();
const app = createApp({ config });
let shuttingDown = false;

async function shutdown(signal: NodeJS.Signals): Promise<void> {
  if (shuttingDown) return;
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
  await app.listen({ host: config.host, port: config.port });
} catch (error: unknown) {
  app.log.fatal({ error }, 'Control server failed to start');
  process.exitCode = 1;
}
