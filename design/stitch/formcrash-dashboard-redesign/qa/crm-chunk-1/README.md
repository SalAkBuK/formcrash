# CRM Chunk 1 visual QA

Run `node capture-qa.mjs` from this directory while the dashboard, control
server, and sample fixture are healthy. The script selects a real persisted
non-production project with both Scenarios and Runs, performs no execution, and
captures Projects, Overview, Scenarios, Runs, and Settings at 1440×1000,
1024×768, and 390×844.

`qa-results.json` records the selected real data, screenshot paths, responsive
layout checks, accessibility checks, secret-leak checks, and browser errors.
