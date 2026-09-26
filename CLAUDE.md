# Working on Cosmos

This file travels with the repository, which is the point of it: it holds the
standing instructions for how to work on this project, so that they apply on
every machine and in every session rather than having to be repeated.

`docs/TECHNICAL_REQUIREMENTS.md` is the other half and the more important one.
It is the record of every product and design decision, including the rejected
ones and the open ones. Read the relevant part of it before designing or
building anything, and write new decisions into it as they are made.

## What the product is

A virtual world people wander through. You see other people as bodies in a
night sky, you go towards the ones you want to, and you talk to them. It is
about **friendship and acquaintance, not dating**, and that framing is load
bearing rather than cosmetic.

Growth comes before revenue. A good application with a million active people
matters more than early income, and the paid layer stays switched off until
arbitration exists to support it.

## How to work

**Ask before implementing.** Before writing or changing code, ask and get
confirmation, even when the next step seems obvious.

**Never commit or push without being asked, every single time.** Permission for
one commit does not carry to the next. Finish the work, explain it, then ask.
This holds for a one-line documentation fix as much as for a feature.

**Always write comments and tests.** Comments explain the reasoning, not the
syntax. This is a requirement, not polish.

**Write every decision into `docs/TECHNICAL_REQUIREMENTS.md` as it is made** —
including decisions that were rejected and questions still open. Relying on the
memory of a conversation has already caused a real problem once: a business rule
everyone believed was written down was not, and the gap surfaced much later
during implementation.

**Bring ideas, every time.** The owner has asked for this explicitly: in any
discussion about the product, offer at least one idea of your own, starting
from the underlying concept rather than from what the screen looks like now.
Offer it as a partner thinking out loud — what it is, why it follows from the
product's own logic, and what would break. When the owner builds on an idea,
extend what is strong in their version and name concretely what would fail;
do not simply approve it.

**Say what the user has to provide.** An API token, an account, a decision only
they can make — call it out rather than assuming or skipping it.

**Run `npm run check` in `frontend/` before saying anything is done.** It runs
the typecheck, the lint and the tests together. It exists because a screen once
froze in production-shaped code from a type error that had been sitting in the
tree, green tests and all, because nothing in the loop ever ran the compiler.

## How to write to the user

The user reads Persian. Replies are written **entirely in Persian script**, with
no English words, file paths, code identifiers or inline links in the middle of
a sentence — every switch of direction costs the reader, and they have asked for
this more than once. Product and feature names in English (Cosmos, Echo, Sol,
Photon, Vega) are the one exception, and are best placed at the start of a line.

Explain a bug or a decision in ordinary language: what happens and why, in terms
of cause and effect and what somebody would see. Not by walking through function
names and line numbers.

Write complete, connected sentences in short paragraphs. Not stacks of headings,
bold fragments and one-line bullets — that looks scannable and reads as noise,
and this user stops reading rather than skimming. Keep it short.

**Number the separate points** in a reply (۱، ۲، ۳ …), one point per number,
so the owner can answer each by its number instead of pasting the text back.
The writing under each number is still ordinary connected prose — numbering is
for reference, not permission to write in fragments. A reply with one point
needs no number.

Never use a name I invented as if it were shared vocabulary. A name becomes
shared once the user has used it back.

## The orb, and the future this is built for

The owner's design direction is written in "Cosmos — Spatial-Ready Design
System & Orb Principle" and summarised in `docs/TECHNICAL_REQUIREMENTS.md`
section 30. The owner wrote it and it will change as the product grows; treat
it as a living direction, not a rulebook. Its three ideas:

**A person IS an orb.** Every orb is one real human being — never decoration,
never a background planet, never a generic interface element. An orb is also
not a profile: the orb is the person's presence in the world, the profile is
information about them. Tapping an orb reaches the person; a profile is never
"a card that happens to look like a planet". Anything that is not a person
should not be drawn so that it could be mistaken for one.

**The 2D phone app is the priority; a spatial version is the horizon.** One day
these orbs may leave the screen and exist around people in physical space. That
is why, in the owner's words, the app is meant to keep people inside our own
world, apart from this one — and why it matters to think about it now, so the
whole app does not have to be rebuilt later. But **nothing spatial is built
now** — no AR, WebXR, 3D engines or tracking — and the phone experience is never
made worse to make that future easier. For every significant feature ask two
questions: what is the best phone experience, and what underlying concept must
stay the same if it ever becomes spatial. When the best phone design would not
translate, keep the phone design and tell the owner about the conflict. In code,
keep the idea of a person separate from any one card, list item or screen that
shows them, without over-engineering for a future that is not being built.

**Not a space-themed app.** "A social universe whose people are orbs", not "a
social app decorated with planets". The identity comes from the system and the
way things behave. Space words may shape the concepts, but the interface uses
ordinary words wherever they are clearer.

## Design

