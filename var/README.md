# Local runtime storage

The control server owns all generated content under this directory:

- `database/` — active SQLite metadata and sidecar files.
- `runs/` — per-run structured evidence.
- `screenshots/` — binary browser captures referenced by metadata.
- `exports/` — generated human-readable and regression-test exports.

Generated content is ignored by Git. Directory markers are retained so a clean
checkout has the expected layout.

To reset FormCrash metadata, stop the server and delete generated database files
and screenshot run directories while retaining `.gitkeep`. This removes persisted
FormCrash runs and evidence. It does not reset sample-checkout orders; use the
sample checkout's `POST /api/test-support/reset` endpoint for that independent
process-local state.
