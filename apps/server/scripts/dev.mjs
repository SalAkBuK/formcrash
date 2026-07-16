import { spawn } from 'node:child_process';
import process from 'node:process';

const pnpmCli = process.env.npm_execpath;

if (pnpmCli === undefined || !pnpmCli.includes('pnpm')) {
  throw new Error('Run the server development process through pnpm.');
}

const forwardedArguments = process.argv.slice(2);
const children = [
  spawn(
    process.execPath,
    [
      pnpmCli,
      '--filter',
      '@formcrash/contracts',
      'exec',
      'tsc',
      '-p',
      'tsconfig.build.json',
      '--watch',
      '--preserveWatchOutput',
    ],
    {
      env: process.env,
      shell: false,
      stdio: 'inherit',
    },
  ),
  spawn(
    process.execPath,
    [
      pnpmCli,
      'exec',
      'tsx',
      'watch',
      '--include',
      '../../packages/contracts/dist/**/*.js',
      'src/main.ts',
      ...forwardedArguments,
    ],
    {
      env: process.env,
      shell: false,
      stdio: 'inherit',
    },
  ),
];

let shuttingDown = false;

function shutdown(signal) {
  if (shuttingDown) return;
  shuttingDown = true;

  for (const child of children) {
    if (child.exitCode === null) child.kill(signal);
  }
}

process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));

const exitCode = await Promise.race(
  children.map(
    (child) =>
      new Promise((resolve) => {
        child.on('exit', (code) => resolve(code ?? 1));
        child.on('error', () => resolve(1));
      }),
  ),
);

shutdown('SIGTERM');
process.exitCode = exitCode;
