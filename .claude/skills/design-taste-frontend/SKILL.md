---
name: design-taste-frontend
description: Design critique and visual quality layer. Use to review an existing or proposed UI before it ships — composition, restraint, consistency, and whether it reads as a real product or as generic template/AI output. Apply after design decisions are made, not instead of making them.
---

# Design Taste (Frontend)

This skill is a **review layer**. It does not produce designs; it judges them
and names what is wrong specifically enough to fix.

Use it at two moments: when auditing an existing UI, and immediately before
shipping a new one.

## The core question

> Does this look like a product someone deliberately made, or like a template
> that content was poured into?

Deliberate products have a **point of view**: a small number of consistent
decisions applied everywhere. Generic UI is recognizable because it has no
decisions — it has defaults, and it hedges by adding more.

## Markers of generic / AI-default UI

Treat each of these as a finding, not a style preference:

- A **gradient** used as a surface or a button fill, with no meaning attached.
- **Glassmorphism** (translucency + blur) used as the default surface.
- **Colored glows** as shadows.
- Everything is a **card**, including things that are not objects.
- **Cards nested inside cards.**
- **Pill radius on everything**, so radius carries no information.
- Emoji used as interface iconography.
- Multiple accent colors that don't mean different things.
- Center-aligned body text and labels in a list-based UI.
- Decorative background blobs, orbs, or "ambient" glows.
- The same visual weight on every element, so nothing leads.
- Marketing-landing-page rhythm (hero, then equal-weight sections) applied to a
  utility app.

The common root: **decoration substituting for hierarchy.**

## Composition checks

Walk the screen and ask:

1. **Where does the eye land first?** Is that the most important thing? If two
   things compete, one must lose.
2. **Can you name the sections without reading the labels?** If grouping is
   unclear, spacing is wrong.
3. **Is the spacing rhythm consistent?** Unequal gaps between peer elements is
   the fastest way a UI reads as sloppy.
4. **Is related content actually closer than unrelated content?** Proximity is
   the strongest grouping signal, and the most often violated.
5. **Does anything align to nothing?** Every edge should line up with another
   edge. Stray left edges are visible even when a viewer can't name why.
6. **Is there a single, obvious primary action?** Two primary buttons means no
   primary button.
7. **Does the screen breathe?** Or is the density hiding a structure problem?

## Consistency audit

Count, don't estimate. Across the codebase:

- How many **distinct font sizes** exist? (More than ~7 = no type scale.)
- How many **distinct radii**? (More than ~5 = radius is noise.)
- How many **spacing values** are off the scale?
- How many **header patterns** does the app have? (More than 2 = users relearn
  the app on every screen.)
- How many **one-off inline styles**? (Every one is a gap in the system.)
- Do **loading / empty / error** states look like they come from the same app
  as the content states?

Inconsistency is usually not a series of small mistakes — it is one missing
rule, repeated.

## Restraint test

For each visual effect on the screen, ask: **what would be lost if this were
removed?**

If the answer is "nothing" or "it would look plainer," remove it. Plainer is
the correct default; effects must be earned by a job they do.

Specifically challenge: every shadow, every border, every background fill,
every icon, every divider, every badge. A border and a background fill doing
the same separating job means one of them is redundant.

## Typography test

- Is there a clear step between heading and body, or do they blur together?
- Are there more than two weights doing real work?
- Is line-height comfortable for the script being used? (Persian/Arabic needs
  more than Latin — roughly 1.7–1.8 for body vs 1.5.)
- Are numbers tabular where they're compared in a column?
- Does mixed Persian/Latin text sit correctly, or does it visually reorder?

## The "premium" question

Premium is not gold, dark mode, or glass. Premium reads as:

- Generous, consistent space
- Restrained color, used with intent
- Sharp, confident typography with real hierarchy
- Precise alignment
- Fast, subtle, purposeful motion
- Nothing extraneous

If a design is trying to *look* expensive, it usually looks cheap. If it is
quiet, precise, and effortless to use, it reads as expensive.

## How to report findings

For each finding, state:

1. **What** — the specific element/rule, with a location
2. **Why it's a problem** — the principle it violates, in one sentence
3. **The fix** — concrete and implementable, not "make it cleaner"

Rank findings by user impact, not by how visible they are to a designer.
A 31px touch target matters more than an inconsistent radius, even though the
radius is what a critique notices first.

## What this skill must not do

- Do not relitigate a decision the design system has already made — if the
  system is wrong, say so at the system level.
- Do not offer taste as absolute truth; offer the *principle* behind it so the
  decision can be argued with.
- Do not pile on. Three real findings acted on beat twenty ignored.
