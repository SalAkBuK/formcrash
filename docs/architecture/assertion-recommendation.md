# Server-owned assertion recommendation

This document describes the legacy request-discovery recommendation contract.
The standard test editor no longer executes discovery or exposes a separate
Advanced assertion workspace. It derives bounded built-in network checks from
an explicitly approved recording/prior-run candidate and uses the reusable
Technical checks editor for optional browser checks. The compatibility endpoint
continues to return the recommendation records described below.

## Evidence boundary

The server uses only evidence from the single normal discovery action:

- The selected ranked request candidate and its method, sanitized origin/path,
  response status, classification, confidence, and stable candidate ID.
- The chosen repeated-action recipe, trigger count, and interval.
- The recorded click or submit target and its replay locator.
- Whether a stable triggering control was directly observed disabled while the
  normal request was pending.
- Stable selector candidates whose bounded attributes classify them as success,
  error, or loading elements, plus their before/after visibility.
- The final pathname without query parameters.

It does not collect request bodies, response bodies, arbitrary page text, raw
HTML, cookies, authorization headers, hidden storage, application source, or
database state. Semantic elements require an explicit stable
`data-formcrash`, `data-testid`, ID, or name locator. Classification uses bounded
attributes, not the element's visible text.

## Recommendation categories

For a selected mutation, the server can recommend:

- Maximum matching request count.
- Maximum successful matching response count.
- No matching HTTP 5xx response.
- An allowed status set derived from the successful discovery response and,
  for the server duplicate-handling recipe, HTTP 409.

When direct interface evidence exists, it can also recommend:

- The triggering control is disabled during repeated action.
- A stable success indicator becomes visible.
- A known stable error indicator remains hidden.
- The final URL contains a stable pathname or safely reduced pathname prefix.

The current model cannot prove a generic business-record count or that a success
notification appeared exactly once. Those absences are returned as explicit
limitations instead of invented assertions.

## Confidence and defaults

Network recommendations are `high` confidence and enabled by default only when
the selected request is the server's high-confidence recommendation. Ambiguous,
review, and overridden candidates receive `review` recommendations that remain
disabled until the user approves them.

Interface and navigation recommendations are currently `review` confidence and
disabled by default. They are based on one observed normal action and stable
selectors, but still require user judgment about whether the observed interface
is the intended recovery contract.

Recommendation IDs and draft assertion IDs are SHA-256-derived from normalized
safe evidence. Identical evidence therefore produces identical IDs.

## Pending-state evaluation

`element_disabled` supports an optional `observationWindow`.
`during_repeated_action` is evaluated from the state captured immediately after
the runner issues the repeated triggers and before its normal settle window.
Legacy and manually authored assertions without this field retain final-state
semantics.

## Immutable assertion provenance

Migration `0006_assertion_selection_provenance.sql` adds bounded assertion
selection provenance to external experiment versions. Each entry records:

- Recommendation ID, when applicable.
- Generated, generated-modified, or manual origin.
- Recommendation confidence, reason, and human-written explanation.
- Default enabled state and accepted, enabled, disabled, modified, or manual
  action.
- Safe evidence identifiers.

Disabled recommendations have no saved assertion ID. Legacy versions load with
an empty provenance list. Raw HTML, page text, request/response bodies, query
strings, cookies, authorization headers, auth state, and runtime secrets are not
persisted in provenance.
