import { mkdirSync, readFileSync, readdirSync } from 'node:fs';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import Database from 'better-sqlite3';

const migrationDirectory = fileURLToPath(
  new URL('../../migrations/', import.meta.url),
);

export interface AppliedMigration {
  readonly version: string;
  readonly checksumSha256: string;
  readonly appliedAt: string;
}

export class FormCrashDatabase {
  readonly connection: Database.Database;
  private closed = false;

  constructor(readonly databasePath: string) {
    mkdirSync(path.dirname(databasePath), { recursive: true });
    this.connection = new Database(databasePath);
    this.connection.pragma('foreign_keys = ON');
    this.connection.pragma('journal_mode = WAL');
    this.connection.pragma('busy_timeout = 5000');
  }

  migrate(directory: string = migrationDirectory): readonly AppliedMigration[] {
    this.connection.exec(`
      CREATE TABLE IF NOT EXISTS schema_migrations (
        version TEXT PRIMARY KEY,
        checksum_sha256 TEXT NOT NULL,
        applied_at TEXT NOT NULL
      ) STRICT
    `);

    const files = readdirSync(directory)
      .filter((file) => /^\d+_[a-z0-9_-]+\.sql$/u.test(file))
      .sort((left, right) => left.localeCompare(right));
    const findMigration = this.connection.prepare(
      `SELECT checksum_sha256 AS checksumSha256
         FROM schema_migrations WHERE version = ?`,
    );
    const recordMigration = this.connection.prepare(
      `INSERT INTO schema_migrations (version, checksum_sha256, applied_at)
       VALUES (?, ?, ?)`,
    );

    for (const file of files) {
      const sql = readFileSync(path.join(directory, file), 'utf8');
      const compatibleChecksums = migrationChecksums(sql);
      const checksumSha256 = compatibleChecksums[0];
      const applied = findMigration.get(file) as
        { readonly checksumSha256: string } | undefined;
      if (applied !== undefined) {
        if (!compatibleChecksums.includes(applied.checksumSha256)) {
          throw new Error(
            `Migration ${file} changed after it was applied. Create a new migration instead.`,
          );
        }
        continue;
      }
      this.connection.transaction(() => {
        this.connection.exec(sql);
        recordMigration.run(file, checksumSha256, new Date().toISOString());
      })();
    }

    return this.connection
      .prepare(
        `SELECT version, checksum_sha256 AS checksumSha256,
                applied_at AS appliedAt
           FROM schema_migrations ORDER BY version`,
      )
      .all() as AppliedMigration[];
  }

  close(): void {
    if (this.closed) return;
    this.closed = true;
    this.connection.close();
  }
}

function migrationChecksums(sql: string): readonly string[] {
  const lineFeedSql = sql.replace(/\r\n/gu, '\n').replace(/\r/gu, '\n');
  const carriageReturnLineFeedSql = lineFeedSql.replace(/\n/gu, '\r\n');

  return [checksum(lineFeedSql), checksum(carriageReturnLineFeedSql)] as const;
}

function checksum(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}
