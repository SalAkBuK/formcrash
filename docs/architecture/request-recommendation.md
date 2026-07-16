# Server-owned request recommendation

Request discovery executes the selected recorded click or submit once. The
control server observes only bounded browser request metadata: method, origin,
pathname without query parameters, response status or failure, relative start
time, and grouped occurrence count. It does not capture request bodies, response
bodies, cookies, authorization headers, or arbitrary headers.

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

Guided Test preselects a request only for the `recommended` outcome. Review and
ambiguous outcomes require an explicit user choice. A no-candidate outcome does
not fabricate a matcher and directs the user to interface-only assertions in
Advanced mode.

Advanced mode displays server rank, classification, confidence, score, and
reasons while retaining manual override.

Discovery also returns assertion recommendation sets tied to each candidate and
to the no-selection case. Request ranking remains the input boundary; assertion
generation is documented separately in
[`assertion-recommendation.md`](assertion-recommendation.md).

## Immutable provenance

An experiment version may store:

- Discovery ID and timestamp.
- Discovery outcome.
- Automatic, confirmed-recommendation, or manual-override selection mode.
- Selected candidate ID, score, confidence, and reasons.
- Recommended and selected method/path/host matchers.
- Whether the user overrode a recommendation.

Only this bounded recommendation metadata is persisted. Raw payloads, bodies,
headers, cookies, authentication state, and runtime secrets are excluded.
Versions created before this capability load with `null` provenance.
