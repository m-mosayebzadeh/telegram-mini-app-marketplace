---
name: mobile-app-ui-design
description: Mobile-first UX and interaction design. Use when deciding navigation structure, information architecture, touch interactions, gestures, sheets/modals, or any behavior that differs between a real mobile app and a responsive website. Also use for Telegram Mini App specific constraints (viewport, safe areas, native controls).
---

# Mobile App UI Design

This skill covers everything about a UI that is **behavioral and structural**
rather than visual: how a person moves through the app, what their thumb can
reach, what happens on tap, and how the app behaves inside a real phone.

A common failure this skill exists to prevent: building a *responsive website
that happens to be narrow* and calling it a mobile app. They are different
products with different rules.

## Website vs. app — the difference that matters

| Website thinking | App thinking |
|---|---|
| Page loads, header at top, scroll for everything | Persistent chrome, content scrolls under it |
| Navigation is links | Navigation is a stack with state and direction |
| Back = browser back | Back is an explicit, visible, predictable affordance |
| Actions live where they fit in the document | Primary actions live where the thumb is |
| Hover reveals things | Nothing may depend on hover |
| A form is a page | A form is often a sheet |

## Information architecture

- Bottom navigation carries **3–5 top-level destinations**, and they must be
  *destinations* (places you return to), never actions.
- Every top-level tab must be something a user visits repeatedly. A tab used
  once per session belongs somewhere else.
- **The first tab is where the app opens.** Open on the tab that delivers the
  product's core value, not on the user's own account page.
- Anything a user needs repeatedly and cannot currently reach in ≤2 taps from a
  tab root is an IA bug — especially money, status, and anything time-sensitive.
- Depth is a cost: prefer a flat structure with sheets over deep push stacks.
  If a flow is more than 3 levels deep, question the flow.

## Navigation mechanics

- **Push** (slide in from the inline-end edge) for going deeper into a
  hierarchy: detail from list, sub-setting from setting.
- **Sheet** (slide up from the bottom) for a focused, self-contained task the
  user will finish and dismiss: picking, confirming, a short form.
- **Full-screen cover** for immersive or irreversible flows: media viewer,
  onboarding, payment.
- **Alert/dialog** only for a genuine decision with consequences. Never for
  information — that is what inline feedback and toasts are for.
- Going back must restore the previous screen's **scroll position and state**.
  Losing a user's place is one of the most damaging small bugs in mobile UX.
- Every pushed screen has a visible back affordance in a consistent position.
  Never rely on the platform gesture alone.

## The thumb zone

Assume one-handed use on a 6"+ phone.

- **Easy reach**: the bottom third of the screen, biased toward the center and
  the holding hand's side.
- **Hard reach**: the top corners — especially the far top corner.
- Therefore: **primary actions belong at the bottom.** A "Save"/"Continue"/
  "Buy" button at the top of a long screen is a design error.
- The top bar is for *orientation* (where am I, how do I get back) and at most
  one secondary action.
- Destructive actions must not sit where a thumb naturally rests.

## Touch targets

- Minimum **44×44pt** (iOS) / **48×48dp** (Android) for anything tappable.
  This is the *hit area*, which may be larger than the visible element.
- Minimum **8px** of separation between adjacent targets.
- Icon-only buttons need the full target size regardless of icon size.
- A row in a list is a target: give it real height (≥48px), not just padding
  around text.
- Text links inside body copy are a poor mobile pattern — prefer a real button.

## Interaction and feedback

- **Every tap produces visible feedback within 100ms.** Pressed states are not
  optional decoration; without them the app feels broken.
- Optimistic UI where the action is likely to succeed and cheap to reverse;
  explicit pending state where it is not (payments, destructive actions).
- Show loading **in place** — a skeleton or inline spinner where the content
  will appear — not a full-screen blocker that discards context.
- Never block the whole screen for a partial update.
- Long operations need progress, not just a spinner.

## Sheets

The workhorse of modern mobile UI. A good sheet has:

- A grab handle and a rounded top edge, visually continuous with the screen
  behind it.
- A dimmed backdrop that dismisses on tap.
- Swipe-down-to-dismiss, unless the task must not be lost accidentally.
- Its own title, and its primary action pinned to the bottom, inside the sheet.
- Height sized to content; a sheet that always covers the full screen should
  have been a pushed screen.

## States are features

Every list, every screen, every async surface must define:

- **Loading** — skeletons that match the shape of the real content
- **Empty** — an explanation and a way forward; never just "no data"
- **Error** — what happened, and a retry action
- **Partial/offline** — when some data is stale or unavailable
- **Success** — confirmation that is noticed but not obstructive (toast)

Undefined states are where apps feel unfinished.

## Motion

- 150–250ms for most transitions; 200–350ms for sheets.
- Motion must **explain spatial relationships**: pushed screens come from the
  edge, sheets rise from the bottom, dismissals reverse their entrance.
- Animate `transform` and `opacity` only.
- Nothing decorative, nothing looping, nothing that delays interaction.
- Respect `prefers-reduced-motion`.

## RTL / LTR as one implementation

- Layout mirrors: navigation order, back arrows, list chevrons, progress
  direction, swipe directions.
- Layout does **not** mirror: media, numbers, phone numbers, brand marks,
  clock-style icons.
- Achieve this with logical properties and a single `dir` on the root — never
  with a parallel set of RTL-specific rules, which always drift.
- Mixed-direction text (Persian prose containing a Latin username or an amount)
  needs explicit isolation so it doesn't visually reorder.

## Telegram Mini App specifics

- The app runs inside a WebView with the Telegram client's own chrome above it.
  Do not duplicate what the host already provides.
- Respect `safe-area-inset-*` on every fixed element, top and bottom.
- The viewport can change height when the keyboard opens or the app expands;
  fixed bottom elements must survive that.
- Prefer the platform's own controls (native invoice sheet, native confirm)
  where they exist — they are more trusted and more familiar than a custom
  reimplementation.
- The app may open at any depth from a link; every screen must be able to render
  standalone with a sensible back target.
