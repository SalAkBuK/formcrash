ALTER TABLE journeys ADD COLUMN recording_metadata_json TEXT;

CREATE TABLE recording_sessions (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES projects(id),
  status TEXT NOT NULL CHECK (status IN (
    'created', 'launching', 'recording', 'stopping', 'completed', 'runner_error'
  )),
  steps_json TEXT NOT NULL DEFAULT '[]',
  warnings_json TEXT NOT NULL DEFAULT '[]',
  error_message TEXT,
  started_at TEXT NOT NULL,
  completed_at TEXT
) STRICT;

CREATE INDEX projects_updated_at_index ON projects(updated_at DESC);
CREATE INDEX journeys_project_created_index ON journeys(project_id, created_at DESC);
CREATE INDEX recording_sessions_project_started_index
  ON recording_sessions(project_id, started_at DESC);
