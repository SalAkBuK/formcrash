import { spawn } from 'node:child_process';
import process from 'node:process';

const pnpmCli = process.env.npm_execpath;

if (pnpmCli === undefined || !pnpmCli.includes('pnpm')) {
  throw new Error('Run the development launcher through pnpm: pnpm dev');
}
const applications = [
  {
    name: 'dashboard',
    packageName: '@formcrash/dashboard',
    port: process.env.DASHBOARD_PORT ?? '3000',
  },
  {
    name: 'server',
    packageName: '@formcrash/server',
    port: process.env.SERVER_PORT ?? '4100',
  },
  {
    name: 'sample-checkout',
    packageName: '@formcrash/sample-checkout',
    port: process.env.SAMPLE_CHECKOUT_PORT ?? '4200',
  },
];

const children = applications.map((application) => {
  const child = spawn(
    process.execPath,
    [
      pnpmCli,
      '--filter',
      application.packageName,
      'dev',
      '--port',
      application.port,
    ],
    {
      env: { ...process.env, PORT: application.port },
      shell: false,
      stdio: ['inherit', 'pipe', 'pipe'],
    },
  );

  child.stdout.on('data', (chunk) => {
    process.stdout.write(`[${application.name}] ${chunk}`);
  });
  child.stderr.on('data', (chunk) => {
    process.stderr.write(`[${application.name}] ${chunk}`);
  });
  return child;
});

let shuttingDown = false;
function shutdown(signal) {
  if (shuttingDown) return;
  shuttingDown = true;
  for (const child of children) child.kill(signal);
}

process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));

const exitCodes = await Promise.all(
  children.map(
    (child) =>
      new Promise((resolve) => {
        child.on('exit', (code) => resolve(code ?? 1));
      }),
  ),
);

process.exitCode = exitCodes.every((code) => code === 0) ? 0 : 1;
