---
name: FormCrash — Operational Resilience Application
version: 1.0
mode: dark-first
keywords:
  - operational application
  - reliability testing
  - resilience records
  - controlled failure
  - browser automation
  - forensic clarity
colors:
  background: '#0A0D12'
  surface: '#0F141C'
  surface-subtle: '#131A24'
  surface-raised: '#18212D'
  surface-high: '#1E2937'
  border: '#293647'
  border-strong: '#3A4A60'
  text-primary: '#F4F7FB'
  text-secondary: '#AAB5C4'
  text-muted: '#738195'
  primary: '#FFB454'
  primary-hover: '#FFC477'
  primary-pressed: '#E99A31'
  on-primary: '#23180A'
  focus: '#73B7FF'
  info: '#6CB6FF'
  success: '#58D6A3'
  warning: '#F4C95D'
  danger: '#FF6B78'
  danger-strong: '#FF4858'
  neutral: '#8A98AA'
  browser-evidence: '#6CB6FF'
  request-evidence: '#B78CFF'
  outcome-evidence: '#FFB454'
  pass-bg: '#10271F'
  pass-border: '#285F4C'
  fail-bg: '#2B151A'
  fail-border: '#74313A'
  warn-bg: '#2A2412'
  warn-border: '#6A5726'
  info-bg: '#102338'
  info-border: '#28557D'
  overlay: 'rgba(0, 0, 0, 0.68)'
typography:
  display:
    fontFamily: Inter
    fontSize: 32px
    fontWeight: '700'
    lineHeight: 40px
    letterSpacing: -0.03em
  headline-lg:
    fontFamily: Inter
    fontSize: 24px
    fontWeight: '700'
    lineHeight: 32px
    letterSpacing: -0.02em
  headline-md:
    fontFamily: Inter
    fontSize: 20px
    fontWeight: '650'
    lineHeight: 28px
    letterSpacing: -0.015em
  headline-sm:
    fontFamily: Inter
    fontSize: 17px
    fontWeight: '650'
    lineHeight: 24px
    letterSpacing: -0.01em
  body-lg:
    fontFamily: Inter
    fontSize: 16px
    fontWeight: '400'
    lineHeight: 24px
  body-md:
    fontFamily: Inter
    fontSize: 14px
    fontWeight: '400'
    lineHeight: 21px
  body-sm:
    fontFamily: Inter
    fontSize: 13px
    fontWeight: '400'
    lineHeight: 19px
  label-md:
    fontFamily: Inter
    fontSize: 12px
    fontWeight: '650'
    lineHeight: 16px
    letterSpacing: 0.025em
  label-sm:
    fontFamily: Inter
    fontSize: 11px
    fontWeight: '700'
    lineHeight: 14px
    letterSpacing: 0.06em
  code:
    fontFamily: JetBrains Mono
    fontSize: 12.5px
    fontWeight: '400'
    lineHeight: 19px
rounded:
  xs: 0.25rem
  sm: 0.375rem
  md: 0.5rem
  lg: 0.75rem
  xl: 1rem
  full: 9999px
spacing:
  unit: 8px
  xs: 4px
  sm: 8px
  md: 16px
  lg: 24px
  xl: 32px
  xxl: 48px
  page-inline: 32px
  page-block: 28px
  content-max: 1440px
shadows:
  raised: '0 12px 32px rgba(0, 0, 0, 0.28)'
  floating: '0 18px 48px rgba(0, 0, 0, 0.42)'
  focus: '0 0 0 3px rgba(115, 183, 255, 0.28)'
---

# FormCrash Design System

> **Authority:** This file owns visual-system details only where they do not
> conflict with [`docs/product/ui-direction.md`](docs/product/ui-direction.md).
> That document governs application identity and information architecture.
> [`docs/product/active-bugs.md`](docs/product/active-bugs.md) remains authoritative
> for unresolved behavior and verification; visual restructuring must not hide
> those issues.

## Design Theme

**Operational Resilience Workspace**

FormCrash should feel like a persistent operational application for managing
resilience-testing records—not a test bench, analytics suite, hacker terminal,
or temporary setup flow.

Within that application, run and evidence details combine three ideas:

1. **A test bench** — clear controls, known inputs, deterministic runs.
2. **A forensic workspace** — evidence is organized by what was observed and when.
3. **A proof surface** — the product leads with expected outcome, observed outcome, and whether the protection worked.

The visual character should be dark, calm, deliberate, and technical without becoming sterile. Use warm amber as the FormCrash brand signal for controlled disruption. Reserve red for an actual failed outcome, green for verified success, blue for browser evidence, and violet for request evidence.

The user should feel:

