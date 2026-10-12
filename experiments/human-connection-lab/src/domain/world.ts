/**
 * The world: every rule of Halfway, as pure functions over plain data.
 *
 * The one rule the whole product follows — *nobody goes first* — lives here,
 * applied to thresholds rather than to every word:
 *
 * - the first answer to any question is a sealed half, opened only when both
 *   exist (a round);
 * - once a round is open, both have disclosed at that depth, so replying under
 *   it is free (a thread) — this is the responsiveness that turns disclosure
 *   into closeness;
 * - every further threshold — going deeper, sharing a name, keeping each other
 *   — is a door that opens only when both have knocked, and a knock nobody
 *   answers is never shown to anyone;
 * - a lean becomes a conversation only when it is mutual.
 *
 * Every function takes the current world and the current (virtual) time and
 * returns a new world. Nothing here reads the real clock, touches storage or
 * knows about React, so every rule can be tested exactly and the simulated
 * people's scheduled replies survive a page reload.
 */

import { continuationFor } from './continuations';
import { personById, PEOPLE } from './people';
import { DEPTHS, DOORS, DOOR_ORDER, dailyQuestionFor, type DepthIndex, type DoorId, type RevealKind } from './questions';
import { nextRandom, seededShuffle } from './rng';
import { dayIndexBetween, nextLocalMidnight } from './time';

// ─── Rules expressed as numbers ──────────────────────────────────────────────

/** Short enough to never feel like homework, long enough that "ok" can't close an exchange. */
export const MIN_HALF_LENGTH = 12;
export const MAX_HALF_LENGTH = 1200;
/** A reply under a round can be short — "me too" is a real response. */
export const MAX_REPLY_LENGTH = 600;
/** Leans per day. Scarcity keeps each one intentional. */
export const LEANS_PER_DAY = 3;

/**
 * How long the simulated people take, in milliseconds. A real person would
 * take hours; the demo compresses time so the whole arc can be felt in one
 * sitting. The app says so on screen.
 */
export const DELAYS = {
  leanBack: [3_000, 12_000],
  half: [6_000, 24_000],
  pick: [2_500, 6_000],
  reply: [4_000, 12_000],
  knock: [3_000, 10_000],
} as const satisfies Record<string, readonly [number, number]>;

// ─── Data ────────────────────────────────────────────────────────────────────

export type Side = 'me' | 'them';

export interface Half {
  text: string;
  sealedAt: number;
}

/** A reply under an opened round. Not sealed: both have already disclosed at this depth. */
export interface Reply {
  id: string;
  by: Side;
  text: string;
  at: number;
  /** A line from the other person's half that this reply responds to. */
  quote?: string;
}

/** One question, two sealed halves, then a thread of replies once opened. */
export interface Round {
  id: string;
  depth: DepthIndex;
  questionId: string;
  pickedBy: Side;
  mine?: Half;
  theirs?: Half;
  /** Set when the visitor opens both halves together. */
  openedAt?: number;
  thread: Reply[];
}

export interface Offer {
  questionIds: string[];
  picker: Side;
}

/** A door's state. Knock times are private; only `openedAt` is ever shown to both. */
export interface DoorState {
  mine?: number;
  theirs?: number;
  openedAt?: number;
}

export interface Conversation {
  id: string;
  personId: string;
  startedAt: number;
  /** The daily question where both leaned in. Already open; it has a thread like any round. */
  met: { dayIndex: number; questionId: string; mine: string; theirs: string; thread: Reply[] };
  rounds: Round[];
  offer?: Offer;
  doors: Partial<Record<DoorId, DoorState>>;
  status: 'active' | 'resting';
  rest?: { at: number; closingLine?: string };
  blocked?: boolean;
  lastActivityAt: number;
  /** When the visitor last looked at this conversation — for "replied to you". */
  seenAt: number;
}

export interface DayState {
  dayIndex: number;
  questionId: string;
  mine?: Half;
  /** People whose answers the visitor leaned toward today. Private; never shown to them. */
  leans: string[];
}

