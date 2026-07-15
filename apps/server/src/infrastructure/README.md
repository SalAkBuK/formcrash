# Infrastructure boundary

Adapters for Chromium, SQLite, and the local filesystem belong to the control
server. The server is their sole owner; application packages must not import one
another to reach infrastructure.

The focused Playwright adapter lives under
`runner/infrastructure/playwright-browser.ts`, beside the browser-session port it
implements. Chunk 3 adds `persistence/` for SQLite lifecycle, migrations, seeding,
and focused run repositories plus `artifacts/` for staged filesystem screenshot
writes and safe reads. The dashboard and sample checkout have no access to either.
