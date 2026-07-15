import type Database from 'better-sqlite3';

import {
  IMPATIENT_USER_EXPERIMENT,
  SAMPLE_CHECKOUT_JOURNEY,
} from '../runner/journeys/sample-checkout.js';

export const SAMPLE_DEFINITION_IDS = {
  projectId: 'project-sample-checkout',
  journeyId: 'journey-sample-checkout-priority-0',
  experimentId: 'experiment-impatient-user-submit-order',
  experimentVersionId: 'experiment-version-impatient-user-v1',
  assertionId: 'assertion-max-created-orders-v1',
} as const;

const SEED_CREATED_AT = '2026-07-15T00:00:00.000Z';

export function seedSampleDefinitions(
  database: Database.Database,
  targetUrl: string,
): void {
  const assertionSnapshot = [
    {
      id: SAMPLE_DEFINITION_IDS.assertionId,
      assertionType: 'max_created_orders',
      configuration: { expectedMaximum: 1 },
      description: 'No more than one order should be created.',
    },
  ];

  database.transaction(() => {
    database
      .prepare(
        `INSERT OR IGNORE INTO projects
          (id, name, target_url, description, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?)`,
      )
      .run(
        SAMPLE_DEFINITION_IDS.projectId,
        'Sample Checkout',
        targetUrl,
        'Bundled fake checkout for the Priority 0 duplicate-submission experiment.',
        SEED_CREATED_AT,
        SEED_CREATED_AT,
      );
    database
      .prepare(
        `INSERT OR IGNORE INTO journeys
          (id, project_id, name, version, definition_json, created_at)
         VALUES (?, ?, ?, ?, ?, ?)`,
      )
      .run(
        SAMPLE_DEFINITION_IDS.journeyId,
        SAMPLE_DEFINITION_IDS.projectId,
        'Sample checkout order submission',
        1,
        JSON.stringify(SAMPLE_CHECKOUT_JOURNEY),
        SEED_CREATED_AT,
      );
    database
      .prepare(
        `INSERT OR IGNORE INTO experiments
          (id, project_id, journey_id, name, experiment_type, created_at)
         VALUES (?, ?, ?, ?, ?, ?)`,
      )
      .run(
        SAMPLE_DEFINITION_IDS.experimentId,
        SAMPLE_DEFINITION_IDS.projectId,
        SAMPLE_DEFINITION_IDS.journeyId,
        'Impatient User on Submit Order',
        'impatient_user',
        SEED_CREATED_AT,
      );
    database
      .prepare(
        `INSERT OR IGNORE INTO experiment_versions
          (id, experiment_id, version, configuration_json,
           journey_snapshot_json, assertions_snapshot_json, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        SAMPLE_DEFINITION_IDS.experimentVersionId,
        SAMPLE_DEFINITION_IDS.experimentId,
        1,
        JSON.stringify(IMPATIENT_USER_EXPERIMENT),
        JSON.stringify(SAMPLE_CHECKOUT_JOURNEY),
        JSON.stringify(assertionSnapshot),
        SEED_CREATED_AT,
      );
    database
      .prepare(
        `INSERT OR IGNORE INTO recovery_assertions
          (id, experiment_version_id, assertion_type, configuration_json, created_at)
         VALUES (?, ?, ?, ?, ?)`,
      )
      .run(
        SAMPLE_DEFINITION_IDS.assertionId,
        SAMPLE_DEFINITION_IDS.experimentVersionId,
        'max_created_orders',
        JSON.stringify({ expectedMaximum: 1 }),
        SEED_CREATED_AT,
      );
  })();
}
