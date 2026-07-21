import { randomUUID } from 'node:crypto';

import {
  criticalActionSchema,
  outcomeCheckListSchema,
  outcomeCheckSchema,
  type ApproveCriticalActionRequest,
  type CriticalAction,
  type OutcomeCheck,
  type OutcomeCheckRunSnapshot,
  type PersistedJourney,
} from '@formcrash/contracts';
import type Database from 'better-sqlite3';

interface CriticalActionRow {
  readonly id: string;
  readonly journeyId: string;
  readonly stepId: string;
  readonly label: string;
  readonly createdAt: string;
  readonly updatedAt: string;
}

interface OutcomeCheckRow {
  readonly id: string;
  readonly journeyId: string;
  readonly criticalActionId: string;
  readonly outcomeType: string;
  readonly definitionJson: string;
  readonly createdAt: string;
}

type NewOutcomeCheck = OutcomeCheck extends infer Check
  ? Check extends OutcomeCheck
    ? Omit<Check, 'id' | 'createdAt'>
    : never
  : never;

export class CriticalActionLockedError extends Error {
  constructor() {
    super(
      'The Critical Action cannot change after Outcome Checks have been saved.',
    );
    this.name = 'CriticalActionLockedError';
  }
}

export class OutcomeCheckRepository {
  constructor(private readonly database: Database.Database) {}

  getCriticalAction(journeyId: string): CriticalAction | null {
    const row = this.database
      .prepare(
        `SELECT id, journey_id AS journeyId, step_id AS stepId, label,
                created_at AS createdAt, updated_at AS updatedAt
           FROM critical_actions WHERE journey_id = ?`,
      )
      .get(journeyId) as CriticalActionRow | undefined;
    return row === undefined ? null : criticalActionSchema.parse(row);
  }

  approveCriticalAction(
    journey: PersistedJourney,
    input: ApproveCriticalActionRequest,
  ): CriticalAction {
    const step = journey.steps.find((item) => item.id === input.stepId);
    if (step === undefined) {
      throw new Error(
        'The Critical Action must reference a step owned by this journey version.',
      );
    }
    if (step.type !== 'click' && step.type !== 'submit') {
      throw new Error(
        'The Critical Action must reference a recorded click or submit step.',
      );
    }
    if (step.locator === null) {
      throw new Error('The Critical Action must have a replay locator.');
    }

    const existing = this.getCriticalAction(journey.id);
    if (existing !== null && existing.stepId !== input.stepId) {
      const hasChecks =
        (this.database
          .prepare(
            'SELECT 1 FROM outcome_checks WHERE critical_action_id = ? LIMIT 1',
          )
          .get(existing.id) as object | undefined) !== undefined;
      if (hasChecks) throw new CriticalActionLockedError();
    }

    const now = new Date().toISOString();
    if (existing === null) {
      const action = criticalActionSchema.parse({
        id: randomUUID(),
        journeyId: journey.id,
        stepId: input.stepId,
        label: input.label,
        createdAt: now,
        updatedAt: now,
      });
      this.database
        .prepare(
          `INSERT INTO critical_actions
            (id, journey_id, step_id, label, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?)`,
        )
        .run(
          action.id,
          action.journeyId,
          action.stepId,
          action.label,
          action.createdAt,
          action.updatedAt,
        );
      return action;
    }

    this.database
      .prepare(
        `UPDATE critical_actions
            SET step_id = ?, label = ?, updated_at = ?
          WHERE id = ?`,
      )
      .run(input.stepId, input.label, now, existing.id);
    const updated = this.getCriticalAction(journey.id);
    if (updated === null) throw new Error('Critical Action update was lost.');
    return updated;
  }

  saveOutcomeCheck(input: NewOutcomeCheck): OutcomeCheck {
    const action = this.getCriticalAction(input.journeyId);
    if (action === null || action.id !== input.criticalActionId) {
      throw new Error(
        'The Outcome Check must reference this journey version’s approved Critical Action.',
      );
    }
    const check = outcomeCheckSchema.parse({
      ...input,
      id: randomUUID(),
      createdAt: new Date().toISOString(),
    });
    this.database
      .prepare(
        `INSERT INTO outcome_checks
          (id, journey_id, critical_action_id, outcome_type,
           definition_json, created_at)
         VALUES (?, ?, ?, ?, ?, ?)`,
      )
      .run(
        check.id,
        check.journeyId,
        check.criticalActionId,
        check.type,
        JSON.stringify(definitionOf(check)),
        check.createdAt,
      );
    return check;
  }

  listOutcomeChecks(journeyId: string): readonly OutcomeCheck[] {
    const rows = this.database
      .prepare(
        `SELECT id, journey_id AS journeyId,
                critical_action_id AS criticalActionId,
                outcome_type AS outcomeType,
                definition_json AS definitionJson,
                created_at AS createdAt
           FROM outcome_checks
          WHERE journey_id = ?
          ORDER BY created_at, id`,
      )
      .all(journeyId) as OutcomeCheckRow[];
    return outcomeCheckListSchema.parse({
      items: rows.map((row) =>
        outcomeCheckSchema.parse({
          id: row.id,
          journeyId: row.journeyId,
          criticalActionId: row.criticalActionId,
          type: row.outcomeType,
          ...(JSON.parse(row.definitionJson) as object),
          createdAt: row.createdAt,
        }),
      ),
    }).items;
  }

  snapshot(journeyId: string): OutcomeCheckRunSnapshot {
    return {
      criticalAction: this.getCriticalAction(journeyId),
      checks: [...this.listOutcomeChecks(journeyId)],
    };
  }

  deleteOutcomeCheck(
    journeyId: string,
    outcomeCheckId: string,
  ): 'deleted' | 'not_found' {
    const result = this.database
      .prepare('DELETE FROM outcome_checks WHERE id = ? AND journey_id = ?')
      .run(outcomeCheckId, journeyId);
    return result.changes === 0 ? 'not_found' : 'deleted';
  }
}

function definitionOf(check: OutcomeCheck): object {
  switch (check.type) {
    case 'visible_element_exists':
      return { description: check.description, target: check.target };
    case 'matching_item_appears_exactly_once':
      return {
        description: check.description,
        target: check.target,
        binding: check.binding,
      };
    case 'final_pathname_matches':
      return {
        description: check.description,
        expectedPathname: check.expectedPathname,
      };
  }
}
