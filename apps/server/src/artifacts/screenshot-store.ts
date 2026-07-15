import { createHash, randomUUID } from 'node:crypto';
import { mkdirSync, readFileSync, renameSync, rmSync, statSync } from 'node:fs';
import path from 'node:path';

import type { RunArtifact } from '@formcrash/contracts';

import { RunPersistenceError } from '../persistence/run-repository.js';
import type { CreateArtifactInput } from '../persistence/run-repository.js';

export interface ScreenshotTarget {
  captureScreenshot(destination: string): Promise<void>;
}

export interface ScreenshotArtifactRepository {
  createArtifact(input: CreateArtifactInput): RunArtifact;
}

export type ScreenshotLabel = RunArtifact['label'];

const fileNames: Record<ScreenshotLabel, string> = {
  'before-disruption': '001-before-disruption.png',
  'after-disruption': '002-after-disruption.png',
  'final-result': '003-final-result.png',
};

const captureSequences: Record<ScreenshotLabel, number> = {
  'before-disruption': 1,
  'after-disruption': 2,
  'final-result': 3,
};

export class ScreenshotCaptureError extends Error {
  constructor(
    readonly label: ScreenshotLabel,
    cause: unknown,
  ) {
    super(`Screenshot ${label} could not be captured.`, { cause });
    this.name = 'ScreenshotCaptureError';
  }
}

export class ScreenshotStore {
  readonly root: string;

  constructor(
    artifactRoot: string,
    private readonly repository: ScreenshotArtifactRepository,
  ) {
    this.root = path.resolve(artifactRoot);
    mkdirSync(this.root, { recursive: true });
  }

  async capture(
    session: ScreenshotTarget,
    runId: string,
    label: ScreenshotLabel,
  ): Promise<RunArtifact> {
    assertSafeRunId(runId);
    const relativePath = path.posix.join(
      'screenshots',
      runId,
      fileNames[label],
    );
    const finalPath = this.resolve(relativePath);
    const temporaryPath = `${finalPath}.${randomUUID()}.tmp`;

    try {
      mkdirSync(path.dirname(finalPath), { recursive: true });
      await session.captureScreenshot(temporaryPath);
      renameSync(temporaryPath, finalPath);
      const sizeBytes = statSync(finalPath).size;
      if (sizeBytes <= 0) throw new Error('Screenshot file is empty.');
      const checksumSha256 = createHash('sha256')
        .update(readFileSync(finalPath))
        .digest('hex');

      try {
        return this.repository.createArtifact({
          runId,
          label,
          relativePath,
          sizeBytes,
          checksumSha256,
          captureSequence: captureSequences[label],
          createdAt: new Date().toISOString(),
          metadata: { fullPage: true },
        });
      } catch (error: unknown) {
        const cleanupError = removeIfPresent(finalPath);
        if (error instanceof RunPersistenceError) {
          if (cleanupError !== null) {
            throw new RunPersistenceError(
              'persist artifact metadata and remove the orphaned file',
              new AggregateError([error, cleanupError]),
            );
          }
          throw error;
        }
        throw error;
      }
    } catch (error: unknown) {
      if (error instanceof RunPersistenceError) throw error;
      const cleanupErrors = [
        removeIfPresent(temporaryPath),
        removeIfPresent(finalPath),
      ].filter((item): item is Error => item !== null);
      const cause =
        cleanupErrors.length === 0
          ? error
          : new AggregateError([normalizeError(error), ...cleanupErrors]);
      throw new ScreenshotCaptureError(label, cause);
    }
  }

  read(artifact: RunArtifact): Buffer {
    return readFileSync(this.resolve(artifact.relativePath));
  }

  resolve(relativePath: string): string {
    if (path.isAbsolute(relativePath)) {
      throw new Error('Artifact paths must be relative.');
    }
    const resolved = path.resolve(this.root, relativePath);
    const relation = path.relative(this.root, resolved);
    if (relation.startsWith('..') || path.isAbsolute(relation)) {
      throw new Error('Artifact path escapes the configured root.');
    }
    return resolved;
  }
}

function assertSafeRunId(runId: string): void {
  if (!/^[a-zA-Z0-9-]+$/u.test(runId)) {
    throw new Error('Run ID is unsafe for artifact storage.');
  }
}

function removeIfPresent(filePath: string): Error | null {
  try {
    rmSync(filePath, { force: true });
    return null;
  } catch (error: unknown) {
    return normalizeError(error);
  }
}

function normalizeError(error: unknown): Error {
  return error instanceof Error ? error : new Error('Unknown artifact error.');
}
