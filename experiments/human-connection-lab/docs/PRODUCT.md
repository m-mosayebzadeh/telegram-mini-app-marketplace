# Halfway — product definition

> **Version two changed how a conversation works.** Fixed chapters, chapter-end
> decisions, the "complete after nine" ending and the email exchange were
> replaced by rounds, threads and doors. Sections 2–4 below describe version
> one; [ITERATION-2.md](ITERATION-2.md) describes what replaced them and why,
> and takes precedence wherever the two disagree.

**Nobody goes first.**

Halfway is a place to meet strangers and slowly become people who know each
other. Every step is made of two sealed halves: you write yours without seeing
theirs, they write theirs without seeing yours, and both open at the same
moment. Nobody is ever exposed alone — not when answering, not when asking for
more, not when sharing a name, not when it ends.

Why this concept was chosen over six others is in [DISCOVERY.md](DISCOVERY.md).

## 1. The one rule

> Everything that makes someone vulnerable happens in sealed pairs.

| Moment | How the rule applies |
|---|---|
| Discovery | One question a day, the same for everyone. You read other people's answers only after sealing your own. |
| Reaching out | You "lean in" toward answers that speak to you. A conversation opens only if the other person leaned toward yours too. A one‑sided lean is never shown to anyone. |
| Talking | Every exchange is a question and two sealed halves. Neither of you sees the other's half until both are written. |
| Becoming known | There is no profile. At the end of a chapter each of you may choose to share something — a first name, what you do, a way to stay in touch. It is revealed only if both chose to share it. |
| Continuing or ending | At the end of each chapter each of you privately chooses "keep going" or "let it rest". Nobody is told "they said no"; the conversation simply comes to rest. Either person can also let it rest at any time with a kind closing line, so nothing ends in silence. |

## 2. Structure of a conversation

- **Where you met** — the question of the day you both answered. Already open.
- **Three chapters**, each of three exchanges, each a step deeper:
  *Light* (small, story‑shaped questions), *Closer* (texture of a life),
  *Deep* (what matters, what is hard).
- **Turns.** The person whose turn it is chooses the next question from two
  offered. Turns alternate, so both shape the conversation.
- **Chapter end.** A sealed decision: keep going or let it rest, plus an
  optional thing to share. After the third chapter the conversation is complete
  — "you met halfway nine times" — and stays as a record you can reread.

Bounded on purpose: you never commit to more than three exchanges at a time,
and every chapter has a natural, dignified exit.

## 3. Main journey (first visit)

1. Open Halfway. No sign‑up, no profile. The first thing on screen is today's
   question and a place to write.
2. Below, today's halves from other people are visible only as sealed lines,
   with how many people have written — the reason to write is right there.
3. Seal your half. The sealed lines open: other people's answers, each with
   only a city and a time.
4. Lean in toward up to three answers that speak to you.
5. If someone you leaned toward also leaned toward you, a conversation opens:
   "You and someone in Lisbon both leaned in."
6. In the conversation, choose the first question, write your half, wait for
   theirs (a sealed half appears when it arrives), then open both together.
7. At the end of the first chapter, decide privately whether to keep going and
   whether to share your first name.

## 4. What exists in this version

Real and working in the browser: the daily question and commons, the sealed
writing of halves, leaning in with the three‑per‑day limit and its undo, mutual
leaning creating a conversation, turn‑taking with question choice, sealed
exchanges with a joint opening, three chapters with sealed decisions and sealed
reveals, letting a conversation rest at any time with a closing line, blocking,
an archive of your own daily halves, persistence in the browser, and day
rollover.

**Simulated, and said so in the product:** the other people. Eight invented
people with written voices live in this browser. They answer questions from
pre‑written material, decide whether to lean back using a simple rule, and
reply after seconds rather than hours (time is compressed so the demo can be
explored in one sitting). **They do not read what you write.** There is no
server; nothing leaves the browser.

Demo controls (under "You"): hurry the others (deliver every pending reply
now), skip to tomorrow (new question, leans renewed), and reset the world.

## 5. Decisions

1. **No sign‑up before value.** The first action is answering a question.
   Identity is asked for only at the moment someone chooses to share it, and
   only the piece being shared.
2. **No profile, ever.** What one person knows about you is exactly what you
   chose to share with that person.
3. **Three leans per day.** Scarcity keeps intention. Undo is allowed until the
   lean is returned.
4. **A sealed half cannot be edited.** Sealing is a commitment; otherwise
   "sealed" means nothing. The composer makes this clear before sealing.
5. **Minimum length of 12 characters** for a half, so "ok" cannot close an
   exchange the other person answered with care.
6. **Opening is a deliberate act.** When both halves are in, you tap to open
   them. It is the product's signature moment and it should be yours to trigger.
7. **No counters about people.** No likes, followers, streaks, read receipts or
   typing indicators.
8. **City, not more, on a stranger's answer.** Enough to feel the world is
   wide, not enough to identify anyone.
9. **Blocking** ends the conversation for good and removes that person from
   future commons. It never notifies them.
10. **Global by default.** English interface, people from many places, no
    assumption about where the user lives.
11. **In the demo, the first lean of the very first day is always returned**,
    so a new visitor reaches a conversation. Later leans are returned by the
    simple rule (more often when your half is longer — care invites care).
    This is a demo affordance and is documented in the app.

12. **Stacked on a phone, their half comes first and yours last.** Found in
    browser inspection: with yours on top, the composer and its seal button sat
    mid-screen. Now whatever you still have to write ends the exchange, at the
    bottom under the thumb. Side by side on wide screens, yours takes the start
    side.
13. **Opening a conversation jumps to where you are; later steps glide.**
    Found in inspection: a smooth scroll through nine exchanges was a wait,
    not a transition.
14. **"Someone in Lisbon" is written "someone in Lisbon" mid-sentence**, and
    once what someone does is shared it replaces the city in the header (the
    description already says where they are).

## 6. Rejected

- Typing indicators, read receipts, streaks — pressure and guilt, not
  connection.
- Showing the length of a sealed half — leaks effort before opening.
- Photos at first contact — meet how someone thinks before how they look.
- Free‑form questions in this version — simulated people cannot answer
  arbitrary questions honestly. In a real product, writing your own question is
  the obvious next step (see open questions).
- A "danger red" for blocking — red already means *sealed*. Destructive actions
  are marked by wording, position and a confirmation instead.

## 7. Open questions

1. **Voice halves.** Text excludes people who speak better than they write.
2. **Write your own question** once both sides are real people.
3. **After the third chapter.** Should a complete conversation offer a
   "free chapter" with questions both write?
4. **Groups.** Could a commons answer open a table of three or four?
5. **Safety at scale.** Reporting, moderation of commons answers, age gating —
   none of which can be meaningfully built without a server.
6. **Cadence.** Real replies take hours. How should waiting feel over a day
   rather than seconds? (Notifications, a quiet daily digest.)
