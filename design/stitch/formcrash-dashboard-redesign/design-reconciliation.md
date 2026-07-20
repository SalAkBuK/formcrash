# FormCrash design-system reconciliation

> **Historical provenance notice:** This reconciliation is retained as design
> history and implementation evidence. It is not current UI authority;
> `docs/product/ui-direction.md` governs current information architecture.
> Verified historical behavior and regression evidence in this document must
> still be preserved.

## Sources compared

1. Stitch Design System asset `assets/733fe26b6cc44c11bcc9ecfbfd1dcfd0` (screen instance `asset-stub-assets_733fe26b6cc44c11bcc9ecfbfd1dcfd0`).
2. Generated Stitch HTML and inline Tailwind configuration for all eight normal screens.
3. Repository design source [`design.md`](../../../design.md).
4. The pre-Chunk-1 production stylesheet `apps/dashboard/src/app/globals.css`.

The repository design source and the final Stitch asset agree on the important rules: ink-black/cool graphite surfaces, amber controlled disruption, blue focus/browser evidence, violet request evidence, strict red/green outcome semantics, Inter, JetBrains Mono, an 8px rhythm, restrained radii, tonal elevation, and outcome-first results.

The legacy stylesheet conflicted in several places: orange-red `#ff6b35` was the general accent, decorative radial/card gradients were common, headings reached 102px, static cards carried broad shadows, the technical font was platform-dependent, and many component colors were hardcoded. Chunk 1 centralizes the foundation while leaving page-specific selectors in place for later chunks.

## Decisions

