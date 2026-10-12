import { describe, expect, it } from 'vitest';
import { DAILY_QUESTIONS, DEPTHS } from './questions';
import { continuationFor } from './continuations';
import { personById } from './people';
import {
  LEANS_PER_DAY,
  RuleError,
  advance,
  block,
  commonsFor,
  createWorld,
  displayName,
  doorAvailable,
  hasUnseenReply,
  hurry,
  isOpen,
  keptConversations,
  knock,
  lean,
  leansLeft,
  letRest,
  markSeen,
  nameInSentence,
  nextQuestion,
  openRound,
  phaseOf,
  pickQuestion,
  reply,
  sealDailyHalf,
  sealRoundHalf,
  sharedDepth,
  skipToTomorrow,
  today,
  todayIndex,
  unknock,
  unlean,
  visibleConversations,
  worldNow,
  type World,
} from './world';

// A fixed moment (local noon) so day arithmetic never straddles midnight.
const T0 = new Date(2026, 9, 12, 12, 0, 0).getTime();
const LONG = 'A half long enough to count, written with some care for whoever reads it.';

/** A world where the visitor has sealed today's half and met `personId`. */
function metWorld(personId = 'mira'): { w: World; id: string } {
  let w = createWorld(T0, 42);
  w = sealDailyHalf(w, T0, LONG);
  w = lean(w, T0, personId);
  w = hurry(w, T0);
  const c = w.conversations[0]!;
  return { w, id: c.id };
}

function conv(w: World, id: string) {
  return w.conversations.find((c) => c.id === id)!;
}

/** Plays one round to the opened state from wherever the conversation is. */
function playRound(w: World, id: string, now = T0): World {
  w = hurry(w, now);
  if (phaseOf(conv(w, id)).kind === 'between') w = nextQuestion(w, now, id);
  w = hurry(w, now);
  const phase = phaseOf(conv(w, id));
  if (phase.kind === 'pick') w = pickQuestion(w, now, id, phase.offer.questionIds[0]!);
  w = hurry(w, now);
  if (phaseOf(conv(w, id)).kind === 'write') w = sealRoundHalf(w, now, id, LONG);
  w = hurry(w, now);
  return openRound(w, now, id);
}

function rounds(w: World, id: string, n: number): World {
  for (let i = 0; i < n; i++) w = playRound(w, id);
  return w;
}

/** Replies under the latest opened round. */
function replyToLatest(w: World, id: string, text = 'Tell me more about that?'): World {
  const last = conv(w, id).rounds.filter((r) => r.openedAt !== undefined).at(-1)!;
  return reply(w, T0, id, last.id, text);
}

describe('the daily question', () => {
  it('is the same question for the whole day and changes at local midnight', () => {
    const w = createWorld(T0, 1);
    expect(today(w, T0).questionId).toBe(DAILY_QUESTIONS[0]!.id);
    const tomorrow = skipToTomorrow(w, T0);
    const now = worldNow(tomorrow, T0);
    expect(todayIndex(tomorrow, now)).toBe(1);
    expect(today(tomorrow, now).questionId).toBe(DAILY_QUESTIONS[1]!.id);
  });

  it('refuses a half that is too short to mean anything', () => {
    const w = createWorld(T0, 1);
    expect(() => sealDailyHalf(w, T0, '   ok   ')).toThrow(RuleError);
  });

  it('cannot be sealed twice — a sealed half is final', () => {
    const w = sealDailyHalf(createWorld(T0, 1), T0, LONG);
    expect(() => sealDailyHalf(w, T0, LONG)).toThrow(/already sealed/);
  });

  it('shows every unblocked person in the commons, shuffled per day', () => {
    const w = createWorld(T0, 7);
    const day0 = commonsFor(w, 0).map((e) => e.personId);
    const day1 = commonsFor(w, 1).map((e) => e.personId);
    expect(day0).toHaveLength(8);
    expect(new Set(day0)).toEqual(new Set(day1));
    expect(day0).not.toEqual(day1);
    expect(commonsFor(block(w, T0, 'hiro'), 0).map((e) => e.personId)).not.toContain('hiro');
  });

  it('does not mutate the world it was given', () => {
    const w = createWorld(T0, 1);
    const snapshot = JSON.stringify(w);
    sealDailyHalf(w, T0, LONG);
    expect(JSON.stringify(w)).toBe(snapshot);
  });
});