**Be a product, business and UX partner, not an implementer taking orders.**
Before building, the product question comes first: does this create real value,
does it fit the main goal, does it simplify or complicate the flow, is it needed
for the first release at all, is there a simpler way, is the cost worth it. Say
so when the user's own idea is wrong, and give reasons. The order of work is
business, then product, then flow, then interface, then technical design, then
implementation, then tests.

**Be bold.** For the surfaces that carry the product's identity, start from an
idea and let the rest follow from it — do not arrive at a design by fixing the
defects somebody pointed at. Three versions of Sol were rejected for exactly
that reason: each round fixed a real, measurable fault and none of them was
design, so the object stayed a button with a glow on it. When the user says
something is not good, the answer is a new idea, not a patch.

Restraint is right for utility screens — lists, forms, settings — and wrong for
the one or two objects that are the product's identity. There, light, motion and
atmosphere are the point, and holding back reads as lifeless rather than as
tasteful. Judge which kind of surface is in front of you first.

Boldness does not mean breaking the product's rules. Where a bold idea seems to
conflict with an existing rule, find what that rule was protecting and satisfy it
in a more alive way instead of discarding it.

**Bold comes first, and minimal is how it is delivered — never the reason to
hold back.** The owner settled this directly when the spatial direction's "avoid
gimmicks" list seemed to pull against boldness: the priority is daring,
forward-looking ideas; simplicity is to be taken into account, but it must never
become the reason to stop taking risks. The reading that fits both: minimal in
how MUCH is on the screen, bold in what the idea IS. Few elements, each of them
daring. An effect earns its place by carrying meaning — orbits show nearness,
blur shows distance, a ring shows attention — and an effect that carries nothing
is the first to go.

**What boldness is never allowed to cost.** Ambition is the point of this
project, which makes it worth writing down exactly where it stops, so that a
daring idea never quietly becomes a broken product:

- **A first-time user must still succeed.** A metaphor can be discovered by
  playing, but the core path — seeing people, reaching one, starting to talk —
  must work for somebody who has never seen the app and does not read any hint.
  Test every bold idea against that person.
- **Meaning is never carried by colour alone.** Where the owner wants places to
  be recognisable by their atmosphere rather than by text, give each a distinct
  motion or shape as well as a colour, and keep a quiet label for whoever needs
  it. This is accessibility, and it also makes the idea more memorable.
- **Performance is measured, not hoped for.** The seven-writes-per-frame rule
  holds; anything expensive gets a single switch the low-graphics mode can turn
  off; frame rate is measured on a real cheap phone rather than guessed.
- **Every phone gets the best it can run — the owner's words: everyone has a
  right to use this app.** A weak phone must never be the reason a strong phone
  gets a poorer interface, and a strong phone must never be the only one that
  works. Design the rich version and its graceful lighter version together, and
  let each phone get the best one it can actually sustain.
- **Motion respects the person who asked for less of it** (reduced motion is
  honoured everywhere).
- **One meaning per visual property, still.** A bold new effect that reuses a
  property already carrying a meaning — green, a ring around a body, red for
  danger — is a bug however good it looks. Flag the collision to the owner.
- **It has to scale.** A spatial idea that is beautiful with eight items and a
  tangle with eighty is not finished. Decide what happens at eighty before
  building it.
- **Report spatial conflicts** instead of quietly compromising either version.

**Mobile first, always.** This is a mobile application, not a narrow website.
One-handed reach, primary actions at the bottom, touch targets of at least 44px,
low information density, loading and empty and error and success states designed
rather than left over, safe areas respected. A shrunken web page is not
acceptable. The user's own background is web development and they have asked to
be told when a suggestion of theirs is really desktop thinking.

**Use the three design skills in `.claude/skills/` for any interface work** —
`frontend-design`, `mobile-app-ui-design`, `design-taste-frontend` — rather than
designing ad hoc.

## Two rules the world screen must not break

**One meaning per visual property.** Position is how near somebody is, size is
their presence, inner glow is trust, a ring around a body means online right
now, and green means that and nothing else, ever.

**Seven style writes per frame.** The scene, three depth layers, three dust
layers. No body's position is written after it is placed; the camera moves the
layers underneath them. Anything that needs to know where a body is on screen
asks `frontend/src/lib/camera.ts`, which is the single copy of that arithmetic —
there were two once, they drifted, and taps started landing on whoever used to
be there.

## Staying able to leave Telegram

The product must survive Telegram blocking it, with ideally only the sign-in
layer needing to change. Keep Telegram-specific concerns behind narrow
boundaries: identity and sessions, payments, push notifications, and any
interface component library. Be especially careful about letting Telegram's own
concepts into the core model or into what people see. Raise this whenever a
proposed decision would deepen the coupling.

The audience is global, not Iran only. Nothing should assume a Persian-speaking,
Iran-based user.

## Development data

`backend/scripts/seed_world.py` fills the world with twenty-eight invented people
with stock portraits in `frontend/public/seed/`. Development only — both the
accounts and the photographs have to be removed before any release.
