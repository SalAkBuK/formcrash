DROP TRIGGER external_experiment_versions_prevent_update;

ALTER TABLE recording_sessions
  ADD COLUMN request_evidence_json TEXT NOT NULL DEFAULT '[]';

ALTER TABLE external_experiment_versions
  ADD COLUMN network_evidence_provenance_json TEXT;

CREATE TRIGGER external_experiment_versions_prevent_update
BEFORE UPDATE ON external_experiment_versions
BEGIN
  SELECT RAISE(ABORT, 'external experiment versions are immutable');
END;
