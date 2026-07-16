ALTER TABLE projects
  ADD COLUMN environment TEXT NOT NULL DEFAULT 'local'
  CHECK (environment IN ('local', 'staging', 'production'));

UPDATE projects
   SET environment = CASE
     WHEN target_url LIKE 'http://localhost%'
       OR target_url LIKE 'https://localhost%'
       OR target_url LIKE 'http://127.0.0.1%'
       OR target_url LIKE 'https://127.0.0.1%'
       OR target_url LIKE 'http://[::1]%'
       OR target_url LIKE 'https://[::1]%'
     THEN 'local'
     ELSE 'production'
   END;

DROP TRIGGER external_experiment_versions_prevent_delete;
DROP TRIGGER external_run_events_prevent_delete;
DROP TRIGGER experiment_versions_prevent_delete;
DROP TRIGGER run_events_prevent_delete;
