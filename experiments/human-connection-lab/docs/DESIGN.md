# Halfway — visual system

## 1. The idea the visuals come from

Halfway is about two halves that stay closed until both exist. The visual
language is built from the physical version of that: **paper, a seam, and a
seal.** Not as nostalgia or skeuomorphism — there are no paper textures, torn
edges or wax drips — but as three structural ideas:

- **The seam.** Every exchange is divided by a hairline into your half and
  theirs. On a wide screen the seam is vertical (halves side by side); on a
  phone it is horizontal (halves stacked). Same idea, rotated.
- **The seal.** A small circle that sits on the seam and *is* the state of the
  exchange. It is made of two half‑discs: the start half is yours, the end half
  is theirs. A half that is written is filled; a half that is not yet written
  is an outline. When both are filled the seal is whole — ready to open. When
  you open it, the halves part along the seam and the text appears. The same
  glyph, at small size, shows the state of every conversation in the list, and
  the whole seal is the logo.
- **Redaction.** Text that exists but is not yet yours to read is drawn as ink
  bars, never as blur. The bars are a fixed pattern — they do not reveal how
  long the hidden text is.

Two typefaces carry two kinds of speech: **Newsreader** (a reading serif) for
human voices — questions and answers — and **IBM Plex Sans** for the interface
speaking. The reader always knows whether a person or the product is talking.

## 2. Tokens

Components read **semantic tokens only** (in `src/styles/tokens.css`).
Primitives exist only to feed them.

### Colour

One neutral ramp (paper/ink, and its night counterpart) and **one accent:
seal vermilion.** Vermilion means *sealed* — a half that has been written and
not yet opened, or the act of sealing. It means nothing else. There is
deliberately no green "success" and no red "danger" (see anti‑patterns).

| Semantic token | Light | Dark | Meaning |
|---|---|---|---|
| `--color-page` | `#F4EFE5` | `#15161B` | The page itself |
| `--color-surface` | `#FBF8F1` | `#1E2026` | Paper lifted off the page: composer, sheets |
| `--color-text` | `#1B1D24` | `#ECE5D6` | Primary text (14.7:1 / 14.4:1) |
| `--color-text-secondary` | `#4A4C55` | `#B7B0A2` | Supporting text (7.5:1 / 8.4:1) |
| `--color-text-tertiary` | `#6B6A68` | `#8E897F` | Meta: city, time (4.7:1 / 5.2:1) |
| `--color-rule` | ink 16% | cream 16% | Hairlines and the seam |
| `--color-redaction` | ink 14% | cream 14% | Sealed text bars |
| `--color-seal` | `#B3361F` | `#E2583C` | Sealed / the act of sealing (5.3:1 / 4.9:1) |
| `--color-on-seal` | `#FFFFFF` | `#15161B` | Text on a seal‑filled control (6.1:1 / 4.9:1) |
| `--color-focus` | ink | cream | Focus ring |

### Type roles

| Role | Family | Size / line | Weight | Use |
|---|---|---|---|---|
| display | Newsreader | 32/38 (phone) · 44/52 (≥720px) | 400 | The question of the day |
| title | Newsreader | 24/30 | 400 | Exchange questions, screen titles |
| voice | Newsreader | 18/28 | 400 | A person's half |
| body | Plex Sans | 16/24 | 400 | Interface text |
| label | Plex Sans | 14/20 | 500 | Buttons, tabs, row titles |
| stamp | Plex Sans | 12/16, +0.08em, uppercase | 500 | Dates, chapter marks, meta |

### Scales

- Spacing (4pt): 4, 8, 12, 16, 20, 24, 32, 40, 48, 64.
- Radius: `sm` 4 (controls), `md` 8 (fields, rows), `lg` 16 (sheets), `full`
  (the seal only — circularity is reserved for it).
