# External target fixture

This controlled application is deliberately separate from
`apps/sample-checkout`. It verifies the generic recorder and replay engine and,
when hosted by the stateful integration-test server, supports Chunk 6:

- `?auth=required` protects the form behind `/api/login` and `/api/session`.
- `?mode=vulnerable` permits repeated `/api/profile` creates.
- `?mode=fixed` suppresses concurrent repeat submits.
- `/api/reset` is the repeatable before/after hook target.

The HTML retains a client-side fallback so the original static Chunk 5
recording integration remains valid.