- “I know exactly what FormCrash is doing.”
- “The failure is controlled, not chaotic.”
- “The conclusion is backed by evidence.”
- “I can inspect deeper details when needed.”

## Brand Principles

### 1. Outcome before telemetry

Every result page should answer these questions before showing logs:

- What was expected?
- What was observed?
- Did the outcome pass, fail, or remain unverified?
- What evidence supports that conclusion?

Requests, assertions, event IDs, locators, traces, and timing data belong in secondary technical sections.

### 2. Controlled disruption, not “crash aesthetics”

Do not use glitch effects, broken typography, neon cyberpunk styling, warning stripes, or noisy red backgrounds. FormCrash introduces failures deliberately and should visually communicate control.

### 3. Evidence has provenance

Different evidence types should be visually distinct but restrained:

- Browser evidence: blue
- Request evidence: violet
- Outcome evidence: amber
- Passed conclusion: green
- Failed conclusion: red

Every screenshot, request count, and observed value should retain a visible source label.

### 4. Progressive disclosure

Primary views should remain understandable to a developer in under ten seconds. Detailed event timelines, assertion IDs, matcher provenance, trace diagnostics, and raw configuration remain collapsed by default.

### 5. Status is never color-only

Always pair semantic color with:

- an icon
- a text label
- a short sentence

Examples:

- Failed — “Two visible results appeared instead of one.”
- Passed — “The intended result occurred exactly once.”
- Could not verify — “The expected browser state could not be evaluated.”

## Color System

### Core surfaces

Use a cool ink-black foundation instead of neutral brown-black or pure black.

- `background` is the application canvas.
- `surface` is used for the sidebar and large sections.
- `surface-subtle` is used for cards.
- `surface-raised` is used for active panels, dropdowns, and selected states.
- `surface-high` is reserved for dialogs and strongly separated content.

Cards should usually differ through tonal layering and a restrained border, not heavy shadows.

### Brand accent

`primary: #FFB454`

Amber represents a controlled test signal: the deliberate point where FormCrash repeats, delays, interrupts, or stresses an action.

Use it for:

- primary actions
- active navigation
- selected experiment controls
- disruption configuration
- current-step indicators
- FormCrash brand mark

Do not use amber for failed outcomes. Failure remains red.

### Semantic colors

- **Success:** `#58D6A3`
- **Warning:** `#F4C95D`
- **Failure:** `#FF6B78`
- **Information / browser evidence:** `#6CB6FF`
- **Request evidence:** `#B78CFF`

Use tinted semantic backgrounds rather than full-saturation fills for cards.

### Contrast

- Body text should use `text-primary` or `text-secondary`.
- `text-muted` is only for metadata and supporting labels.
- Never place muted text on a tinted semantic background without checking contrast.
- Avoid low-contrast grey-on-grey data tables.

## Typography

Use **Inter** for interface text and **JetBrains Mono** for technical identifiers.

Unlike the previous compressed system, result headlines must have enough scale to establish a clear hierarchy. Do not cap all headings at 18px.

### Use Inter for

- navigation
- headings
- descriptions
- status summaries
- buttons
- forms
- table labels

### Use JetBrains Mono for

- run IDs
- journey version IDs
- request paths
- selectors
- timing values
- fingerprints
- environment values
- trace diagnostics

Do not use monospace for ordinary prose.

### Text hierarchy

- Display: product landing or empty-state statement
- Headline large: result conclusion
- Headline medium: page title or major section
- Headline small: card title
- Body large: primary explanation
- Body medium: normal interface copy
- Label small: uppercase metadata labels only

Avoid excessive uppercase. Use it only for compact evidence category labels and metadata.

## Layout

### Application shell

- Left sidebar: 232–248px fixed width on desktop
- Main content: centered, maximum 1440px
- Page padding: 32px desktop, 20px tablet, 16px mobile
- Main grid: 12 columns with 16px gutters
- Result pages: 8-column primary content + 4-column context rail where useful

The main navigation should remain stable and visually quiet. The current task or project may use the amber active marker.

### Density

Use **balanced density**, not maximum density.

FormCrash contains technical data, but the primary workflow needs breathing room. Use compact rows inside technical tables, while result summaries, onboarding, and comparison screens should use generous 20–24px card padding.

### Vertical rhythm

Use:

- 8px between label and value
- 16px between tightly related controls
- 24px between sections within a card
- 32px between major page sections
- 48px between distinct workflow stages

## Shape and Depth

Use moderate rounding:

- Inputs and buttons: 6px
- Status chips: full pill
- Cards: 10–12px
- Dialogs: 14–16px
- Screenshot frames: 10px

