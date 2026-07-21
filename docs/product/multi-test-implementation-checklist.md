# Multi-Test and Truthful Verdict Implementation Checklist

**Current chunk:** Chunk 6 complete - all planned chunks implemented  
**Execution rule:** Complete, verify, and report one chunk per implementation
turn. Do not begin the next chunk without a new user request.

## Guardrails

- [x] Preserve existing Towerdesk tests, versions, runs, and artifacts.
- [x] Do not execute a Towerdesk production run during implementation.
- [x] Do not reintroduce request-discovery replay into the standard test path.
- [x] Keep every new public verdict honest about its evidence basis.
- [x] Run focused and complete verification before closing each chunk.

## Chunk 1 - Canonical, truthful verdicts

- [x] **Data migration:** Keep legacy status and stored aggregates unchanged;
      derive the new fields at the read-contract boundary, so no destructive
      migration is required for historical runs.
- [x] **Contracts:** Add canonical verdict and verdict-basis contracts.
- [x] **Server:** Return derived verdict fields from persisted run summary and
      detail routes while preserving legacy `status`.
- [x] **Dashboard:** Use canonical verdicts in labels, tones, and filters.
- [x] Derive the verdict from lifecycle, Outcome Checks, and custom technical
      checks.
- [x] Mark technical-only legacy passes honestly.
- [x] Mark recipes without a network matcher as browser-outcome coverage only.
- [x] **Regression:** Cover outcome failure, unavailable outcome, runner error,
      and technical-only legacy success.
- [x] **Documentation:** Record scope, guardrails, verification, and completion
      in this checklist.
- [x] Run focused tests.
- [x] Run complete dashboard and server suites.
- [x] Run contracts/dashboard/server typechecks, ESLint, and focused formatting
      checks.
- [x] Record completion notes and commit reference.

## Chunk 2 - Explicit new test versus new version

- [x] **Data migration:** Preserve historical test versions while introducing
      stable test identities. The existing `external_experiments.id` already is
      the stable identity, so no schema migration or historical rewrite was
      required.
- [x] **Contracts/server:** Add separate new-test and create-version operations.
- [x] **Dashboard:** Expose explicit New test and Edit test actions.
- [x] **Regression:** Prove two independent tests can share and rerun one
      journey.
- [x] **Documentation:** Record API and identity behavior.
- [x] Reject duplicate journey-level test names with `TEST_NAME_EXISTS`.
- [x] Save new tests without executing them.
- [x] Resolve legacy version links to stable test identities.
- [x] Preserve existing Towerdesk Version 1 and Version 2 history.
- [x] Complete verification gate and record results.

### Chunk 2 observed verification

- Focused contracts: 37 passed.
- Focused dashboard: 27 passed across the create, save-first navigation,
  stable-link, immutable-edit, and saved-journey regressions.
- Focused server: 14 passed across persistence and lifecycle routes.
- Complete dashboard suite: 118 passed.
- Complete server suite: 225 passed.
- Contracts, dashboard, and server typechecks passed; repository ESLint passed.
- Prettier passed for every Chunk 2 file. Repository-wide Prettier still fails
  on the pre-existing 244-file formatting baseline outside this chunk.
- No Towerdesk or other production execution was performed.

## Chunk 3 - Multi-test saved-journey workspace

- [x] **Data migration:** No migration required; stable summaries and details
      read the existing Experiment, ExperimentVersion, and Run relationships.
- [x] **Contracts/server:** Add stable test summary/detail read models.
- [x] **Dashboard:** Build the multi-test journey and test-detail workspace.
- [x] **Regression:** Cover Run, Details, Edit, Duplicate, and New test actions.
- [x] **Documentation:** Update the record-oriented navigation description.
- [x] List independent tests with recipe, coverage, version, and latest verdict.
- [x] Add test version and run history.
- [x] Complete verification gate and record results.

### Chunk 3 observed verification

- Focused dashboard: 6 passed across stable test listing, selection, Run,
  Details, Edit, Duplicate, New test, version history, and run history.
- Focused server: 5 passed, including stable journey summaries and stable detail
  resolution from both test and historical version identities.
- Complete contracts suite: 37 passed.
- Complete dashboard suite: 119 passed.
- Complete server suite: 225 passed.
- Contracts, dashboard, and server typechecks passed; repository ESLint passed.
- Prettier passed for every Chunk 3 file. Repository-wide Prettier still fails
  on the pre-existing 243-file formatting baseline outside this chunk.
- No Towerdesk or other production execution was performed.

## Chunk 4 - Immutable Outcome Check ownership and browser checks

- [x] **Data migration:** Backfill immutable Outcome Check snapshots.
- [x] **Contracts/server:** Persist and evaluate version-owned check snapshots.
- [x] **Dashboard:** Add the bounded Technical checks editor without a mode
      switch.
- [x] **Regression:** Cover immutable ownership and all supported browser checks.
- [x] **Documentation:** Record check ownership and evidence boundaries.
- [x] Snapshot Critical Action and all Outcome Checks into test versions.
- [x] Remove redundant Outcome-Check-derived technical assertions.
- [x] Complete verification gate and record results.

### Chunk 4 observed verification

- Focused contracts: 39 passed, including zero-custom-check and snapshot
  ownership contracts.
- Focused dashboard: 25 passed across the normal test flow, stable test editing,
  immutable Outcome Check display, and every supported bounded browser check.
- Focused server: 24 passed across version snapshotting, migration backfill,
  immutable execution, duplicate removal, and browser-check evaluation.