/** Which thread a reply belongs to: a round, or the daily question where they met. */
export type ThreadRef = string | 'met';

export type SimEvent =
  | { id: string; dueAt: number; kind: 'lean-back'; personId: string; dayIndex: number }
  | { id: string; dueAt: number; kind: 'their-half'; conversationId: string; roundId: string }
  | { id: string; dueAt: number; kind: 'their-pick'; conversationId: string }
  | { id: string; dueAt: number; kind: 'their-reply'; conversationId: string; thread: ThreadRef }
  | { id: string; dueAt: number; kind: 'their-knock'; conversationId: string; door: DoorId };

export type Notice =
  | { id: string; kind: 'mutual'; conversationId: string; personId: string }
  | { id: string; kind: 'their-half'; conversationId: string; personId: string; ready: boolean }
  | { id: string; kind: 'their-pick'; conversationId: string; personId: string }
  | { id: string; kind: 'their-reply'; conversationId: string; personId: string }
  | { id: string; kind: 'door'; conversationId: string; personId: string; door: DoorId };

export interface World {
  version: 2;
  /** Seed for the deterministic shuffles (commons order). */
  seed: number;
  /** State of the random stream used for the simulated people's choices. */
  rng: number;
  /** When this world began — day zero of the daily question. */
  startedAt: number;
  /** Demo-only time travel: added to the real clock. */
  clockOffset: number;
  /** What the visitor has typed when knocking on a sharing door. Shown only once a door opens. */
  me: Partial<Record<RevealKind, string>>;
  days: DayState[];
  conversations: Conversation[];
  blocked: string[];
  pending: SimEvent[];
  notices: Notice[];
  /** Demo affordance: the very first lean is always returned so a newcomer reaches a conversation. */
  firstLeanReturned: boolean;
  nextId: number;
}

/** Thrown when an action is attempted in a state that does not allow it. */
export class RuleError extends Error {}

// ─── Creation and time ───────────────────────────────────────────────────────

export function createWorld(now: number, seed: number = (now ^ 0x9e3779b9) >>> 0): World {
  return {
    version: 2,
    seed,
    rng: seed,
    startedAt: now,
    clockOffset: 0,
    me: {},
    days: [],
    conversations: [],
    blocked: [],
    pending: [],
    notices: [],
    firstLeanReturned: false,
    nextId: 1,
  };
}

/** The world's notion of "now": the real clock plus any demo time travel. */
export function worldNow(world: World, realNow: number): number {
  return realNow + world.clockOffset;
}

export function todayIndex(world: World, now: number): number {
  return dayIndexBetween(world.startedAt, now);
}

/** Today's state, or a fresh unsaved one if the visitor hasn't acted today. */
export function today(world: World, now: number): DayState {
  const dayIndex = todayIndex(world, now);
  return (
    world.days.find((d) => d.dayIndex === dayIndex) ?? {
      dayIndex,
      questionId: dailyQuestionFor(dayIndex).id,
      leans: [],
    }
  );
}

// ─── Small internal helpers (operate on a draft copy) ────────────────────────

function draft(world: World): World {
  return structuredClone(world);
}

function newId(w: World, prefix: string): string {
  return `${prefix}${w.nextId++}`;
}

function random(w: World): number {
  const [value, next] = nextRandom(w.rng);
  w.rng = next;
  return value;
}

function delay(w: World, [min, max]: readonly [number, number]): number {
  return Math.round(min + random(w) * (max - min));
}

function ensureDay(w: World, now: number): DayState {
  const existing = w.days.find((d) => d.dayIndex === todayIndex(w, now));
  if (existing) return existing;
  const fresh = today(w, now);
  w.days.push(fresh);
  return fresh;
}

function findConversation(w: World, id: string): Conversation {
  const c = w.conversations.find((x) => x.id === id);
  if (!c) throw new RuleError('That conversation does not exist.');
  return c;
}

function activeConversation(w: World, id: string): Conversation {
  const c = findConversation(w, id);
  if (c.status !== 'active') throw new RuleError('This conversation is at rest.');
  return c;
}

