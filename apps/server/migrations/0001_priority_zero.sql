CREATE TABLE projects (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  target_url TEXT NOT NULL,
  description TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
) STRICT;

CREATE TABLE journeys (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES projects(id),
  name TEXT NOT NULL,
  version INTEGER NOT NULL CHECK (version > 0),
  definition_json TEXT NOT NULL,
  created_at TEXT NOT NULL,
  UNIQUE (project_id, name, version)
) STRICT;

CREATE TABLE experiments (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES projects(id),
  journey_id TEXT NOT NULL REFERENCES journeys(id),
  name TEXT NOT NULL,
  experiment_type TEXT NOT NULL CHECK (experiment_type = 'impatient_user'),
  created_at TEXT NOT NULL,
  UNIQUE (project_id, name)
) STRICT;

CREATE TABLE experiment_versions (
  id TEXT PRIMARY KEY,
  experiment_id TEXT NOT NULL REFERENCES experiments(id),
  version INTEGER NOT NULL CHECK (version > 0),
  configuration_json TEXT NOT NULL,
  journey_snapshot_json TEXT NOT NULL,
  assertions_snapshot_json TEXT NOT NULL,
  created_at TEXT NOT NULL,
  UNIQUE (experiment_id, version)
) STRICT;

CREATE TABLE recovery_assertions (
  id TEXT PRIMARY KEY,
  experiment_version_id TEXT NOT NULL REFERENCES experiment_versions(id),
  assertion_type TEXT NOT NULL CHECK (assertion_type = 'max_created_orders'),
  configuration_json TEXT NOT NULL,
  created_at TEXT NOT NULL,
  UNIQUE (experiment_version_id, assertion_type)
) STRICT;

CREATE TABLE runs (
  id TEXT PRIMARY KEY,
  experiment_version_id TEXT NOT NULL REFERENCES experiment_versions(id),
  mode TEXT NOT NULL CHECK (mode IN ('vulnerable', 'fixed')),
  status TEXT NOT NULL CHECK (status IN (
    'created', 'starting', 'running', 'evaluating', 'passed', 'failed',
    'stopping', 'incomplete', 'runner_error'
  )),
  started_at TEXT NOT NULL,
  completed_at TEXT,
  duration_ms INTEGER CHECK (duration_ms IS NULL OR duration_ms >= 0),
  target_url TEXT NOT NULL,
  journey_snapshot_json TEXT NOT NULL,
  experiment_snapshot_json TEXT NOT NULL,
  assertions_snapshot_json TEXT NOT NULL,
  observed_json TEXT,
  runner_error_json TEXT,
  evidence_warnings_json TEXT NOT NULL DEFAULT '[]',
  created_at TEXT NOT NULL
) STRICT;

CREATE TABLE run_events (
  id TEXT PRIMARY KEY,
  run_id TEXT NOT NULL REFERENCES runs(id),
  sequence_number INTEGER NOT NULL CHECK (sequence_number > 0),
  event_type TEXT NOT NULL,
  relative_timestamp_ms INTEGER NOT NULL CHECK (relative_timestamp_ms >= 0),
  recorded_at TEXT NOT NULL,
  schema_version INTEGER NOT NULL CHECK (schema_version = 1),
  payload_json TEXT NOT NULL,
  UNIQUE (run_id, sequence_number)
) STRICT;

CREATE TABLE assertion_results (
  id TEXT PRIMARY KEY,
  run_id TEXT NOT NULL REFERENCES runs(id),
  assertion_id TEXT NOT NULL REFERENCES recovery_assertions(id),
  assertion_type TEXT NOT NULL CHECK (assertion_type = 'max_created_orders'),
  status TEXT NOT NULL CHECK (status IN ('passed', 'failed', 'not_evaluated', 'error')),
  expected_json TEXT NOT NULL,
  observed_json TEXT NOT NULL,
  expected_description TEXT NOT NULL,
  observed_description TEXT NOT NULL,
  evaluated_at TEXT NOT NULL,
  UNIQUE (run_id, assertion_id)
) STRICT;

CREATE TABLE artifacts (
  id TEXT PRIMARY KEY,
  run_id TEXT NOT NULL REFERENCES runs(id),
  artifact_type TEXT NOT NULL CHECK (artifact_type = 'screenshot'),
  label TEXT NOT NULL CHECK (label IN ('before-disruption', 'after-disruption', 'final-result')),
  relative_path TEXT NOT NULL UNIQUE,
  mime_type TEXT NOT NULL,
  size_bytes INTEGER NOT NULL CHECK (size_bytes > 0),
  checksum_sha256 TEXT NOT NULL CHECK (
    length(checksum_sha256) = 64
    AND checksum_sha256 NOT GLOB '*[^0-9a-f]*'
  ),
  capture_sequence INTEGER NOT NULL CHECK (capture_sequence > 0),
  created_at TEXT NOT NULL,
  metadata_json TEXT NOT NULL,
  UNIQUE (run_id, capture_sequence),
  UNIQUE (run_id, label)
) STRICT;

CREATE INDEX runs_created_at_index ON runs(created_at DESC);
CREATE INDEX run_events_run_sequence_index ON run_events(run_id, sequence_number);
CREATE INDEX assertion_results_run_index ON assertion_results(run_id);
CREATE INDEX artifacts_run_sequence_index ON artifacts(run_id, capture_sequence);

CREATE TRIGGER experiment_versions_prevent_update
BEFORE UPDATE ON experiment_versions
BEGIN
  SELECT RAISE(ABORT, 'experiment versions are immutable');
END;

CREATE TRIGGER experiment_versions_prevent_delete
BEFORE DELETE ON experiment_versions
BEGIN
  SELECT RAISE(ABORT, 'experiment versions are immutable');
END;

CREATE TRIGGER runs_prevent_snapshot_update
BEFORE UPDATE OF experiment_version_id, mode, target_url, journey_snapshot_json,
  experiment_snapshot_json, assertions_snapshot_json ON runs
BEGIN
  SELECT RAISE(ABORT, 'run snapshots are immutable');
END;

CREATE TRIGGER run_events_prevent_update
BEFORE UPDATE ON run_events
BEGIN
  SELECT RAISE(ABORT, 'run events are append-only');
END;

CREATE TRIGGER run_events_enforce_next_sequence
BEFORE INSERT ON run_events
WHEN NEW.sequence_number != (
  SELECT COALESCE(MAX(sequence_number), 0) + 1
  FROM run_events
  WHERE run_id = NEW.run_id
)
BEGIN
  SELECT RAISE(ABORT, 'run event sequence must append monotonically');
END;

CREATE TRIGGER run_events_prevent_delete
BEFORE DELETE ON run_events
BEGIN
  SELECT RAISE(ABORT, 'run events are append-only');
END;
