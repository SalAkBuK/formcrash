ALTER TABLE external_runs ADD COLUMN lifecycle_status TEXT NOT NULL DEFAULT 'created'
  CHECK (lifecycle_status IN (
    'created', 'starting', 'running', 'evaluating', 'completed', 'runner_error'
  ));

ALTER TABLE external_runs ADD COLUMN outcome_checks_snapshot_json TEXT NOT NULL
  DEFAULT '{"criticalAction":null,"checks":[]}';

ALTER TABLE external_runs ADD COLUMN outcome_aggregate TEXT NOT NULL
  DEFAULT 'not_configured'
  CHECK (outcome_aggregate IN (
    'passed', 'failed', 'could_not_verify', 'not_configured'
  ));

ALTER TABLE external_runs ADD COLUMN assertion_aggregate TEXT NOT NULL
  DEFAULT 'not_configured'
  CHECK (assertion_aggregate IN (
    'passed', 'failed', 'could_not_verify', 'not_configured'
  ));

UPDATE external_runs
   SET lifecycle_status = CASE
     WHEN status = 'runner_error' THEN 'runner_error'
     WHEN status IN ('passed', 'failed') THEN 'completed'
     ELSE status
   END,
       assertion_aggregate = CASE
         WHEN status = 'passed' THEN 'passed'
         WHEN status = 'failed' THEN 'failed'
         ELSE 'could_not_verify'
       END;

CREATE TABLE external_outcome_check_results (
  id TEXT PRIMARY KEY,
  run_id TEXT NOT NULL REFERENCES external_runs(id),
  outcome_check_id TEXT NOT NULL,
  journey_id TEXT NOT NULL,
  critical_action_id TEXT NOT NULL,
  outcome_type TEXT NOT NULL CHECK (outcome_type IN (
    'visible_element_exists',
    'matching_item_appears_exactly_once',
    'final_pathname_matches'
  )),
  expected_json TEXT NOT NULL,
  observed_json TEXT NOT NULL,
  expected_count INTEGER CHECK (expected_count IS NULL OR expected_count >= 0),
  observed_count INTEGER CHECK (observed_count IS NULL OR observed_count >= 0),
  status TEXT NOT NULL CHECK (status IN ('passed', 'failed', 'could_not_verify')),
  reason TEXT,
  evidence_references_json TEXT NOT NULL,
  template_binding_json TEXT,
  unknowns_json TEXT NOT NULL,
  evaluated_at TEXT NOT NULL,
  UNIQUE (run_id, outcome_check_id)
) STRICT;

CREATE INDEX external_outcome_check_results_run_index
  ON external_outcome_check_results(run_id, evaluated_at, id);

CREATE TRIGGER external_runs_prevent_outcome_snapshot_update
BEFORE UPDATE OF outcome_checks_snapshot_json ON external_runs
BEGIN
  SELECT RAISE(ABORT, 'external outcome check snapshots are immutable');
END;

CREATE TRIGGER external_outcome_check_results_prevent_update
BEFORE UPDATE ON external_outcome_check_results
BEGIN
  SELECT RAISE(ABORT, 'external outcome check results are immutable');
END;