describe('leaning in', () => {
  it('is impossible before sealing your own half — nobody reads first', () => {
    expect(() => lean(createWorld(T0, 1), T0, 'mira')).toThrow(/Seal your own half/);
  });

  it('is limited to three a day, and renews the next day', () => {
    let w = sealDailyHalf(createWorld(T0, 1), T0, LONG);
    for (const id of ['mira', 'hiro', 'priya']) w = lean(w, T0, id);
    expect(leansLeft(today(w, T0))).toBe(0);
    expect(() => lean(w, T0, 'farid')).toThrow(/No leans left/);
    expect(LEANS_PER_DAY).toBe(3);

    const next = skipToTomorrow(w, T0);
    expect(leansLeft(today(next, worldNow(next, T0)))).toBe(3);
  });

  it('becomes a conversation only after the other side leans back, after a delay', () => {
    let w = sealDailyHalf(createWorld(T0, 1), T0, LONG);
    w = lean(w, T0, 'mira');
    expect(w.conversations).toHaveLength(0);
    w = advance(w, T0 + 60_000);
    expect(w.conversations).toHaveLength(1);
    expect(w.notices.at(-1)).toMatchObject({ kind: 'mutual', personId: 'mira' });
  });

  it('always returns the very first lean in the demo, so a newcomer reaches a conversation', () => {
    for (let seed = 0; seed < 20; seed++) {
      let w = sealDailyHalf(createWorld(T0, seed), T0, 'Short but valid.');
      w = hurry(lean(w, T0, 'tomasz'), T0);
      expect(w.conversations).toHaveLength(1);
    }
  });

  it('can be undone until it is returned, and an undone lean never becomes a conversation', () => {
    let w = sealDailyHalf(createWorld(T0, 1), T0, LONG);
    w = lean(w, T0, 'mira');
    w = unlean(w, T0, 'mira');
    expect(today(w, T0).leans).toEqual([]);
    expect(hurry(w, T0).conversations).toHaveLength(0);
  });

  it('cannot target someone you have already met, even on a later day', () => {
    const { w } = metWorld('mira');
    let next = skipToTomorrow(w, T0);
    const now = worldNow(next, T0);
    next = sealDailyHalf(next, now, LONG);
    expect(() => lean(next, now, 'mira')).toThrow(/already met/);
  });
});

describe('a round', () => {
  it('opens the conversation on the visitor’s turn, choosing between two light questions', () => {
    const { w, id } = metWorld();
    const phase = phaseOf(conv(w, id));
    expect(phase.kind).toBe('pick');
    if (phase.kind !== 'pick') return;
    const light = DEPTHS[0]!.questions.map((q) => q.id);
    expect(phase.offer.questionIds).toHaveLength(2);
    expect(phase.offer.questionIds.every((q) => light.includes(q))).toBe(true);
  });

  it('keeps their half sealed until both are written, then waits for the visitor to open', () => {
    const met = metWorld();
    let w = met.w;
    const id = met.id;
    const phase = phaseOf(conv(w, id));
    if (phase.kind !== 'pick') throw new Error('expected pick');
    w = hurry(pickQuestion(w, T0, id, phase.offer.questionIds[0]!), T0);
    // Their half arrived first: still the visitor's move, still unreadable.
    expect(conv(w, id).rounds[0]!.theirs).toBeDefined();
    expect(phaseOf(conv(w, id)).kind).toBe('write');
    w = sealRoundHalf(w, T0, id, LONG);
    expect(phaseOf(conv(w, id)).kind).toBe('ready');
    w = openRound(w, T0, id);
    expect(conv(w, id).rounds[0]!.openedAt).toBe(T0);
  });

  it('waits for their half when the visitor writes first', () => {
    const met = metWorld();
    let w = met.w;
    const id = met.id;
    const phase = phaseOf(conv(w, id));
    if (phase.kind !== 'pick') throw new Error('expected pick');
    w = sealRoundHalf(pickQuestion(w, T0, id, phase.offer.questionIds[1]!), T0, id, LONG);
    expect(phaseOf(conv(w, id)).kind).toBe('wait-half');
    expect(() => openRound(w, T0, id)).toThrow(/aren’t in yet/);
  });

  it('pushes nobody on after opening: the next question comes only when asked for', () => {
    const met = metWorld();
    let w = rounds(met.w, met.id, 1);
    w = hurry(w, T0);
    expect(phaseOf(conv(w, met.id)).kind).toBe('between');
    expect(conv(w, met.id).offer).toBeUndefined();
    // The turn to choose alternates: the second question is theirs.
    w = hurry(nextQuestion(w, T0, met.id), T0);
    expect(conv(w, met.id).rounds[1]!.pickedBy).toBe('them');
  });

  it('never repeats a question, and says so when a depth runs out', () => {
    const met = metWorld();
    const w = rounds(met.w, met.id, DEPTHS[0]!.questions.length);
    const ids = conv(w, met.id).rounds.map((r) => r.questionId);
    expect(new Set(ids).size).toBe(ids.length);
    expect(phaseOf(conv(hurry(w, T0), met.id)).kind).toBe('exhausted');
  });
});