function validHalf(text: string): string {
  const t = text.trim();
  if (t.length < MIN_HALF_LENGTH) throw new RuleError(`A half needs at least ${MIN_HALF_LENGTH} characters.`);
  if (t.length > MAX_HALF_LENGTH) throw new RuleError(`A half can be at most ${MAX_HALF_LENGTH} characters.`);
  return t;
}

function cancelEventsFor(w: World, conversationId: string) {
  w.pending = w.pending.filter((e) => !('conversationId' in e) || e.conversationId !== conversationId);
}

/** Omit that respects each member of a union, so each notice kind keeps its own fields. */
type WithoutId<T> = T extends unknown ? Omit<T, 'id'> : never;

function notify(w: World, notice: WithoutId<Notice>) {
  w.notices.push({ ...notice, id: newId(w, 'n') } as Notice);
}

// ─── Reading a conversation ──────────────────────────────────────────────────

export type Phase =
  | { kind: 'pick'; offer: Offer }
  | { kind: 'wait-pick' }
  | { kind: 'write'; round: Round }
  | { kind: 'wait-half'; round: Round }
  | { kind: 'ready'; round: Round }
  /** Every round is open: talk in the threads, knock on doors, or ask for the next question. */
  | { kind: 'between' }
  /** Every question available at this depth has been asked. */
  | { kind: 'exhausted' }
  | { kind: 'resting' };

export function isOpen(c: Conversation, door: DoorId): boolean {
  return c.doors[door]?.openedAt !== undefined;
}

/** The deepest level both have chosen to reach. Moves only through a door. */
export function sharedDepth(c: Conversation): DepthIndex {
  if (isOpen(c, 'deep')) return 2;
  if (isOpen(c, 'closer')) return 1;
  return 0;
}

export function openedRounds(c: Conversation): Round[] {
  return c.rounds.filter((r) => r.openedAt !== undefined);
}

function openedAt(c: Conversation, depth: DepthIndex): number {
  return openedRounds(c).filter((r) => r.depth === depth).length;
}

/** How many replies the visitor has written — the simulated people respond to responsiveness. */
function myReplies(c: Conversation): number {
  return [...c.met.thread, ...c.rounds.flatMap((r) => r.thread)].filter((m) => m.by === 'me').length;
}

/**
 * Whether a door is there to knock on yet. Doors appear when they make sense,
 * so the conversation still travels from light to deep — but at the pace both
 * choose, never on a timetable.
 */
export function doorAvailable(c: Conversation, door: DoorId): boolean {
  switch (door) {
    case 'names':
      return openedRounds(c).length >= 1;
    case 'closer':
      return openedAt(c, 0) >= 2;
    case 'work':
      return isOpen(c, 'closer');
    case 'deep':
      return isOpen(c, 'closer') && openedAt(c, 1) >= 2;
    case 'keep':
      return openedRounds(c).length >= 3;
  }
}

/** Doors the visitor can see: open ones, and ones available to knock on. */
export function visibleDoors(c: Conversation): DoorId[] {
  return DOOR_ORDER.filter((d) => isOpen(c, d) || doorAvailable(c, d));
}

/** Questions still unasked at or below the shared depth, deepest first. */
export function questionsLeft(c: Conversation): string[] {
  const used = new Set(c.rounds.map((r) => r.questionId));
  const depth = sharedDepth(c);
  return DEPTHS.filter((d) => d.index <= depth)
    .sort((a, b) => b.index - a.index)
    .flatMap((d) => d.questions.filter((q) => !used.has(q.id)).map((q) => q.id));
}

/**
 * Where a conversation stands, derived rather than stored, so there is no
 * second copy of the truth to drift out of step.
 */
export function phaseOf(c: Conversation): Phase {
  if (c.status === 'resting') return { kind: 'resting' };
  const last = c.rounds.at(-1);
  if (last && last.openedAt === undefined) {
    if (!last.mine) return { kind: 'write', round: last };
    if (!last.theirs) return { kind: 'wait-half', round: last };
    return { kind: 'ready', round: last };
  }
  if (c.offer) return c.offer.picker === 'me' ? { kind: 'pick', offer: c.offer } : { kind: 'wait-pick' };
  if (questionsLeft(c).length === 0) return { kind: 'exhausted' };
  return { kind: 'between' };
}

