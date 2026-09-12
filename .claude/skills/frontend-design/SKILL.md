---
name: frontend-design
description: Primary skill for visual design and frontend implementation. Use when designing or building any UI surface — pages, components, design tokens, layout, typography, color, spacing. Owns the design system as the source of truth and the translation from design decisions into CSS/React code.
---

# Frontend Design

You are the owner of the product's **visual system** and its implementation.
This skill is the *primary* one for any design or frontend work; the other two
(`mobile-app-ui-design`, `design-taste-frontend`) refine and audit what is
decided here.

## Core stance

Design is decided **at the system level first, the screen level second.**
Never style a screen in isolation — every visual value on a screen must trace
back to a token or a documented component rule. If a screen needs something the
system doesn't have, the correct move is to *extend the system deliberately*,
not to patch the screen with a one-off value.

Concretely: a one-off inline style, a hand-picked hex color, or an invented
font size is a defect, not a shortcut.

## The token layer

Every design system this skill produces has these token groups, in this order
of authority:

1. **Primitive tokens** — raw values with no meaning attached
   (`--gray-900`, `--space-4`, `--radius-md`). Never referenced by components.
2. **Semantic tokens** — meaning, not appearance
   (`--color-surface`, `--color-text-secondary`, `--color-border`,
   `--color-danger`). This is the ONLY layer components are allowed to read.
3. **Component tokens** — only where a component genuinely needs its own knob
   (`--button-height-md`). Use sparingly; most components need none.

Rules:
- A component that reads a primitive token directly is a bug.
- Adding a new semantic token requires a reason that a reviewer could restate:
  what *meaning* is this expressing that no existing token expresses?
- Themes (light/dark/etc.) swap **values of semantic tokens only** — never the
  token names, never a component's structure.

## Scales, not values

Every dimension must come from a finite, documented scale:

- **Spacing** — a single scale on a 4pt base (4, 8, 12, 16, 20, 24, 32, 40, 48,
  64). Nothing between steps. If a layout "needs" 14px, the layout is wrong.
- **Type** — a scale with named roles (display / title / heading / body /
  label / caption), each with a fixed size, weight, and line-height triple.
  No half-pixel sizes, ever. A new size means a new role, which means a
  documented reason.
- **Radius** — at most 4 steps plus `full`. Radius encodes *element size*, not
  decoration: small controls get the small step, containers the large one.
- **Elevation** — at most 3 steps. Elevation encodes *layering distance from
  the page*, not importance.

If the codebase currently contains more distinct values than the scale allows,
that gap is the highest-value thing to fix.

## Color discipline

- Start from a neutral ramp and **one** accent. A second accent needs to earn
  its place by expressing something the first cannot.
- Semantic status colors (success / warning / danger / info) are separate from
  brand accents and must not be reused decoratively.
- Contrast is a hard constraint, not a preference: body text ≥ 4.5:1,
  large text and UI boundaries ≥ 3:1. Check the actual computed values.
- **Color is never the only carrier of meaning.** Pair it with an icon, a
  label, a weight change, or position.

## Hierarchy without decoration

Establish hierarchy in this order, and only move to the next when the previous
is exhausted:

1. **Position and grouping** (what is near what, what is first)
2. **Space** (what has room to breathe)
3. **Type scale and weight**
4. **Color/contrast** (text ramp: primary → secondary → tertiary)
5. **Surface** (a distinct background)
6. **Border**
7. **Elevation/shadow**

A design that reaches for step 7 to make something important has usually failed
at steps 1–3. Gradients, glows, and heavy shadows are not hierarchy tools at
all — they are texture, and texture competes with content.

## Structure over chrome

- Prefer **lists and sections divided by space and hairlines** over cards.
  A card is for content that is genuinely a separable object.
- **Never nest a card inside a card.** If it seems necessary, the outer card
  should have been a section.
- A page should read as a vertical sequence of clearly-named sections, not a
  scattering of floating panels.
- Empty space is a design element. Crowding is a decision to communicate less.

## Component rules

Each component in the system must document:

- its **variants** (and why each exists — a variant without a distinct job is
  deleted)
- its **states**: default, hover, pressed/active, focus-visible, disabled,
  loading, error
- its **sizes**, from the scale
- **what it must not be used for**

Never ship a component whose pressed and focus states were not designed.

## Implementation rules

- Components consume semantic tokens through CSS custom properties. No hex
  values, no magic numbers, no inline style objects for anything the system
  should own.
- Use **logical properties** (`inline-start`, `inline-end`, `margin-inline`,
  `padding-block`, `text-align: start`) everywhere — never `left`/`right`.
  This is what makes RTL/LTR a single implementation instead of two.
- One class naming convention, applied consistently, documented once.
- Keep one styling mechanism. Mixing an external component kit with a bespoke
  CSS system means two visual identities fighting in the same screen; if a kit
  is used, wrap it so it reads as *your* system, or don't use it.

## Documentation is part of the deliverable

The design system document is the source of truth. It must be specific enough
that a new screen can be designed from it without guessing, and it must state
its own **anti-patterns** — the things that are deliberately not allowed —
because a system that only says "yes" gives no guidance under pressure.

When a new design conflicts with the system, the conflict is resolved *at the
system level first*: either the system changes deliberately and the document is
updated, or the design changes. A screen never wins silently.
