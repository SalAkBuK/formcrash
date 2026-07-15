import type { ServerConfig } from '../app/config.js';
import { FormCrashDatabase } from './database.js';
import { seedSampleDefinitions } from './sample-seed.js';

export function initializePersistence(config: ServerConfig): FormCrashDatabase {
  const database = new FormCrashDatabase(config.databasePath);
  try {
    database.migrate();
    seedSampleDefinitions(database.connection, config.sampleCheckoutBaseUrl);
    return database;
  } catch (error: unknown) {
    database.close();
    throw error;
  }
}