- Elevation: `1` the composer resting above the page, `2` sheets and toasts.
- Motion: `--dur-quick` 160ms (feedback), `--dur-move` 240ms (navigation,
  sheets), `--dur-open` 520ms (the opening — the one moment allowed to take
  its time). All motion collapses to opacity under reduced motion.

## 3. Components

| Component | Variants | Not for |
|---|---|---|
| **Seal** | `state`: empty · mine · theirs · whole · open; sizes 16 / 28 / 56 | Decoration. It is always a state. |
| **Button** | `primary` (ink fill), `seal` (vermilion fill — only for sealing a half and opening), `quiet` (text) | Two primaries in one view. |
| **Half** | mine · theirs; states: unwritten, sealed (redacted), open | Anything not written by a person. |
| **Exchange** | picking, writing, waiting, ready, open | — |
| **Commons row** | sealed (redacted), open, leaned, mutual | — |
| **Conversation row** | by exchange state; resting | — |
| **Sheet** | confirm, closing line | Information that needs no decision. |
| **Toast** | single line, auto‑dismiss, polite live region | Errors that need action. |

Every interactive component defines default, hover (pointer devices only),
pressed, focus‑visible and disabled states. Touch targets are ≥ 44px.

### Corrections made after inspecting the rendered app

- **The whole seal kept reading as a red dot.** Filled halves had an outline
  that bridged the gap between them. Filled halves now have no outline, and
  the halves never fully close: a hairline seam always shows it is two halves
  joined.
- **The rail repeated the logo** that the top bar already carries; the rail
  now holds only the three destinations.

### Added in version two

- **Thread.** Replies hang under the round they answer, tied to it by a
  hairline on the start edge. They use the voice face at body size — people
  speaking, but quieter than a half. A quoted line from the other person's half
  sits above a reply in italic, with a rule.
- **Line picker.** To reply to one line, each sentence of their half becomes a
  dashed target; choosing one turns it into the quote.
- **Door.** A row with the seal, a title, what opening it means, and a Knock
  button outlined in vermilion (knocking is a sealed act). Your knock fills your
  half of the seal. **Their half of a door's seal is never drawn filled** —
  their knock is invisible until the door opens; that is the rule, made visual.
  An opened door is shown in the story as an outcome with the *open* glyph, not
  the whole one: vermilion means sealed, and an opened door is no longer sealed.
- **Between rounds.** Before you've replied, "Reply to their half" leads and
  "Next question" follows; once you've replied, the next question leads. The
  interface asks for one thing at a time.

## 4. Layout

- **Phone (< 720px):** top bar for orientation, content column with 16px
  gutters, bottom navigation with three destinations (Today, Conversations,
  You), primary actions at the bottom of the thumb zone. Safe areas respected.
- **Tablet (720–1079px):** a navigation rail on the start edge replaces the
  bottom bar; the content column grows to 640px.
- **Desktop (≥ 1080px):** rail, and Conversations becomes two panes — the list
  and the open conversation side by side. In exchanges the seam turns
  vertical: your half on the start side, theirs on the end side.

All layout uses logical properties, so a right‑to‑left locale is one `dir`
attribute away.

## 5. Anti‑patterns (deliberately not allowed)

- **Gradients, glows, glass, blobs.** The page is paper; depth comes from
  hierarchy and the one lifted surface.
- **Blur for hidden text.** Hidden text is redacted with a fixed bar pattern.
- **Circles that are not the seal.** No pill buttons, no round avatars —
  roundness belongs to the seal, so the seal stays legible.
- **A second accent, or red for danger.** Vermilion means sealed. Destructive
  actions are marked by words, placement and a confirmation sheet.
- **Green for success.** Success is a sentence, not a colour.
- **Counts about people.** No likes, followers, streaks, read receipts.
- **Cards for everything.** Commons answers and conversations are rows divided
  by hairlines. The composer is the one surface allowed to lift off the page.
- **Meaning by colour alone.** The seal's states differ by fill versus
  outline, and every state also has words.
