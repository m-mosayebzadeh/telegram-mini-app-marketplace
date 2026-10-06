import type { Conversation } from './conversationApi'
import type { ChatSession, RequestActivity } from './types'

/**
 * Everyone you are dealing with, once each.
 *
 * The server keeps three separate things — conversations, requests on
 * offers, and paid sessions — but a person is one person (the orb
 * principle, TECHNICAL_REQUIREMENTS.md section 30). This folds the three
 * into one entry per person with a single STAGE, which is what the stair
 * in the conversations region and the news both read.
 *
 * Pure on purpose: the stage of a relationship is business logic, not
 * display, so it is tested on its own (relations.test.ts) without
 * rendering anything.
 */

/**
 * Where a relationship stands, named for who has to act next.
 *
 *   session   a paid session is running now
 *   received  they accepted YOUR offer; you have to confirm
 *   accepted  you accepted THEIR offer and they confirmed; you have to pay
 *   sent      you accepted their offer; they have to confirm
 *   awaitpay  you confirmed their acceptance; they have to pay
 *   chat      nothing pending — an ordinary conversation
 *
 * (The server calls these requests: a buyer "requests" an offer and the
 * provider "accepts" the request. The product never says "buy" — somebody
 * accepts an offer, its owner confirms, and a payment in Photons starts
 * the session — section 30.19.)
 */
export type Stage = 'session' | 'received' | 'accepted' | 'sent' | 'awaitpay' | 'chat'

/** Waiting on you: these jump the queue. */
export const NEEDS_YOU: readonly Stage[] = ['received', 'accepted']
/** Waiting on them: nothing you can do, so they do not. */
export const WAITS_ON_THEM: readonly Stage[] = ['sent', 'awaitpay']
/** Anything that is a request rather than a conversation or a session. */
export const PENDING: readonly Stage[] = [...NEEDS_YOU, ...WAITS_ON_THEM]

export interface Relation {
  userId: number
  name: string
  avatarUrl: string | null
  stage: Stage
  /** The one thread with this person, if it exists yet. A request can
   *  exist before any message has been written. */
  conversationId: number | null
  lastText: string | null
  /** For ordering: the latest thing that happened between you. */
  lastAt: string
  unread: boolean
  /** How many unread messages — the number on the row. */
  unreadCount: number
  /** How you met: "echo" when Echo made the thread, "world" otherwise. */
  origin: 'world' | 'echo'
  /** Muted by you: shown on the row, and not counted on the door. */
  muted?: boolean
  /** Pinned: its place among the pinned (0 is the first pinned, highest),
   *  or null when not pinned. */
  pinnedRank?: number | null
  /** Cosmos Team (section 37), not a person. */
  team?: boolean
  /** The request behind a pending stage. */
  request: RequestActivity | null
  /** The session behind the 'session' stage. */
  session: ChatSession | null
}

/** The later of two timestamps (ISO strings compare correctly as text). */
const later = (a: string, b: string | null | undefined): string => (b && b > a ? b : a)

/** How urgent a pending request is, when one person has several. */
const REQUEST_RANK: Record<Stage, number> = { session: 0, received: 1, accepted: 1, sent: 2, awaitpay: 2, chat: 3 }

/** The stage a single request puts a relationship in, or null if the
 *  request is settled (rejected, cancelled, or paid and running as a
 *  session already). */
export function stageOfRequest(request: RequestActivity, sessions: ChatSession[]): Stage | null {
  const paid = sessions.some((s) => s.request_id === request.id)
  if (request.status === 'pending') return request.direction === 'received' ? 'received' : 'sent'
  if (request.status === 'accepted' && !paid) return request.direction === 'sent' ? 'accepted' : 'awaitpay'
  return null
}

export function buildRelations(
  conversations: Conversation[],
  activity: RequestActivity[],
  sessions: ChatSession[],
): Relation[] {
  const byUser = new Map<number, Relation>()
  const ensure = (userId: number, name: string, avatarUrl: string | null): Relation => {
    let r = byUser.get(userId)
    if (!r) {
      r = { userId, name, avatarUrl, stage: 'chat', conversationId: null, lastText: null, lastAt: '', unread: false, unreadCount: 0, origin: 'world', request: null, session: null }
      byUser.set(userId, r)
    }
    return r
  }

  // Conversations first: they carry the last message and the unread flag.
  // Only one-to-one threads — a group is not a person. They arrive pinned
  // first, in the order they were pinned, which is what the rank keeps.
  let pinnedSoFar = 0
  for (const c of conversations) {
    if (c.kind !== 'direct' || c.others.length !== 1) continue
    const other = c.others[0]
    const r = ensure(other.user_id, other.display_name, other.avatar_url)
    r.conversationId = c.id
    r.team = other.team ?? false
    r.lastText = c.last_text
    r.origin = c.origin === 'echo' ? 'echo' : 'world'
    r.muted = c.muted ?? false
    r.pinnedRank = c.pinned ? pinnedSoFar++ : null
    r.lastAt = later(r.lastAt, c.last_message_at ?? c.created_at)
    r.unread = c.unread
    // An older server sends only the flag: count it as one rather than
    // show a flag with no number.
    r.unreadCount = c.unread ? Math.max(1, c.unread_count ?? 1) : 0
  }

  // Requests: the most urgent live one with each person sets the stage.
  for (const request of activity) {
    const stage = stageOfRequest(request, sessions)
    if (!stage) continue
    const r = ensure(request.counterpart_user_id, request.counterpart_display_name, request.counterpart_avatar_url)
    if (r.request === null || REQUEST_RANK[stage] < REQUEST_RANK[r.stage]) {
      r.stage = stage
      r.request = request
    }
    r.lastAt = later(r.lastAt, request.responded_at ?? request.created_at)
  }

  // A running session outranks everything.
  for (const s of sessions) {
    if (s.status !== 'open') continue
    const other = s.other_participant
    const r = ensure(other.user_id, other.display_name, other.avatar_url)
    r.stage = 'session'
    r.session = s
    r.request = null
    r.lastAt = later(r.lastAt, s.started_at ?? s.opened_at)
  }

  return [...byUser.values()]
}

/**
 * The order on the stair: a session running now; then anything waiting on
 * you; then conversations with something unread; then the rest, newest
 * first. Things waiting on the other person do not jump the queue — there
 * is nothing for you to do about them (section 30.19).
 */
export function priorityOf(r: Relation): number {
  if (r.stage === 'session') return 0
  if (NEEDS_YOU.includes(r.stage)) return 1
  if (r.unread) return 2
  return 3
}

export function orderRelations(list: Relation[]): Relation[] {
  return [...list].sort((a, b) => priorityOf(a) - priorityOf(b) || (b.lastAt > a.lastAt ? 1 : b.lastAt < a.lastAt ? -1 : 0))
}

/** Minutes until a running session stops — at the end of this block when
 *  someone asked to stop there, otherwise at its planned end. */
export function minutesLeft(session: ChatSession, now: number = Date.now()): number | null {
  if (!session.ends_at || !session.started_at) return null
  let end = new Date(session.ends_at).getTime()
  if (session.close_at_block_end_by_user_id !== null && session.block_duration_seconds > 0) {
    const started = new Date(session.started_at).getTime()
    const block = session.block_duration_seconds * 1000
    const blockEnd = started + Math.ceil((now - started) / block) * block
    end = Math.min(end, blockEnd)
  }
  return Math.max(0, Math.ceil((end - now) / 60000))
}