/** True when the conversation can't move until the visitor does something. */
export function needsMe(c: Conversation): boolean {
  const k = phaseOf(c).kind;
  return k === 'pick' || k === 'write' || k === 'ready';
}

/** The latest reply from them the visitor hasn't seen yet, if any. */
export function hasUnseenReply(c: Conversation): boolean {
  return [...c.met.thread, ...c.rounds.flatMap((r) => r.thread)].some((m) => m.by === 'them' && m.at > c.seenAt);
}

/** Conversations the visitor can see, most recently active first. Blocked ones are gone for good. */
export function visibleConversations(world: World): Conversation[] {
  return world.conversations.filter((c) => !c.blocked).sort((a, b) => b.lastActivityAt - a.lastActivityAt);
}

export function conversationWith(world: World, personId: string): Conversation | undefined {
  return world.conversations.find((c) => c.personId === personId);
}

/** People the visitor has chosen to keep, and who chose to keep them. */
export function keptConversations(world: World): Conversation[] {
  return visibleConversations(world).filter((c) => isOpen(c, 'keep'));
}

/** How the visitor refers to the other person: by name only once both shared names. */
export function displayName(c: Conversation): string {
  const p = personById(c.personId);
  return isOpen(c, 'names') ? p.firstName : `Someone in ${p.city}`;
}

/** The same, for the middle of a sentence: "You met someone in Lisbon". */
export function nameInSentence(c: Conversation): string {
  return displayName(c).replace(/^Someone/, 'someone');
}

function threadOf(c: Conversation, ref: ThreadRef): { thread: Reply[]; questionId: string; theirText: string } {
  if (ref === 'met') return { thread: c.met.thread, questionId: c.met.questionId, theirText: c.met.theirs };
  const round = c.rounds.find((r) => r.id === ref);
  if (!round) throw new RuleError('That round does not exist.');
  if (round.openedAt === undefined) throw new RuleError('Replies open once both halves are open.');
  return { thread: round.thread, questionId: round.questionId, theirText: round.theirs?.text ?? '' };
}

// ─── The daily question ──────────────────────────────────────────────────────

export interface CommonsEntry {
  personId: string;
  city: string;
  text: string;
  wroteAt: string;
}

/**
 * Today's halves from other people. The order is shuffled per day so no one
 * is always first, and blocked people never appear.
 */
export function commonsFor(world: World, dayIndex: number): CommonsEntry[] {
  const questionId = dailyQuestionFor(dayIndex).id;
  const people = PEOPLE.filter((p) => !world.blocked.includes(p.id));
  return seededShuffle(people, (world.seed ^ Math.imul(dayIndex + 1, 0x9e3779b1)) >>> 0).map((p) => ({
    personId: p.id,
    city: p.city,
    text: p.answers[questionId] ?? '',
    wroteAt: p.wroteAt[questionId] ?? '',
  }));
}

/** Seal today's half. Until this happens, nobody else's half can be read. */
export function sealDailyHalf(world: World, now: number, text: string): World {
  const w = draft(world);
  const day = ensureDay(w, now);
  if (day.mine) throw new RuleError('Today’s half is already sealed.');
  day.mine = { text: validHalf(text), sealedAt: now };
  return w;
}

export function leansLeft(day: DayState): number {
  return LEANS_PER_DAY - day.leans.length;
}

/**
 * Lean toward someone's answer. It stays private: it only becomes anything if
 * they leaned toward yours too. In the demo that is decided here, by a simple
 * rule, and delivered after a short delay.
 */
