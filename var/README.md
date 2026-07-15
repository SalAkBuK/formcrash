# Local runtime storage

The control server will own all content under this directory:

- `database/` — SQLite metadata files.
- `runs/` — per-run structured evidence.
- `screenshots/` — binary browser captures referenced by metadata.
- `exports/` — generated human-readable and regression-test exports.

Generated content is ignored by Git. Directory markers are retained so a clean
checkout has the expected layout.