Avoid excessive rounded “bubble” interfaces.

### Borders

- Default card border: 1px `border`
- Active card border: 1px `border-strong`
- Failed state: tinted red border, not a full red card
- Passed state: tinted green border
- Selected disruption control: amber border with subtle amber background

### Shadows

Use shadows only for floating layers, dialogs, dropdowns, and image lightboxes. Static dashboard cards should rely on surface layering and borders.

## Iconography

Use a consistent line icon set such as Lucide.

Recommended visual symbols:

- Controlled disruption: split arrow, repeated cursor, pulse
- Critical action: crosshair or target
- Outcome check: check-circle with brackets
- Browser evidence: monitor or image
- Request evidence: network or route
- Comparison: columns or arrow-left-right
- Replay: play-circle
- Trace: route or activity
- Warning boundary: shield-alert

Avoid filled cartoon icons and illustrations inside dense product screens.

## Core Components

### Primary button

- Amber background
- Dark text
- 36–40px height
- Medium weight label
- Hover: slightly brighter amber
- Focus: blue focus ring

Use for one primary action per section.

### Secondary button

- Transparent or `surface-raised`
- `border` outline
- Primary text

Use for reload, open details, compare, and secondary navigation.

### Destructive button

Use red only for destructive actions such as delete, clear, or discard. Do not use red for “Run experiment.”

### Inputs

- 38–40px height
- `surface-subtle` background
- `border` outline
- blue focus ring
- validation message beneath field

Selectors and generated-value templates should use monospace for their values.

### Status chips

Each chip includes icon + text.

Examples:

- Passed
- Failed
- Could not verify
- Running
- Reconnecting
- Not configured
- Compatible
- Incompatible

Never use plain grey text as the only indication of status.

### Evidence card

An evidence card includes:

- evidence category label
- title
- timestamp or sequence
- source metadata
- primary observation
- optional “Open details” action

Use the left border or small category icon to distinguish browser, request, and outcome evidence. Do not fully tint the card.

### Screenshot card

A screenshot card should contain:

- visible image preview
- phase label
- short phase description
- file metadata
- open-fullscreen action

Required phase language:

1. Before repeated submission
2. Repeated submissions in flight
3. Settled application state

Use “Browser evidence,” not “Visual proof.”

### Expected vs observed block

Use a two-column comparison on desktop and stacked cards on mobile.

Expected:

- neutral or amber marker
- approved expected condition
- stable wording

Observed:

- semantic marker based on result
- observed count, pathname, or visibility
- direct evidence reference when available

The conclusion appears below both columns, not inside only one side.

### Technical details disclosure

Use a collapsed disclosure panel titled **Developer detail**.

Inside it may contain:

- technical timeline
- assertion IDs
- matcher configuration
- journey step IDs
- trace diagnostics
- environment data
- replay strategies
- immutable snapshot identifiers

The summary row should show the count of items and a concise reason to open it.

## Screen Patterns

## 1. Home / Start Screen

The first screen should offer exactly two obvious paths:

### Run the bundled demo

Description:

“See how FormCrash reproduces duplicate checkout submission and proves the fix.”

Primary action:

`Open Sample Checkout`

### Test an external project

Description:

“Record a critical browser journey, define the intended outcome, and test it under repeated submission.”

Secondary action:

`Create Project`

Do not lead with architecture terminology or feature grids.

## 2. Project Readiness and Contextual Tasks

Treat Target, Authentication, Journey recording, Critical Action approval,
Outcome Check approval, experiment configuration, and Runs as related project
records and contextual actions. Their lifecycle order may inform status and next
actions, but it must not become permanent application-wide wizard navigation.

A complex action may use a focused multistep dialog or task flow. Keep the stable
application shell and project record context visible, and return the user to the
relevant record when the task finishes or is cancelled.

Do not show all advanced settings at once. Keep advanced controls behind explicit disclosure.

## 3. Recording and Replay

The recording screen should communicate:

- recording status
- target environment
- viewport/environment capture status
- trace/video capture status
- supported boundaries

Replay settings should expose pacing as segmented options:

- Recorded
- Deliberate
- Fast

Each option needs one-line explanatory copy.

Disruption timing is separate from replay pacing and must remain visually distinct.

## 4. Run Result

Order the page as follows:

1. Status and primary conclusion
2. Expected outcome vs observed outcome
3. Key counts
4. What happened
5. Why it matters
6. Common protections to investigate, only when relevant
7. Browser evidence
8. Outcome Check cards
9. Evidence boundaries
10. Developer detail, collapsed

A failed result should use a red accent bar or border, not a full red background.

## 5. Failed-versus-fixed Comparison