export function lean(world: World, now: number, personId: string): World {
  const w = draft(world);
  const day = ensureDay(w, now);
  if (!day.mine) throw new RuleError('Seal your own half before leaning in.');
  if (day.leans.includes(personId)) throw new RuleError('You already leaned in.');
  if (leansLeft(day) <= 0) throw new RuleError('No leans left today.');
  if (w.blocked.includes(personId)) throw new RuleError('That person is blocked.');
  if (conversationWith(w, personId)) throw new RuleError('You have already met.');
  day.leans.push(personId);

  // Care invites care: a longer half is more likely to be leaned toward.
  const length = day.mine.text.length;
  const chance = 0.4 + (length >= 80 ? 0.3 : 0) + (length >= 200 ? 0.1 : 0);
  const returned = !w.firstLeanReturned || random(w) < chance;
  if (returned) {
    w.firstLeanReturned = true;
    w.pending.push({
      id: newId(w, 'e'),
      kind: 'lean-back',
      personId,
      dayIndex: day.dayIndex,
      dueAt: now + delay(w, DELAYS.leanBack),
    });
  }
  return w;
}

/** Take a lean back, as long as it hasn't already become a conversation. */
export function unlean(world: World, now: number, personId: string): World {
  const w = draft(world);
  const day = ensureDay(w, now);
  if (!day.leans.includes(personId)) throw new RuleError('You haven’t leaned in.');
  if (conversationWith(w, personId)) throw new RuleError('It’s already a conversation.');
  day.leans = day.leans.filter((id) => id !== personId);
  w.pending = w.pending.filter((e) => !(e.kind === 'lean-back' && e.personId === personId));
  return w;
}

// ─── Rounds ──────────────────────────────────────────────────────────────────

/**
 * Offer two unasked questions to whoever's turn it is, from the pair's shared
 * depth (lighter unasked ones fill in when that depth runs low). Turns
 * alternate across the whole conversation, so both shape it.
 */
function makeOffer(w: World, c: Conversation, now: number) {
  const left = questionsLeft(c);
  if (left.length === 0) {
    c.offer = undefined;
    return;
  }
  const depth = sharedDepth(c);
  const atDepth = left.filter((id) => DEPTHS[depth]!.questions.some((q) => q.id === id));
  const pool = atDepth.length >= 2 ? atDepth : left;
  const questionIds = seededShuffle(pool, Math.floor(random(w) * 2 ** 32)).slice(0, 2);
  const picker: Side = c.rounds.length % 2 === 0 ? 'me' : 'them';
  c.offer = { questionIds, picker };
  if (picker === 'them' && !w.pending.some((e) => e.kind === 'their-pick' && e.conversationId === c.id)) {
    w.pending.push({ id: newId(w, 'e'), kind: 'their-pick', conversationId: c.id, dueAt: now + delay(w, DELAYS.pick) });
  }
}

function depthOfQuestion(questionId: string): DepthIndex {
  return DEPTHS.find((d) => d.questions.some((q) => q.id === questionId))!.index;
}

function startRound(w: World, c: Conversation, now: number, questionId: string, pickedBy: Side) {
  const round: Round = { id: newId(w, 'r'), depth: depthOfQuestion(questionId), questionId, pickedBy, thread: [] };
  c.rounds.push(round);
  c.offer = undefined;
  c.lastActivityAt = now;
  w.pending.push({
    id: newId(w, 'e'),
    kind: 'their-half',
    conversationId: c.id,
    roundId: round.id,
    dueAt: now + delay(w, DELAYS.half),
  });
}

/** Choose the next question from the two offered, when it is the visitor's turn. */
export function pickQuestion(world: World, now: number, conversationId: string, questionId: string): World {
  const w = draft(world);
  const c = activeConversation(w, conversationId);
  const phase = phaseOf(c);
  if (phase.kind !== 'pick') throw new RuleError('It isn’t your turn to choose.');
  if (!phase.offer.questionIds.includes(questionId)) throw new RuleError('That question wasn’t offered.');
  startRound(w, c, now, questionId, 'me');
  return w;
}

/** Seal the visitor's half of the current round. It cannot be edited afterwards. */
export function sealRoundHalf(world: World, now: number, conversationId: string, text: string): World {
  const w = draft(world);
  const c = activeConversation(w, conversationId);
  if (phaseOf(c).kind !== 'write') throw new RuleError('There is no half to write right now.');
  c.rounds.at(-1)!.mine = { text: validHalf(text), sealedAt: now };
  c.lastActivityAt = now;
  return w;
}

