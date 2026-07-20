# FormCrash UI direction

**Status:** Authoritative product UI and information-architecture direction  
**Applies to:** FormCrash dashboard product surfaces  
**Related authority:** [`prd.md`](prd.md) owns product scope and behavior;
architecture documents own technical invariants.

> FormCrash is a persistent CRM-style operational application for managing
> projects, journeys, scenarios, experiments, and runs. It must not look or
> behave like a linear testing wizard, developer console, observability
> dashboard, or collection of disconnected setup cards.

## Application identity

- FormCrash is an operational application for managing resilience-testing
  records.
- It is not primarily presented as a test bench, forensic lab, browser
  automation console, or setup wizard.
- The underlying browser runner and technical evidence remain important
  capabilities, but they do not define the entire interface.

## Information architecture

- Use a persistent global application shell.
- Keep global and project-level navigation stable.
- Treat Projects as managed workspaces.
- Treat Journeys, Scenarios, Experiments or Configurations, Runs, and
  Comparisons as related operational records.
- Give each important record consistent list, overview, detail, status,
  activity, and related-record surfaces where applicable.
- Complex actions may use focused multistep dialogs or task flows, but those
  flows must not become the application's primary navigation structure.
- The product lifecycle is not automatically the page sequence.

## Surface rules

- Prefer compact record tables, structured detail sections, status strips,
  activity records, and contextual actions.
- Use large explanatory cards only for genuine empty, blocked, warning, or
  exceptional states.
- Do not translate "CRM-style" into merely adding a sidebar to an existing
  wizard.
- Do not use fake analytics, vanity KPIs, scanner language, or
  observability-dashboard patterns.
- Keep technical timelines and evidence inside the relevant Journey, Run, or
  Comparison detail record.
- State unimplemented capabilities honestly instead of representing them with
  static mock data.

## Vocabulary and relationships

- **Project:** The managed workspace for one controlled target, its environment,
  authentication, reusable execution settings, and related records.
- **Journey:** An immutable version of a recorded successful browser path.
- **Scenario:** The user-facing operational lineage that gives a Journey intent
  and relates it to its Critical Action, Outcome Checks, configurations, and
  Runs. A Scenario may contain multiple Journey versions.
- **Critical Action:** The approved state-changing action that FormCrash repeats
  or disrupts.
- **Outcome Check:** The approved user-visible or technical expectation used to
  determine whether the intended result remained correct.
- **Experiment or Configuration:** The immutable controlled-failure setup for a
  Scenario and one exact Journey version. The repository currently uses both
  terms. Choosing one permanent user-facing label is a later product decision;
  screens must explain the relationship and must not use the terms as unrelated
  objects.
- **Run:** An immutable execution record containing status, configuration
  snapshot, observations, evidence, and results.
- **Comparison:** A compatibility-checked relationship between Runs that proves
  a meaningful before-and-after change.

Until the Experiment/Configuration terminology decision is made, new UI copy
must use one term consistently within a surface and identify the persisted
record it represents. Journey and Scenario must not be presented as competing
names for the same concept: Journey is the recorded version; Scenario is the
managed operational lineage.

## Source precedence

1. Current user instructions take precedence for the task in which they are
   given.
2. This document owns FormCrash UI identity, information architecture,
   vocabulary, navigation, density, and surface patterns.
3. [`prd.md`](prd.md) owns product scope and behavior. Canonical workflows in
   product documents describe lifecycle and acceptance behavior, not mandatory
   page sequencing.
4. Documents under `docs/architecture/` own technical invariants and system
   boundaries.
5. [`../../design.md`](../../design.md) owns visual-system details only where it
   does not conflict with this document.
6. Historical Stitch mappings, generated screens, and QA handoffs are references
   and evidence, not current product authority.
7. Prior audits describe repository state at the time they were written and are
   not permanent implementation instructions.

Active behavioral defects and verification gaps remain governed by
[`active-bugs.md`](active-bugs.md). A UI restructure does not supersede that
inventory.
