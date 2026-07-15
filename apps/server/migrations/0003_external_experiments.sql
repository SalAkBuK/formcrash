CREATE TABLE project_execution_settings (
  project_id TEXT PRIMARY KEY REFERENCES projects(id),
  variables_json TEXT NOT NULL DEFAULT '[]',
  before_hook_json TEXT,
  after_hook_json TEXT,
  updated_at TEXT NOT NULL
) STRICT;

CREATE TABLE project_auth_sessions (
  project_id TEXT PRIMARY KEY REFERENCES projects(id),
  relative_path TEXT NOT NULL UNIQUE,
  captured_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
) STRICT;

CREATE TABLE auth_capture_sessions (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES projects(id),
  status TEXT NOT NULL CHECK (status IN (
    'created', 'launching', 'awaiting_confirmation', 'stopping',
    'completed', 'runner_error'
  )),
  error_message TEXT,
  started_at TEXT NOT NULL,
  completed_at TEXT
) STRICT;

CREATE TABLE external_experiments (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES projects(id),
  journey_id TEXT NOT NULL REFERENCES journeys(id),
  name TEXT NOT NULL,
  experiment_type TEXT NOT NULL CHECK (experiment_type = 'impatient_user'),
  created_at TEXT NOT NULL,
  UNIQUE (project_id, journey_id, name)
) STRICT;

CREATE TABLE external_experiment_versions (
  id TEXT PRIMARY KEY,
  experiment_id TEXT NOT NULL REFERENCES external_experiments(id),
  version INTEGER NOT NULL CHECK (version > 0),
  configuration_json TEXT NOT NULL,
  journey_snapshot_json TEXT NOT NULL,
  assertions_snapshot_json TEXT NOT NULL,
  created_at TEXT NOT NULL,
  UNIQUE (experiment_id, version)
) STRICT;

CREATE TABLE external_runs (
  id TEXT PRIMARY KEY,
  experiment_version_id TEXT NOT NULL REFERENCES external_experiment_versions(id),
  project_id TEXT NOT NULL REFERENCES projects(id),
  journey_id TEXT NOT NULL REFERENCES journeys(id),
  status TEXT NOT NULL CHECK (status IN (
    'created', 'starting', 'running', 'evaluating', 'passed', 'failed',
    'runner_error'
  )),
  started_at TEXT NOT NULL,
  completed_at TEXT,
  duration_ms INTEGER CHECK (duration_ms IS NULL OR duration_ms >= 0),
  target_url TEXT NOT NULL,
  project_name TEXT NOT NULL,
  journey_name TEXT NOT NULL,
  experiment_name TEXT NOT NULL,
  experiment_snapshot_json TEXT NOT NULL,
  resolved_values_json TEXT NOT NULL DEFAULT '{}',
  trigger_attempts INTEGER NOT NULL DEFAULT 0 CHECK (trigger_attempts >= 0),
  network_observations_json TEXT NOT NULL DEFAULT '[]',
  runner_error_json TEXT,
  warnings_json TEXT NOT NULL DEFAULT '[]',
  created_at TEXT NOT NULL
) STRICT;

CREATE TABLE external_run_events (
  id TEXT PRIMARY KEY,
  run_id TEXT NOT NULL REFERENCES external_runs(id),
  sequence_number INTEGER NOT NULL CHECK (sequence_number > 0),
  event_type TEXT NOT NULL,
  relative_timestamp_ms INTEGER NOT NULL CHECK (relative_timestamp_ms >= 0),
  recorded_at TEXT NOT NULL,
  schema_version INTEGER NOT NULL CHECK (schema_version = 1),
  payload_json TEXT NOT NULL,
  UNIQUE (run_id, sequence_number)
) STRICT;

CREATE TABLE external_assertion_results (
  id TEXT PRIMARY KEY,
  run_id TEXT NOT NULL REFERENCES external_runs(id),
  assertion_id TEXT NOT NULL,
  assertion_type TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('passed', 'failed', 'not_evaluated', 'error')),
  description TEXT NOT NULL,
  expected_description TEXT NOT NULL,
  observed_description TEXT NOT NULL,
  evaluated_at TEXT NOT NULL,
  UNIQUE (run_id, assertion_id)
) STRICT;

CREATE TABLE external_artifacts (
  id TEXT PRIMARY KEY,
  run_id TEXT NOT NULL REFERENCES external_runs(id),
  artifact_type TEXT NOT NULL CHECK (artifact_type = 'screenshot'),
  label TEXT NOT NULL CHECK (label IN ('before-disruption', 'after-disruption', 'final-result')),
  relative_path TEXT NOT NULL UNIQUE,
  mime_type TEXT NOT NULL,
  size_bytes INTEGER NOT NULL CHECK (size_bytes > 0),
  checksum_sha256 TEXT NOT NULL,
  capture_sequence INTEGER NOT NULL CHECK (capture_sequence > 0),
  created_at TEXT NOT NULL,
  metadata_json TEXT NOT NULL,
  UNIQUE (run_id, capture_sequence),
  UNIQUE (run_id, label)
) STRICT;

CREATE INDEX external_experiment_versions_experiment_index
  ON external_experiment_versions(experiment_id, version DESC);
CREATE INDEX external_runs_created_at_index ON external_runs(created_at DESC);
CREATE INDEX external_run_events_sequence_index
  ON external_run_events(run_id, sequence_number);
CREATE INDEX external_assertion_results_run_index
  ON external_assertion_results(run_id);
CREATE INDEX external_artifacts_run_index
  ON external_artifacts(run_id, capture_sequence);

CREATE TRIGGER external_experiment_versions_prevent_update
BEFORE UPDATE ON external_experiment_versions
BEGIN
  SELECT RAISE(ABORT, 'external experiment versions are immutable');
END;

CREATE TRIGGER external_experiment_versions_prevent_delete
BEFORE DELETE ON external_experiment_versions
BEGIN
  SELECT RAISE(ABORT, 'external experiment versions are immutable');
END;

CREATE TRIGGER external_runs_prevent_snapshot_update
BEFORE UPDATE OF experiment_version_id, project_id, journey_id, target_url,
  project_name, journey_name, experiment_name, experiment_snapshot_json,
  resolved_values_json ON external_runs
BEGIN
  SELECT RAISE(ABORT, 'external run snapshots are immutable');
END;

CREATE TRIGGER external_run_events_enforce_next_sequence
BEFORE INSERT ON external_run_events
WHEN NEW.sequence_number != (
  SELECT COALESCE(MAX(sequence_number), 0) + 1
  FROM external_run_events
  WHERE run_id = NEW.run_id
)
BEGIN
  SELECT RAISE(ABORT, 'external run event sequence must append monotonically');
END;

CREATE TRIGGER external_run_events_prevent_update
BEFORE UPDATE ON external_run_events
BEGIN
  SELECT RAISE(ABORT, 'external run events are append-only');
END;

CREATE TRIGGER external_run_events_prevent_delete
BEFORE DELETE ON external_run_events
BEGIN
  SELECT RAISE(ABORT, 'external run events are append-only');
END;