/**
 * Open both halves at once. The visitor triggers it, because opening is the
 * moment the product exists for. Nothing is pushed afterwards: the round's
 * thread is open, and either person asks for the next question when ready.
 */
export function openRound(world: World, now: number, conversationId: string): World {
  const w = draft(world);
  const c = activeConversation(w, conversationId);
  if (phaseOf(c).kind !== 'ready') throw new RuleError('Both halves aren’t in yet.');
  c.rounds.at(-1)!.openedAt = now;
  c.lastActivityAt = now;
  considerTheirKnocks(w, c, now);
  return w;
}

/** Ask for the next question. Whoever's turn it is chooses it. */
export function nextQuestion(world: World, now: number, conversationId: string): World {
  const w = draft(world);
  const c = activeConversation(w, conversationId);
  if (phaseOf(c).kind !== 'between') throw new RuleError('Finish this round first.');
  makeOffer(w, c, now);
  c.lastActivityAt = now;
  return w;
}

// ─── Threads ─────────────────────────────────────────────────────────────────

/**
 * Reply under an opened round (or under the question where you met). Replies
 * are not sealed: both have already disclosed at this depth, so answering is
 * no longer exposing — and responding to what someone said is what turns two
 * answers into a conversation.
 */
export function reply(
  world: World,
  now: number,
  conversationId: string,
  ref: ThreadRef,
  text: string,
  quote?: string,
): World {
  const w = draft(world);
  const c = activeConversation(w, conversationId);
  const t = text.trim();
  if (!t) throw new RuleError('Write something to reply.');
  if (t.length > MAX_REPLY_LENGTH) throw new RuleError(`A reply can be at most ${MAX_REPLY_LENGTH} characters.`);
  const { thread, theirText } = threadOf(c, ref);
  const q = quote?.trim();
  if (q && !theirText.includes(q)) throw new RuleError('You can only quote their half.');
  thread.push({ id: newId(w, 'm'), by: 'me', text: t, at: now, ...(q ? { quote: q } : {}) });
  c.lastActivityAt = now;
  c.seenAt = now;

  // In the demo, they answer once per thread with a continuation of their own answer.
  const alreadyReplied = thread.some((m) => m.by === 'them');
  const scheduled = w.pending.some((e) => e.kind === 'their-reply' && e.conversationId === c.id && e.thread === ref);
  if (!alreadyReplied && !scheduled) {
    w.pending.push({ id: newId(w, 'e'), kind: 'their-reply', conversationId: c.id, thread: ref, dueAt: now + delay(w, DELAYS.reply) });
  }
  considerTheirKnocks(w, c, now);
  return w;
}

/** The visitor has looked at the conversation; replies so far are no longer new. */
export function markSeen(world: World, now: number, conversationId: string): World {
  const c = world.conversations.find((x) => x.id === conversationId);
  if (!c || !hasUnseenReply(c)) return world;
  const w = draft(world);
  findConversation(w, conversationId).seenAt = now;
  return w;
}

// ─── Doors ───────────────────────────────────────────────────────────────────

function openDoor(w: World, c: Conversation, door: DoorId, now: number) {
  const state = c.doors[door]!;
  state.openedAt = now;
  c.lastActivityAt = now;
  // A deeper door changes what an unpicked offer should hold.
  if ((door === 'closer' || door === 'deep') && c.offer) makeOffer(w, c, now);
  notify(w, { kind: 'door', conversationId: c.id, personId: c.personId, door });
  considerTheirKnocks(w, c, now);
}

/**
 * Knock on a door. It opens only when both have knocked. Until then the knock
 * is private — nobody is ever shown a knock that wasn't answered — and it can
 * be taken back. Sharing doors carry what the visitor would share.
 */