| Area                             | Decision                                                                                                                                                                                                                                                                          |
| -------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Background and surface hierarchy | Use `#0A0D12` for the app/content canvas, `#0F141C` for the sidebar/input tier, `#131A24` for cards, `#18212D` for raised/hover surfaces, and a darker recessed tier for dense evidence. No decorative gradients in the shared foundation.                                        |
| Primary action color             | Amber `#FFB454`, with the dark `#23180A` text color. This is a controlled operational signal, not a failure signal.                                                                                                                                                               |
| Controlled-disruption color      | The same amber family is used for Impatient User, repeat configuration, selected experiment controls, and active navigation.                                                                                                                                                      |
| Failure color                    | Red `#FF6B78`, with `#2B151A` background and `#74313A` border, only for verified failed Outcome Checks, reproduced vulnerabilities/regressions, runner error where the existing product treats it as an error, and destructive actions.                                           |
| Passed/verified color            | Green `#58D6A3`, with `#10271F` background and `#285F4C` border, only for completed healthy/passed outcomes.                                                                                                                                                                      |
| Warning color                    | `#F4C95D`, with `#2A2412` background and `#6A5726` border, for attention and incomplete/unverified setup.                                                                                                                                                                         |
| Neutral evidence/state           | `#8A98AA` on a cool neutral surface for not configured, pending, unsupported, and secondary technical state where warning emphasis is unnecessary. These are not failures.                                                                                                        |
| Browser/network evidence         | Browser is blue `#6CB6FF`; request/network evidence is violet `#B78CFF`. They remain visually secondary to outcome status.                                                                                                                                                        |
| Text colors                      | Primary `#F4F7FB`, secondary `#AAB5C4`, muted `#7F8DA1` (slightly raised from Stitch's muted value for small-text contrast), disabled `#5F6B7C`, inverse `#23180A`, and technical `#C8D7EA`.                                                                                      |
| Border colors                    | Default `#293647`, subtle `#202B39`, strong `#3A4A60`, focus `#73B7FF`, plus explicit failure/pass/warning borders.                                                                                                                                                               |
| Typography                       | Self-host Inter for interface copy and JetBrains Mono for identifiers/technical values. Page titles are 32px, sections 24px, card titles 17px, body 14px, metadata 12px, and code 12.5px. The previous oversized marketing scale and the older Stitch 18px cap are both rejected. |
| Monospace use                    | Run IDs, paths, selectors, fingerprints, timestamps, trace/configuration values, and code only. Ordinary prose remains Inter. Long technical strings wrap safely.                                                                                                                 |
| Spacing scale                    | A single 4/8/12/16/20/24/32/48px scale, with 32px desktop page padding, 20px tablet padding, and 16px narrow padding.                                                                                                                                                             |
| Radius scale                     | 6px controls, 12px cards, 14px dialogs, and full-pill badges. This is marginally more restrained than the broad 16px legacy card treatment.                                                                                                                                       |
| Shadow policy                    | Static cards use tone plus a 1px border. Only popovers/dialogs/lightboxes may use the floating shadow.                                                                                                                                                                            |
| Focus treatment                  | A visible 2px blue outline plus a 3px translucent ring for keyboard focus. Failure red is never the default focus color.                                                                                                                                                          |
| Form-control dimensions          | Standard controls have a minimum 38px height; primary controls stay at 40px where existing padding requires it. Native labels, fieldsets, checkboxes, and radios remain intact.                                                                                                   |
| Card styling                     | Cool graphite card surface, 1px border, 12px radius, 20–24px padding, no static shadow. Existing feature hierarchy is preserved.                                                                                                                                                  |
| Navigation styling               | 240px desktop sidebar, quiet text, 40px targets, amber active marker, one `aria-current` item, and a compact horizontal form below 980px. Only real routes are linked.                                                                                                            |
| Table styling                    | Dense horizontal rows, subtle separators, no vertical grid, technical values in mono, and horizontal containment for long data. Page-specific table work is deferred.                                                                                                             |
| Status chips                     | Text plus a visible marker; semantic tones for disruption, failure, pass, warning, neutral, browser, and network. Status is never color-only.                                                                                                                                     |
| Disclosure panels                | Native `<details>/<summary>` semantics, visible focus, clear title/count/reason, and technical content collapsed by default.                                                                                                                                                      |
| Empty states                     | Neutral bordered surface with an explicit heading and explanation; no fake illustration or marketing copy.                                                                                                                                                                        |
| Loading states                   | `role="status"`, polite live announcement, neutral recessed surface, and no mandatory animation.                                                                                                                                                                                  |
| Error states                     | `role="alert"`, readable failure text and tinted border/surface. Errors are distinct from unverified/not-configured states.                                                                                                                                                       |

## Production token architecture

`apps/dashboard/src/app/globals.css` is the single production token source. Existing names such as `--accent`, `--safe`, and `--danger` are aliases into the new semantic system, which avoids a second theme and lets legacy feature screens inherit the foundation safely. Later chunks should migrate remaining page-specific hardcoded colors to the semantic tokens when those pages are deliberately redesigned.

## Shared shell and primitives

- `ApplicationShell`: product identity, real route navigation, route-derived local context, content boundary, skip link, responsive navigation.
- `Button`: primary, secondary, ghost, and destructive variants using existing `.button` classes.
- `StatusBadge`: readable label plus marker and the seven approved tones.
- `StateMessage`: loading, error, warning, and neutral semantics.
- `DisclosurePanel`: accessible native disclosure used for developer detail.
- `CopyButton`: explicit accessible name and copied-state feedback.

No UI library or icon package was added. The repository had no icon dependency; three small shell icons are inline SVG, and all feature-page icons remain unchanged until their dedicated chunks.

## Chunk 4 capability reconciliation

The three Stitch wizard screens are implemented as local visual stages inside
the existing Guided mode, not as routes or new persisted entities. Expected
Outcome embeds the existing Critical Action and Outcome Check capture/list/delete
workflow; every saved check remains authoritative and is evaluated. Safety &
Data uses only current project settings and journey data, masks runtime values,
reports authentication as saved/available or absent with the requirement unknown
until replay, and retains the real production confirmation. Review & Run maps
the local recipe, pacing, hooks, templates, and safety choices into the unchanged
experiment creation and execution APIs and keeps the existing result component.

Stitch-only Outcome Check recommendations, confidence, provenance,
generated/manual badges, enable/disable, editing, per-experiment subsets,
authentication-requirement persistence, secret/test-identity previews, and a new
live-run architecture are omitted. Existing request discovery and technical
assertion preparation remain an internal Guided prerequisite; they are disclosed
as technical runner configuration, never represented as Outcome Checks, and the
full matcher/assertion controls remain in Advanced mode. Unsaved stage, pacing,
recipe, runtime, disclosure, and validation state is explicitly allowed to reset
on refresh or a Guided remount; persisted backend entities remain authoritative.

## Deliberately deferred conflicts

The existing global stylesheet still contains page-specific hardcoded colors and internal layout rules. Removing them wholesale in Chunk 1 would redesign the feature pages and create unnecessary regression risk. The semantic aliases and shared overrides make those screens coherent now; dedicated chunks own their deeper cleanup. Stitch's fake Settings/Test Data pages, account controls, notifications, search, analytics, security-scanner vocabulary, scheduled runs, database observations, AI recommendations, and hardcoded sample data are rejected because no corresponding product capability exists.
