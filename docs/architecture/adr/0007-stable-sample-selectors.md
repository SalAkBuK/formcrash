# ADR 0007: Stable `data-formcrash` selectors for the bundled sample

**Status:** Accepted

## Context

The guaranteed demonstration path needs deterministic element targeting while
the checkout UI remains free to change its styling and accessible labels.

## Decision

Add purpose-specific `data-formcrash` attributes to interactive and observable
sample-checkout elements needed by the saved journey and assertions. Production
semantics and accessibility remain primary; these attributes are a stable test
contract owned by the sample checkout.

## Consequences

The seeded journey avoids brittle CSS structure and text selectors. Selector
changes become contract changes and should fail tests. External targets cannot be
assumed to provide these attributes and need a later selector strategy.

## Alternatives rejected

- CSS position or DOM-structure selectors: too fragile for reliable replay.
- Visible text alone: copy changes should not invalidate the guaranteed demo.
- Injected runtime element IDs: adds coupling and timing complexity.
- Claiming universal selector support: outside the locked Priority 0 scope.