export function knock(world: World, now: number, conversationId: string, door: DoorId, shareValue?: string): World {
  const w = draft(world);
  const c = activeConversation(w, conversationId);
  if (!doorAvailable(c, door)) throw new RuleError('That door isn’t here yet.');
  const state = (c.doors[door] ??= {});
  if (state.openedAt !== undefined) throw new RuleError('That door is already open.');
  if (state.mine !== undefined) throw new RuleError('You already knocked.');
  const kind = DOORS[door].reveal;
  if (kind) {
    const value = (shareValue ?? w.me[kind] ?? '').trim();
    if (!value) throw new RuleError('Add what you’d share before knocking.');
    w.me[kind] = value;
  }
  state.mine = now;
  if (state.theirs !== undefined) openDoor(w, c, door, now);
  else considerTheirKnocks(w, c, now);
  return w;
}

/** Take a knock back, any time before the door opens. After that, nothing can be un-revealed. */
export function unknock(world: World, now: number, conversationId: string, door: DoorId): World {
  const w = draft(world);
  const c = activeConversation(w, conversationId);
  const state = c.doors[door];
  if (!state?.mine) throw new RuleError('You haven’t knocked.');
  if (state.openedAt !== undefined) throw new RuleError('That door is already open.');
  delete state.mine;
  c.lastActivityAt = now;
  return w;
}

/**
 * The demo's stand-in for the other person deciding to knock. The rules
 * reward responsiveness: they go deeper only after the visitor has replied to
 * them, and some people take a round longer than others. This demonstrates the
 * idea that depth follows responsiveness; it is not a model of real people.
 */
function theyWouldKnock(c: Conversation, door: DoorId): boolean {
  const reserve = personById(c.personId).reserve ?? 0;
  const rounds = openedRounds(c).length;
  switch (door) {
    case 'names':
      return rounds >= 1 + reserve;
    case 'closer':
      return openedAt(c, 0) >= 2 + reserve && myReplies(c) >= 1;
    case 'work':
      return openedAt(c, 1) >= 1 + reserve;
    case 'deep':
      return openedAt(c, 1) >= 2 + reserve && myReplies(c) >= 2;
    case 'keep':
      return rounds >= 4 + reserve && myReplies(c) >= 1;
  }
}

function considerTheirKnocks(w: World, c: Conversation, now: number) {
  if (c.status !== 'active') return;
  for (const door of DOOR_ORDER) {
    const state = c.doors[door];
    if (state?.theirs !== undefined || state?.openedAt !== undefined) continue;
    if (!doorAvailable(c, door) || !theyWouldKnock(c, door)) continue;
    if (w.pending.some((e) => e.kind === 'their-knock' && e.conversationId === c.id && e.door === door)) continue;
    w.pending.push({ id: newId(w, 'e'), kind: 'their-knock', conversationId: c.id, door, dueAt: now + delay(w, DELAYS.knock) });
  }
}

// ─── Endings ─────────────────────────────────────────────────────────────────

/** Let a conversation rest at any moment, with a kind closing line instead of silence. */
export function letRest(world: World, now: number, conversationId: string, closingLine: string): World {
  const w = draft(world);
  const c = activeConversation(w, conversationId);
  c.status = 'resting';
  c.rest = { at: now, closingLine: closingLine.trim() || undefined };
  c.offer = undefined;
  c.lastActivityAt = now;
  cancelEventsFor(w, c.id);
  return w;
}

/** Block: the conversation ends for good, and they never appear in the commons again. They are not told. */
export function block(world: World, now: number, personId: string): World {
  const w = draft(world);
  if (!w.blocked.includes(personId)) w.blocked.push(personId);
  for (const c of w.conversations.filter((x) => x.personId === personId)) {
    c.blocked = true;
    if (c.status === 'active') {
      c.status = 'resting';
      c.rest = { at: now };
    }
    cancelEventsFor(w, c.id);
  }
  w.pending = w.pending.filter((e) => !(e.kind === 'lean-back' && e.personId === personId));
  w.notices = w.notices.filter((n) => n.personId !== personId);
  return w;
}

// ─── The simulated people acting ─────────────────────────────────────────────

