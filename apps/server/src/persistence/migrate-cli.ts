import { loadConfig } from '../app/config.js';
import { initializePersistence } from './initialize.js';

const database = initializePersistence(loadConfig());
try {
  const migrations = database.migrate();
  process.stdout.write(
    `SQLite is ready at ${database.databasePath}. Applied migrations: ${migrations.map((migration) => migration.version).join(', ')}\n`,
  );
} finally {
  database.close();
}
