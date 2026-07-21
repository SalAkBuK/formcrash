ALTER TABLE recording_sessions
  ADD COLUMN authentication_required INTEGER NOT NULL DEFAULT 0
  CHECK (authentication_required IN (0, 1));