- Complete contracts suite: 39 passed.
- Complete dashboard suite: 120 passed.
- Complete server suite: 225 passed.
- Contracts, dashboard, and server typechecks passed; repository ESLint passed.
- Prettier passed for all supported Chunk 4 source, test, and documentation
  files. Migration 0014 was executed by focused and complete migration tests.
  Repository-wide Prettier still fails on the pre-existing 234-file formatting
  baseline outside this chunk.
- No Towerdesk or other production execution was performed.

## Chunk 5 - Network evidence without another replay

- [x] **Data migration:** Preserve bounded candidate provenance for recording or
      approved prior-run evidence.
- [x] **Contracts/server:** Capture, rank, approve, persist, and evaluate sanitized
      network evidence.
- [x] **Dashboard:** Add matcher approval without another setup replay.
- [x] **Regression:** Cover every recipe with and without an approved matcher.
- [x] **Documentation:** Record sanitization and evidence-provenance boundaries.
- [x] Enforce the network claims made by all built-in recipes.
- [x] Complete verification gate and record results.

### Chunk 5 verification

- Focused contracts: 41 passed.
- Focused server: 30 passed across recording, candidate routes, migrations, and
  immutable approval persistence.
- Focused dashboard: 26 passed across recipe generation, the normal editor, and
  immutable version editing.
- Full suites: contracts 41, dashboard 126, server 228 passed.
- Contracts, dashboard, and server typechecks passed; repository ESLint passed.
- Focused Prettier passed for every supported touched file. SQL is not handled by
  the repository Prettier configuration. Repository-wide Prettier still reports
  the pre-existing 230-file formatting baseline outside this chunk.
- Migration 0015 preserves recording evidence and immutable approval provenance.
- No Towerdesk or other production execution was performed.
- **Completion note:** Recording-time candidates are preferred, legacy candidates
  are derived only from persisted Runs, every candidate requires explicit
  approval, and tests without approval remain browser-only. Commit not created
  because none was requested.

## Chunk 6 - Consolidation and acceptance

- [x] **Data migration:** Verify all earlier migrations against local fixtures.
- [x] **Contracts/server:** Complete backward-compatibility and acceptance checks.
- [x] **Dashboard:** Remove dead mode branches and consolidate navigation.
- [x] **Regression:** Run the complete planned acceptance matrix.
- [x] **Documentation:** Update product, architecture, active-bug, and terminology
      references.
- [x] Verify stable Project -> Journey -> Test -> Run navigation.
- [x] Complete final verification gate and record results.

### Chunk 6 observed verification

- Focused dashboard acceptance: 35 passed across the single editor, multiple
  Tests per Journey, immutable Test versions, stable navigation, custom browser
  checks, result verdicts, and no-discovery save flow.
- Focused server acceptance: 62 passed across stable identities, migration
  backfill paths, Outcome Check persistence/evaluation, custom assertions,
  network evidence, and runner outcomes. The full server suite also verified
  empty-database initialization and safe reapplication of all migrations.
- Focused contracts: 41 passed, including all canonical verdict contracts.
- Full suites: contracts 41, dashboard 124, server 228 passed.
- All workspace typechecks and repository ESLint passed.
- Focused Prettier passed for every Chunk 6 source, test, and documentation file.
  Repository-wide Prettier still reports the pre-existing 219-file formatting
  baseline outside this chunk.
- The acceptance matrix is recorded in `multi-test-acceptance.md`.
- No Towerdesk or other production execution was performed.
- **Completion note:** The unreachable Advanced workspace and its client-only
  selection/recommendation models were removed. The standard editor owns all
  supported configuration, reusable Technical checks remain standalone, stable
  Test routes use Test identity, and Run detail links back to its Project,
  Journey, and Test. Commit not created because none was requested.

## Completion log

| Chunk | Status   | Verification                                                                                                                                                                                                                                                    | Commit                        |
| ----- | -------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------- |
| 1     | Complete | Focused: contracts 36, dashboard 46, server 5. Full: dashboard 115, server 224. Contracts/dashboard/server typechecks, ESLint, and focused Prettier passed. Repository-wide Prettier remains a pre-existing 253-file baseline failure.                          | Not committed (not requested) |
| 2     | Complete | Focused: contracts 37, dashboard 27, server 14. Full: dashboard 118, server 225. Contracts/dashboard/server typechecks, ESLint, and Chunk 2 Prettier passed. Repository-wide Prettier remains a pre-existing 244-file baseline failure.                         | Not committed (not requested) |
| 3     | Complete | Focused: dashboard 6, server 5. Full: contracts 37, dashboard 119, server 225. Contracts/dashboard/server typechecks, ESLint, and Chunk 3 Prettier passed. Repository-wide Prettier remains a pre-existing 243-file baseline failure.                           | Not committed (not requested) |
| 4     | Complete | Focused: contracts 39, dashboard 25, server 24. Full: contracts 39, dashboard 120, server 225. Contracts/dashboard/server typechecks, ESLint, and supported Chunk 4 Prettier passed. Repository-wide Prettier remains a pre-existing 234-file baseline failure. | Not committed (not requested) |
| 5     | Complete | Focused: contracts 41, dashboard 26, server 30. Full: contracts 41, dashboard 126, server 228. Contracts/dashboard/server typechecks, ESLint, and supported Chunk 5 Prettier passed. Repository-wide Prettier remains a pre-existing 230-file baseline failure. | Not committed (not requested) |
| 6     | Complete | Focused: contracts 41, dashboard 35, server 62. Full: contracts 41, dashboard 124, server 228. Workspace typechecks, ESLint, and Chunk 6 Prettier passed. Repository-wide Prettier remains a pre-existing 219-file baseline failure.                            | Not committed (not requested) |
