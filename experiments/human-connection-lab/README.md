# Halfway — nobody goes first

An experiment in how strangers on the web could meet and slowly become people
who know each other. Every step is made of two sealed halves: you write yours
without seeing theirs, they write theirs without seeing yours, and both open at
the same moment. Discovery, conversation, becoming known and ending all follow
that one rule.

- Why this concept, and the six it beat: [docs/DISCOVERY.md](docs/DISCOVERY.md)
- What it is, its rules, decisions and open questions: [docs/PRODUCT.md](docs/PRODUCT.md)
- **Version two — rounds, threads and doors, and why:** [docs/ITERATION-2.md](docs/ITERATION-2.md)
- The visual system: [docs/DESIGN.md](docs/DESIGN.md)

In a conversation, each new question is answered in two sealed halves that open
together (a **round**). Once open, either person can reply under it, even to a
single line (a **thread**). Every threshold — going deeper, sharing first names,
saying what you do, keeping each other — is a **door** that opens only when both
have knocked; a knock nobody answers is never shown. People you keep appear
under **Your people** on Today, their answer to each daily question waiting
behind yours.

## Running it

Requires Node 20+ (developed on Node 24).

```sh
cd experiments/human-connection-lab
npm install
npm run dev          # http://localhost:5173
```

| Command | What it does |
|---|---|
| `npm run check` | Typecheck, lint and all unit + interface tests |
| `npm test` | Tests only (Vitest + Testing Library, jsdom) |
| `npm run build` | Typecheck, then a production build in `dist/` |
| `npm run preview -- --port 4317` | Serve the production build |
| `npm run drive` | Walk the whole journey in a real browser and screenshot it (see below) |

### The browser driver

`scripts/drive.mjs` uses the Chrome or Edge already installed on the machine
(via `playwright-core`, which downloads no browser; set `CHROME_PATH` to point
elsewhere). With the preview running on port 4317:

```sh
npm run build && npm run preview -- --port 4317   # in one terminal
npm run drive                                     # in another
```

It writes a first half, seals it, leans in, opens the conversation, plays a
round, replies to a single line of their half, knocks on doors (first names, go
deeper, keep meeting here) and keeps talking until each opens, checks that new
questions reach the new depth, skips to the next day to find the kept person on
Today, reloads to check persistence, and checks for horizontal scrolling at phone (390px), tablet (820px) and desktop
(1440px) widths, in light and dark. Screenshots land in `screenshots/`
(ignored by git). It exits non-zero on any failed check or console error.

## What is real and what is simulated

Real: every rule and screen. The other people are **simulated** — eight
invented characters with pre-written answers who live in the browser, reply in
seconds rather than hours, and cannot read what you write. When you reply under
their half they answer once, with a pre-written continuation of their own
answer; they knock on doors by simple rules that reward replying to them. There is no server;
the world is stored in `localStorage` only. The app says all of this under
"Demo world". Demo controls under **You**: hurry the others, skip to tomorrow,
reset.

## Layout of the code

```
src/
  domain/      every rule, as pure functions over plain data (no React, no clock)
    world.ts     sealing, leaning, rounds, threads, doors, the simulated people
    questions.ts the daily questions, the three depths, the doors
    people.ts    the eight simulated people and their answers
    continuations.ts  what each says when you reply under their half
    storage.ts   localStorage with honest failure
  state/       the world in React (clock, persistence) and a hash router
  screens/     Today, Conversations, a conversation, You, How it works
  ui/          the seal, redaction, composer, sheet, navigation, notices
  styles/      tokens.css (the only place raw values live), base.css, app.css
scripts/drive.mjs  the real-browser journey
```

The simulated people's replies are scheduled as timestamped events inside the
world rather than as timers, so they survive a reload and every rule can be
tested exactly with a seeded random stream.