describe('threads', () => {
  it('let the visitor reply under an opened round, unsealed, and quote a line of their half', () => {
    const met = metWorld();
    let w = rounds(met.w, met.id, 1);
    const round = conv(w, met.id).rounds[0]!;
    const line = round.theirs!.text.split('. ')[0]!;
    w = reply(w, T0, met.id, round.id, 'What happened next?', line);
    const msg = conv(w, met.id).rounds[0]!.thread[0]!;
    expect(msg).toMatchObject({ by: 'me', text: 'What happened next?', quote: line });
  });

  it('refuse replies under a round that isn’t open, and quotes that aren’t from their half', () => {
    const met = metWorld();
    let w = met.w;
    const phase = phaseOf(conv(w, met.id));
    if (phase.kind !== 'pick') throw new Error('expected pick');
    w = pickQuestion(w, T0, met.id, phase.offer.questionIds[0]!);
    const roundId = conv(w, met.id).rounds[0]!.id;
    expect(() => reply(w, T0, met.id, roundId, 'Hello?')).toThrow(/once both halves are open/);
    expect(() => reply(w, T0, met.id, 'met', 'Hi', 'words they never wrote')).toThrow(/only quote their half/);
  });

  it('get one reply from a simulated person: a continuation of their own answer', () => {
    const met = metWorld('farid');
    let w = rounds(met.w, met.id, 1);
    w = hurry(replyToLatest(w, met.id), T0);
    const round = conv(w, met.id).rounds[0]!;
    expect(round.thread.map((m) => m.by)).toEqual(['me', 'them']);
    expect(round.thread[1]!.text).toBe(continuationFor('farid', round.questionId));
    // They reply once per thread, not to every message.
    w = hurry(replyToLatest(w, met.id, 'And then?'), T0);
    expect(conv(w, met.id).rounds[0]!.thread.filter((m) => m.by === 'them')).toHaveLength(1);
  });

  it('work under the question where you met, too', () => {
    const met = metWorld('lucia');
    const w = hurry(reply(met.w, T0, met.id, 'met', 'Did you ever find out why?'), T0);
    expect(conv(w, met.id).met.thread.at(-1)!.text).toBe(continuationFor('lucia', conv(w, met.id).met.questionId));
  });

  it('mark their replies as new until the visitor looks', () => {
    const met = metWorld();
    let w = hurry(reply(met.w, T0, met.id, 'met', 'Tell me more?'), T0 + 1);
    expect(hasUnseenReply(conv(w, met.id))).toBe(true);
    w = markSeen(w, T0 + 60_000, met.id);
    expect(hasUnseenReply(conv(w, met.id))).toBe(false);
  });
});

