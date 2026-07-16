import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
  closeSync,
  openSync,
  readFileSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath, URL } from 'node:url';

const scriptDirectory = fileURLToPath(new URL('.', import.meta.url));
const serverDirectory = path.resolve(scriptDirectory, '..');
const repositoryRoot = path.resolve(serverDirectory, '../..');
const contractsTsconfig = path.join(
  repositoryRoot,
  'packages',
  'contracts',
  'tsconfig.build.json',
);
const contractsOutputGlob = '../../packages/contracts/dist/**/*.js';
const tscCli = fileURLToPath(import.meta.resolve('typescript/bin/tsc'));
const tsxCli = fileURLToPath(import.meta.resolve('tsx/cli'));
const forwardedArguments = process.argv.slice(2);
const releaseLock = acquireDevelopmentLock();
let children = [];
let shuttingDown = false;

process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));

try {
  await runInitialContractsBuild();
  children = [
    spawn(
      process.execPath,
      [tscCli, '-p', contractsTsconfig, '--watch', '--preserveWatchOutput'],
      {
        cwd: repositoryRoot,
        env: process.env,
        shell: false,
        stdio: 'inherit',
      },
    ),
    spawn(
      process.execPath,
      [
        tsxCli,
        'watch',
        '--include',
        contractsOutputGlob,
        'src/main.ts',
        ...forwardedArguments,
      ],
      {
        cwd: serverDirectory,
        env: process.env,
        shell: false,
        stdio: 'inherit',
      },
    ),
  ];

  const exits = children.map(waitForExit);
  const firstExitCode = await Promise.race(exits);
  shutdown('SIGTERM');
  await Promise.all(exits);
  process.exitCode = firstExitCode;
} finally {
  shutdown('SIGTERM');
  releaseLock();
}

async function runInitialContractsBuild() {
  const child = spawn(process.execPath, [tscCli, '-p', contractsTsconfig], {
    cwd: repositoryRoot,
    env: process.env,
    shell: false,
    stdio: 'inherit',
  });
  children = [child];
  const exitCode = await waitForExit(child);
  children = [];
  if (shuttingDown) {
    throw new Error('Server development startup was interrupted.');
  }
  if (exitCode !== 0) {
    throw new Error(
      `Shared contracts failed to build before server startup (exit ${exitCode}).`,
    );
  }
}

function waitForExit(child) {
  return new Promise((resolve) => {
    child.on('exit', (code) => resolve(code ?? 1));
    child.on('error', () => resolve(1));
  });
}

function shutdown(signal) {
  if (shuttingDown) return;
  shuttingDown = true;

  for (const child of children) {
    if (child.exitCode === null) child.kill(signal);
  }
}

function acquireDevelopmentLock() {
  const identity = [
    repositoryRoot.toLowerCase(),
    process.env.SERVER_HOST ?? '127.0.0.1',
    process.env.SERVER_PORT ?? '4100',
  ].join('\u0000');
  const lockPath = path.join(
    tmpdir(),
    `formcrash-server-dev-${createHash('sha256')
      .update(identity)
      .digest('hex')
      .slice(0, 24)}.lock`,
  );

  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      const descriptor = openSync(lockPath, 'wx');
      try {
        writeFileSync(descriptor, String(process.pid), 'utf8');
      } finally {
        closeSync(descriptor);
      }
      let released = false;
      return () => {
        if (released) return;
        released = true;
        try {
          unlinkSync(lockPath);
        } catch (error) {
          if (
            !(error instanceof Error) ||
            !('code' in error) ||
            error.code !== 'ENOENT'
          ) {
            throw error;
          }
        }
      };
    } catch (error) {
      if (
        !(error instanceof Error) ||
        !('code' in error) ||
        error.code !== 'EEXIST'
      ) {
        throw error;
      }
      const existingProcessId = Number.parseInt(
        readFileSync(lockPath, 'utf8'),
        10,
      );
      if (processIsAlive(existingProcessId)) {
        throw new Error(
          `A FormCrash server development watcher is already running for ${process.env.SERVER_HOST ?? '127.0.0.1'}:${process.env.SERVER_PORT ?? '4100'} (PID ${existingProcessId}).`,
          { cause: error },
        );
      }
      unlinkSync(lockPath);
    }
  }

  throw new Error('Could not acquire the FormCrash server development lock.');
}

function processIsAlive(processId) {
  if (!Number.isInteger(processId) || processId <= 0) return false;
  try {
    process.kill(processId, 0);
    return true;
  } catch (error) {
    return error instanceof Error && 'code' in error && error.code === 'EPERM';
  }
}
