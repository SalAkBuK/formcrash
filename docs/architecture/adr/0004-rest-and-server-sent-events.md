# ADR 0004: REST commands plus Server-Sent Events

**Status:** Accepted

## Context

The dashboard needs finite commands and queries plus ordered, one-way run progress
from the server.

## Decision

Use REST for commands and resource queries. Use a versioned SSE stream for live
events, with event IDs that support reconnection and server-side replay from
persisted run events.

## Consequences

The protocol remains inspectable with browser tooling and ordinary HTTP clients.
SSE handles the required server-to-dashboard direction, but stop commands remain
separate REST requests and reconnect logic must account for completed streams.

## Alternatives rejected

- WebSockets: bidirectional framing and connection state are unnecessary for the
  MVP workflow.
- Polling only: adds latency and repeated queries during visible runs.
- In-process subscriptions: cannot cross the dashboard/server process boundary.