describe('doors', () => {
  it('appear only when they make sense', () => {
    const met = metWorld();
    expect(doorAvailable(conv(met.w, met.id), 'names')).toBe(false);
    const w = rounds(met.w, met.id, 1);
    expect(doorAvailable(conv(w, met.id), 'names')).toBe(true);
    expect(doorAvailable(conv(w, met.id), 'closer')).toBe(false);
    expect(doorAvailable(conv(w, met.id), 'deep')).toBe(false);
    expect(() => knock(w, T0, met.id, 'deep')).toThrow(/isn’t here yet/);
  });

  it('open only when both have knocked, and reveal a first name only then', () => {
    const met = metWorld();
    let w = rounds(met.w, met.id, 1);
    w = knock(w, T0, met.id, 'names', 'Sam');
    // Before their knock arrives, nothing is revealed.
    expect(isOpen(conv(w, met.id), 'names')).toBe(false);
    expect(displayName(conv(w, met.id))).toBe('Someone in Lisbon');
    w = hurry(w, T0);
    expect(isOpen(conv(w, met.id), 'names')).toBe(true);
    expect(displayName(conv(w, met.id))).toBe('Mira');
    expect(w.me.name).toBe('Sam');
    expect(w.notices.at(-1)).toMatchObject({ kind: 'door', door: 'names' });
  });

  it('never open on one side’s knock alone, and a knock can be taken back before it opens', () => {
    // Hiro is a round slower to share names: after one round he hasn't knocked.
    const met = metWorld('hiro');
    let w = rounds(met.w, met.id, 1);
    w = hurry(knock(w, T0, met.id, 'names', 'Sam'), T0);
    expect(isOpen(conv(w, met.id), 'names')).toBe(false);
    w = unknock(w, T0, met.id, 'names');
    expect(conv(w, met.id).doors.names?.mine).toBeUndefined();
    // His knock arrives later; with the visitor's knock withdrawn, it stays shut.
    w = hurry(rounds(w, met.id, 1), T0);
    expect(isOpen(conv(w, met.id), 'names')).toBe(false);
  });

  it('need something to share before knocking on a sharing door', () => {
    const met = metWorld();
    const w = rounds(met.w, met.id, 1);
    expect(() => knock(w, T0, met.id, 'names', '   ')).toThrow(RuleError);
  });

  it('lead deeper only after the visitor has replied to them — depth follows responsiveness', () => {
    const met = metWorld('nkechi');
    let w = rounds(met.w, met.id, 2);
    w = hurry(knock(w, T0, met.id, 'closer'), T0);
    expect(isOpen(conv(w, met.id), 'closer')).toBe(false);
    w = hurry(replyToLatest(w, met.id), T0);
    expect(isOpen(conv(w, met.id), 'closer')).toBe(true);
    expect(sharedDepth(conv(w, met.id))).toBe(1);
    // The next questions offered reach Closer.
    w = hurry(nextQuestion(w, T0, met.id), T0);
    const phase = phaseOf(conv(w, met.id));
    if (phase.kind !== 'pick') throw new Error('expected the visitor to choose the third question');
    const closer = DEPTHS[1]!.questions.map((q) => q.id);
    expect(phase.offer.questionIds.every((q) => closer.includes(q))).toBe(true);
  });

  it('let two people keep each other, and the conversation carries on', () => {
    const met = metWorld('tomasz');
    let w = rounds(met.w, met.id, 4);
    w = replyToLatest(w, met.id);
    w = hurry(knock(w, T0, met.id, 'keep'), T0);
    expect(isOpen(conv(w, met.id), 'keep')).toBe(true);
    expect(keptConversations(w).map((c) => c.personId)).toEqual(['tomasz']);
    expect(phaseOf(conv(w, met.id)).kind).toBe('between');
  });
});

describe('endings', () => {
  it('names an unnamed person in lower case mid-sentence', () => {
    const met = metWorld('hiro');
    expect(nameInSentence(conv(met.w, met.id))).toBe('someone in Osaka');
  });

  it('let a conversation rest at any time with a closing line, which stops their pending replies', () => {
    const met = metWorld();
    let w = met.w;
    const phase = phaseOf(conv(w, met.id));
    if (phase.kind !== 'pick') throw new Error('expected pick');
    w = pickQuestion(w, T0, met.id, phase.offer.questionIds[0]!);
    w = letRest(w, T0, met.id, '  Thank you for this.  ');
    expect(conv(w, met.id).rest).toMatchObject({ closingLine: 'Thank you for this.' });
    expect(w.pending.filter((e) => 'conversationId' in e && e.conversationId === met.id)).toHaveLength(0);
    expect(() => letRest(w, T0, met.id, '')).toThrow(/at rest/);
    expect(() => reply(w, T0, met.id, 'met', 'hi')).toThrow(/at rest/);
  });

  it('make a blocked person disappear for good', () => {
    const met = metWorld('nkechi');
    const blocked = block(met.w, T0, 'nkechi');
    expect(visibleConversations(blocked)).toHaveLength(0);
    expect(conv(blocked, met.id).status).toBe('resting');
    expect(blocked.blocked).toContain('nkechi');
  });

  it('replay identically from the same seed, so a reload never changes what happened', () => {
    const run = () => {
      const met = metWorld();
      let w = rounds(met.w, met.id, 2);
      w = hurry(replyToLatest(w, met.id), T0);
      return JSON.stringify(w);
    };
    expect(run()).toBe(run());
  });

  it('use each simulated person’s own words for every half', () => {
    const met = metWorld('sigrun');
    const w = rounds(met.w, met.id, 3);
    for (const r of conv(w, met.id).rounds) expect(r.theirs!.text).toBe(personById('sigrun').answers[r.questionId]);
  });
});

describe('content', () => {
  it('gives every simulated person an answer and a continuation for every question', () => {
    const ids = [...DAILY_QUESTIONS, ...DEPTHS.flatMap((d) => d.questions)].map((q) => q.id);
    for (const p of ['mira', 'tomasz', 'nkechi', 'hiro', 'lucia', 'farid', 'priya', 'sigrun']) {
      for (const q of ids) {
        expect(personById(p).answers[q], `${p} answer ${q}`).toBeTruthy();
        expect(continuationFor(p, q), `${p} continuation ${q}`).toBeTruthy();
      }
    }
  });
});