Use a three-part layout:

### Header

- compatibility status
- proof status
- concise conclusion

### Before / After proof table

Use a stable two-column layout:

- Before fix
- After fix

Rows may include:

- repeated-action triggers
- successful matching requests
- visible or created results
- expected maximum
- outcome

Before uses a restrained red marker. After uses a restrained green marker.

### Paired browser evidence

Pair screenshots by phase:

- before repeated submission
- submissions in flight
- settled application state

Do not mix screenshots from different phases in a single row.

## 6. Run History

Use compact rows with:

- status
- project / journey
- experiment
- mode
- started time
- duration
- outcome summary
- compare action where eligible

Do not turn run history into an analytics dashboard.

## Motion

Motion should communicate system state, not decorate the interface.

Allowed:

- 120–180ms hover and focus transitions
- subtle progress pulse while a run is active
- smooth disclosure expansion
- screenshot lightbox fade
- short state transition from running to terminal result

Avoid:

- animated gradients
- glitch effects
- shaking failure cards
- looping hero animations
- excessive skeleton shimmer

Respect reduced-motion preferences.

## Copy Style

Use direct, evidence-backed language.

Preferred:

- “Two visible results appeared instead of one.”
- “FormCrash issued two triggers 100 ms apart.”
- “The application created two orders.”
- “Database state was not inspected.”
- “Common protections to investigate.”

Avoid:

- “Catastrophic failure detected.”
- “Your app is broken.”
- “Root cause found.”
- “Guaranteed protection.”
- “Pixel-perfect replay.”
- “Works on every website.”

Do not use marketing language inside evidence views.

## Accessibility

- Meet WCAG AA contrast for text and controls.
- Visible keyboard focus is mandatory.
- Status must never rely only on color.
- Screenshot cards require descriptive alt text.
- Collapsed technical sections require accessible expanded state.
- Tables require proper headers.
- Buttons require action-oriented labels.
- Respect reduced motion.
- Do not make critical controls smaller than 36px high.

## Responsive Behavior

### Desktop

- Sidebar visible
- Two-column result layouts allowed
- Paired screenshots displayed side by side

### Tablet

- Sidebar collapses
- Context rail moves below primary result
- Comparison tables remain horizontally readable

### Mobile

- Stack expected and observed cards
- Stack before and after evidence
- Convert wide technical tables to key-value cards or horizontal scroll
- Keep primary result and run status above the fold

Mobile support should remain functional, but desktop is the primary supported
environment for the persistent operational application.

## Stitch Generation Guidance

When generating FormCrash screens in Stitch:

- Use the exact palette and typography tokens in this file.
- Prefer realistic product data over generic placeholder charts.
- Generate dense but readable operational record layouts.
- Lead result pages with expected versus observed outcomes.
- Keep technical evidence collapsed by default.
- Use amber for controlled action and selection, red only for failed outcomes, and green only for verified success.
- Include clear browser evidence cards with real screenshot aspect ratios.
- Avoid generic SaaS KPI dashboards, pie charts, line charts, testimonial blocks, pricing cards, and large marketing gradients.
- Avoid terminal-heavy layouts unless rendering actual trace or request data.
- Do not use glassmorphism.
- Do not use cyberpunk styling.
- Do not use bright red as the brand color.
- Do not over-round every component.
- Do not represent FormCrash as a security scanner.

## Suggested Stitch Prompt

Design a dark-first operational resilience application called FormCrash. Use a
persistent shell, stable record navigation, compact record lists, structured
detail sections, status strips, activity, and contextual actions. Run details
should lead with expected outcome, observed outcome, conclusion, browser evidence,
and a collapsed Developer detail section. Use an ink-black and cool graphite
surface system, amber for controlled disruption and primary actions, red only for
failed outcomes, green for verified success, blue for browser evidence, and
violet for request evidence. Use Inter for interface text and JetBrains Mono for
technical values. Use balanced density, 10–12px card radii, thin borders,
limited shadows, no gradients, no glassmorphism, no cyberpunk effects, and no
analytics charts unless the screen specifically requires one.

## Non-Negotiable Design Rules

1. Results lead with outcomes, not logs.
2. Amber represents controlled disruption, not failure.
3. Red appears only for an actual failed state or destructive action.
4. Technical timelines remain collapsed by default.
5. Browser, request, and outcome evidence remain visibly distinct.
6. Before/after comparisons use the same evidence rows and screenshot phases.
7. Generated values, secrets, and sensitive content must never be exposed through decorative mock data.
8. Every unsupported state must be explained plainly.
9. No generic dashboard charts.
10. No universal-replay or root-cause claims.
