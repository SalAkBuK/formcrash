CREATE TABLE project_auth_access (
  project_id TEXT PRIMARY KEY,
  requirement TEXT NOT NULL CHECK (
    requirement IN ('unknown', 'not_required', 'required')
  ),
  verification TEXT NOT NULL CHECK (
    verification IN ('not_checked', 'valid', 'expired', 'failed', 'inconclusive')
  ),
  last_checked_at TEXT,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE
);
