ALTER TABLE recording_sessions ADD COLUMN capture_format TEXT NOT NULL
  DEFAULT 'semantic-v1'
  CHECK (capture_format IN ('semantic-v1', 'hybrid-v2'));

ALTER TABLE recording_sessions ADD COLUMN trace_status TEXT NOT NULL
  DEFAULT 'not_captured'
  CHECK (trace_status IN (
    'not_captured', 'capturing', 'complete', 'truncated', 'corrupt'
  ));

ALTER TABLE recording_sessions ADD COLUMN trace_summary_json TEXT;

CREATE TABLE recording_traces (
  id TEXT PRIMARY KEY,
  recording_session_id TEXT NOT NULL UNIQUE REFERENCES recording_sessions(id),
  format_version INTEGER NOT NULL CHECK (format_version = 2),
  manifest_json TEXT NOT NULL,
  relative_path TEXT NOT NULL UNIQUE,
  size_bytes INTEGER NOT NULL CHECK (size_bytes >= 0),
  checksum_sha256 TEXT NOT NULL CHECK (
    length(checksum_sha256) = 64 AND checksum_sha256 NOT GLOB '*[^a-f0-9]*'
  ),
  created_at TEXT NOT NULL
) STRICT;

CREATE TABLE journey_trace_links (
  journey_id TEXT PRIMARY KEY REFERENCES journeys(id),
  trace_id TEXT NOT NULL REFERENCES recording_traces(id),
  manifest_json TEXT NOT NULL,
  created_at TEXT NOT NULL
) STRICT;

CREATE INDEX journey_trace_links_trace_index
  ON journey_trace_links(trace_id, journey_id);

CREATE TRIGGER recording_traces_prevent_update
BEFORE UPDATE ON recording_traces
BEGIN
  SELECT RAISE(ABORT, 'recording traces are immutable');
END;

CREATE TRIGGER journey_trace_links_prevent_update
BEFORE UPDATE ON journey_trace_links
BEGIN
  SELECT RAISE(ABORT, 'journey trace links are immutable');
END;
