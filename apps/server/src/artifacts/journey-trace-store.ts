import { createHash, randomUUID } from 'node:crypto';
import { gunzipSync, gzipSync } from 'node:zlib';
import {
  mkdirSync,
  readFileSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import path from 'node:path';

import {
  hybridTraceManifestSchema,
  type HybridTraceManifest,
  type RecordedVideoArtifact,
} from '@formcrash/contracts';

import type {
  ProjectJourneyRepository,
  RecordingTraceRecord,
} from '../persistence/project-journey-repository.js';

const MAX_TRACE_BYTES = 512 * 1024 * 1024;

export class JourneyTraceStore {
  private readonly root: string;

  constructor(
    artifactRoot: string,
    private readonly repository: ProjectJourneyRepository,
  ) {
    this.root = path.resolve(artifactRoot);
    mkdirSync(path.join(this.root, 'journey-traces'), { recursive: true });
  }

  persist(
    recordingSessionId: string,
    manifest: HybridTraceManifest,
    events: readonly unknown[],
  ): RecordingTraceRecord {
    assertSafeId(recordingSessionId);
    const relativePath = path.posix.join(
      'journey-traces',
      recordingSessionId,
      'trace-v2.json.gz',
    );
    const finalPath = this.resolve(relativePath);
    const temporaryPath = `${finalPath}.${randomUUID()}.tmp`;
    const encoded = gzipSync(JSON.stringify({ manifest, events }), {
      level: 9,
    });
    if (encoded.byteLength > MAX_TRACE_BYTES) {
      throw new Error('The compressed journey trace exceeded 512 MiB.');
    }
    mkdirSync(path.dirname(finalPath), { recursive: true });
    try {
      writeFileSync(temporaryPath, encoded, { flag: 'wx' });
      renameSync(temporaryPath, finalPath);
      const sizeBytes = statSync(finalPath).size;
      const checksumSha256 = createHash('sha256')
        .update(readFileSync(finalPath))
        .digest('hex');
      try {
        return this.repository.createRecordingTrace({
          recordingSessionId,
          manifest,
          relativePath,
          sizeBytes,
          checksumSha256,
        });
      } catch (error: unknown) {
        rmSync(finalPath, { force: true });
        throw error;
      }
    } finally {
      rmSync(temporaryPath, { force: true });
    }
  }

  resolve(relativePath: string): string {
    if (path.isAbsolute(relativePath)) {
      throw new Error('Trace artifact paths must be relative.');
    }
    const resolved = path.resolve(this.root, relativePath);
    const relation = path.relative(this.root, resolved);
    if (relation.startsWith('..') || path.isAbsolute(relation)) {
      throw new Error('Trace artifact path escapes the configured root.');
    }
    return resolved;
  }

  remove(relativePaths: readonly string[]): void {
    for (const relativePath of relativePaths) {
      const resolved = this.resolve(relativePath);
      rmSync(resolved, { force: true });
      const directory = path.dirname(resolved);
      const relation = path.relative(this.root, directory);
      if (relation !== '' && !relation.startsWith('..')) {
        rmSync(directory, { recursive: true, force: true });
      }
    }
  }

  removeRecording(recordingSessionId: string): void {
    assertSafeId(recordingSessionId);
    const directory = this.resolve(
      path.posix.join('journey-traces', recordingSessionId),
    );
    rmSync(directory, { recursive: true, force: true });
  }

  assertIntegrity(record: RecordingTraceRecord): HybridTraceManifest {
    const encoded = readFileSync(this.resolve(record.relativePath));
    const checksumSha256 = createHash('sha256').update(encoded).digest('hex');
    if (checksumSha256 !== record.checksumSha256) {
      throw new Error('Journey trace checksum verification failed.');
    }
    const decoded = JSON.parse(gunzipSync(encoded).toString('utf8')) as {
      readonly manifest?: unknown;
    };
    return hybridTraceManifestSchema.parse(decoded.manifest);
  }

  describeVideos(paths: readonly string[]): readonly RecordedVideoArtifact[] {
    return paths.slice(0, 20).map((videoPath, index) => {
      const absolute = path.resolve(videoPath);
      const relation = path.relative(this.root, absolute);
      if (relation.startsWith('..') || path.isAbsolute(relation)) {
        throw new Error('Recorded video escaped the trace artifact root.');
      }
      const bytes = readFileSync(absolute);
      return {
        pageId: `page-${index + 1}`,
        relativePath: relation.split(path.sep).join(path.posix.sep),
        sizeBytes: statSync(absolute).size,
        checksumSha256: createHash('sha256').update(bytes).digest('hex'),
      };
    });
  }

  videoPath(manifest: HybridTraceManifest, index: number): string | null {
    const video = manifest.videos?.[index];
    return video === undefined ? null : this.resolve(video.relativePath);
  }
}

function assertSafeId(value: string): void {
  if (!/^[a-zA-Z0-9-]+$/u.test(value)) {
    throw new Error('Recording session ID is unsafe for artifact storage.');
  }
}
