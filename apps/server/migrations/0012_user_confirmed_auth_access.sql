CREATE TABLE project_auth_access_next (
  project_id TEXT PRIMARY KEY,
  requirement TEXT NOT NULL CHECK (
    requirement IN (
      'unknown',
      'not_required',
      'user_confirmed_public',
      'required'
    )
  ),
  verification TEXT NOT NULL CHECK (
    verification IN ('not_checked', 'valid', 'expired', 'failed', 'inconclusive')
  ),
  last_checked_at TEXT,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE
);

INSERT INTO project_auth_access_next
  (project_id, requirement, verification, last_checked_at, updated_at)
SELECT
  project_id,
  CASE WHEN requirement = 'not_required' THEN 'unknown' ELSE requirement END,
  CASE WHEN requirement = 'not_required' THEN 'not_checked' ELSE verification END,
  last_checked_at,
  updated_at
FROM project_auth_access;

DROP TABLE project_auth_access;
ALTER TABLE project_auth_access_next RENAME TO project_auth_access;