function resolveEvent(w: World, e: SimEvent, now: number) {
  if (e.kind === 'lean-back') {
    if (w.blocked.includes(e.personId) || conversationWith(w, e.personId)) return;
    const day = w.days.find((d) => d.dayIndex === e.dayIndex);
    if (!day?.mine || !day.leans.includes(e.personId)) return;
    const person = personById(e.personId);
    const c: Conversation = {
      id: newId(w, 'c'),
      personId: e.personId,
      startedAt: now,
      met: {
        dayIndex: day.dayIndex,
        questionId: day.questionId,
        mine: day.mine.text,
        theirs: person.answers[day.questionId] ?? '',
        thread: [],
      },
      rounds: [],
      doors: {},
      status: 'active',
      lastActivityAt: now,
      seenAt: now,
    };
    w.conversations.push(c);
    makeOffer(w, c, now);
    notify(w, { kind: 'mutual', conversationId: c.id, personId: e.personId });
    return;
  }

  const c = w.conversations.find((x) => x.id === e.conversationId);
  if (!c || c.status !== 'active') return;
  switch (e.kind) {
    case 'their-pick': {
      if (c.offer?.picker !== 'them') return;
      const questionId = c.offer.questionIds[random(w) < 0.5 ? 0 : 1] ?? c.offer.questionIds[0]!;
      startRound(w, c, now, questionId, 'them');
      notify(w, { kind: 'their-pick', conversationId: c.id, personId: c.personId });
      return;
    }
    case 'their-half': {
      const round = c.rounds.find((x) => x.id === e.roundId);
      if (!round || round.theirs) return;
      round.theirs = { text: personById(c.personId).answers[round.questionId] ?? '', sealedAt: now };
      c.lastActivityAt = now;
      notify(w, { kind: 'their-half', conversationId: c.id, personId: c.personId, ready: Boolean(round.mine) });
      return;
    }
    case 'their-reply': {
      const { thread, questionId } = threadOf(c, e.thread);
      if (thread.some((m) => m.by === 'them')) return;
      const text = continuationFor(c.personId, questionId);
      if (!text) return;
      thread.push({ id: newId(w, 'm'), by: 'them', text, at: now });
      c.lastActivityAt = now;
      notify(w, { kind: 'their-reply', conversationId: c.id, personId: c.personId });
      return;
    }
    case 'their-knock': {
      const state = (c.doors[e.door] ??= {});
      if (state.theirs !== undefined || state.openedAt !== undefined) return;
      state.theirs = now;
      if (state.mine !== undefined) openDoor(w, c, e.door, now);
      return;
    }
  }
}

/** Deliver every simulated action that has come due, in the order it was due. */
export function advance(world: World, now: number): World {
  if (!world.pending.some((e) => e.dueAt <= now)) return world;
  const w = draft(world);
  const due = w.pending.filter((e) => e.dueAt <= now).sort((a, b) => a.dueAt - b.dueAt);
  w.pending = w.pending.filter((e) => e.dueAt > now);
  for (const e of due) resolveEvent(w, e, now);
  return w;
}

/**
 * Demo control: deliver everything the simulated people would eventually do,
 * right now, including what follows from it (a pick leads to a half). Stops at
 * whatever needs the visitor. Bounded so a mistake can never spin forever.
 */
export function hurry(world: World, now: number): World {
  let w = world;
  for (let i = 0; i < 32 && w.pending.length > 0; i++) {
    const d = draft(w);
    d.pending = d.pending.map((e) => ({ ...e, dueAt: Math.min(e.dueAt, now) }));
    w = advance(d, now);
  }
  return w;
}

/** Demo control: jump to just after the next local midnight. */
export function skipToTomorrow(world: World, realNow: number): World {
  const w = draft(world);
  const now = worldNow(w, realNow);
  w.clockOffset += nextLocalMidnight(now) - now + 60_000;
  return w;
}

export function dismissNotice(world: World, noticeId: string): World {
  return { ...world, notices: world.notices.filter((n) => n.id !== noticeId) };
}
