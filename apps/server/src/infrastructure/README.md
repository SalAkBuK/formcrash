# Infrastructure boundary

Adapters for Chromium, SQLite, and the local filesystem belong to the control
server. The server is their sole owner; application packages must not import one
another to reach infrastructure.

Chunk 2 adds the focused Playwright adapter under
`runner/infrastructure/playwright-browser.ts`, beside the browser-session port it
implements. SQLite and filesystem artifact adapters remain deferred to Chunk 3.
