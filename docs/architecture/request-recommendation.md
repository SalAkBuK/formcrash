# Server-owned request recommendation

The original journey recording now observes bounded browser request metadata
around recorded click and submit actions: method, origin and host, pathname
without query parameters, response status or failure, relative start time, and
grouped occurrence count. It does not capture request bodies, response bodies,
cookies, authorization headers, arbitrary headers, or query strings. This is the
preferred candidate source because it does not require another state-changing
replay.

Legacy journeys without recording-time evidence may rank the same sanitized
metadata from already persisted Run observations. That fallback is labeled
`prior_run`; it never silently becomes a matcher and requires explicit user
approval before the next immutable test version can use it.

## Traffic boundary

Preparation and cleanup hooks execute through server-side `fetch`, outside the
Playwright page observer, so hook requests cannot become discovery candidates.
Initial navigation and replay steps before the selected target execute while
discovery capture is disabled.

Capture begins immediately before the selected click or submit and ends after
the bounded post-action settle window. The selected mutation is eligible for
automatic recommendation. Consequential read-only refresh traffic may remain
visible as evidence, but known refresh/background traffic is classified as
`background_refresh` and excluded from approval. The normal editor displays the
bounded ranking reasons and requires an explicit choice.

## Deterministic scoring

Candidates are grouped by method, origin, pathname, and response status. The
server then assigns these additive signals:

| Signal                                          |     Score |
| ----------------------------------------------- | --------: |
| `POST`, `PUT`, `PATCH`, or `DELETE`             |       +50 |
| Read-only method                                |       -25 |
| Same origin as the controlled target            |       +20 |
| Cross-origin request                            |       -20 |
| HTTP 2xx or 3xx response                        |       +15 |
| Browser-reported failure                        |       -30 |
| Missing response status                         |       -12 |
| HTTP 5xx response                               |       -25 |
| Started within 250 ms of the action             |       +12 |
| Started within 1 second                         |        +8 |
| Started within 3 seconds                        |        +3 |
| Started later                                   |        -5 |
| Resource-oriented or API-like path              |        +8 |
| Bounded path/action term overlap                | up to +12 |
| Bounded path/journey term overlap               |  up to +8 |
| One occurrence                                  |        +3 |
| Two occurrences                                 |        +2 |
| Three or more occurrences                       |        -4 |
| Background/session/configuration/health traffic |       -30 |
| Analytics or telemetry traffic                  |      -100 |
| Static asset traffic                            |      -100 |

Path similarity is supporting evidence only. A pathname can never make a
read-only, cross-origin, failed, or ambiguous candidate high-confidence by
itself.

## Classification and outcomes

Every candidate receives a stable ID, rank, score, classification, confidence,
recommended flag, and plain-language reasons with individual score impacts.

- `recommended`: the leading candidate is a same-origin successful mutation,
  scores at least 75, and leads the next plausible candidate by at least 15.
- `ambiguous`: the two leading plausible mutations both score at least 45 and
  differ by less than 15. No request is silently selected.
- `review`: one candidate is strongest but lacks the evidence required for a
  high-confidence recommendation.
- `no_candidate`: no request was observed, or only unsuitable traffic remained,
  or the strongest plausible candidate scored below 15.

Equal scores use stable classification, method, origin, pathname, status, and
candidate-ID ordering. Identical evidence therefore produces identical ranking
regardless of observation-array order.

## Dashboard behavior

The normal test editor lists recording-time candidates without replay. Every
candidate requires the explicit `Use this request` action. Failed, incomplete,
and read-only candidates cannot be approved. When no bounded candidate exists,
the test remains honestly labeled `Browser outcome coverage only` and does not
claim request-count, successful-response, status, or server-error protection.

Discovery remains available as a compatibility path outside the normal editor.
Request ranking remains the shared input boundary for recording and prior-run
candidates; assertion generation is documented separately in
[`assertion-recommendation.md`](assertion-recommendation.md).

## Immutable provenance

An experiment version may store:

- Discovery ID and timestamp.
- Discovery outcome.
- Automatic, confirmed-recommendation, or manual-override selection mode.
- Selected candidate ID, score, confidence, and reasons.
- Recommended and selected method/path/host matchers.
- Whether the user overrode a recommendation.
- Recording or prior-run evidence source, source Run identity where applicable,
  approved candidate score/reasons/status/timing, the bounded matcher, and the
  explicit approval timestamp.

Only this bounded recommendation metadata is persisted. Raw payloads, bodies,
headers, cookies, authentication state, and runtime secrets are excluded.
Versions created before this capability load with `null` provenance.

Built-in network recipes are contract-enforced after approval. Double-click and
triple-click tests bound matching attempts by their trigger count, allow at most
one successful matching response, and reject HTTP 5xx. Server duplicate
handling additionally requires the approved successful response status and HTTP
409 duplicate status set. Without approval, these assertions are absent rather
than reported as protection.
