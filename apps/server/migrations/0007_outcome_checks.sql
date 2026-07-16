CREATE TABLE critical_actions (
  id TEXT PRIMARY KEY,
  journey_id TEXT NOT NULL UNIQUE REFERENCES journeys(id),
  step_id TEXT NOT NULL,
  label TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
) STRICT;

CREATE TABLE outcome_checks (
  id TEXT PRIMARY KEY,
  journey_id TEXT NOT NULL REFERENCES journeys(id),
  critical_action_id TEXT NOT NULL REFERENCES critical_actions(id),
  outcome_type TEXT NOT NULL CHECK (outcome_type IN (
    'visible_element_exists',
    'matching_item_appears_exactly_once',
    'final_pathname_matches'
  )),
  definition_json TEXT NOT NULL,
  created_at TEXT NOT NULL
) STRICT;

CREATE INDEX outcome_checks_journey_index
  ON outcome_checks(journey_id, created_at, id);

CREATE TRIGGER outcome_checks_prevent_update
BEFORE UPDATE ON outcome_checks
BEGIN
  SELECT RAISE(ABORT, 'outcome checks are immutable');
END;
