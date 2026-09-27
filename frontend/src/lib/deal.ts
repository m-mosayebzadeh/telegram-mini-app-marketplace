import { NEEDS_YOU, WAITS_ON_THEM, stageOfRequest, type Stage } from './relations'
import type { ChatSession, RequestActivity } from './types'

/**
 * What is going on between you and one person right now, beyond talking —
 * the one thing the conversation with them has to show besides messages
 * (TECHNICAL_REQUIREMENTS.md sections 30.9, 30.15–30.18).
 *
 * One person, one thread: a request, a running session, and a session
 * that has just ended all live inside the same conversation, never on a
 * page of their own. At most one of them is shown at a time, the most
 * pressing first — a session running now, then a request, then whatever
 * a finished session still needs.
 *
 * Pure, so the rules are tested on their own (deal.test.ts).
 */

export type Deal =
  | { kind: 'session'; session: ChatSession }
  | { kind: 'request'; stage: Exclude<Stage, 'session' | 'chat'>; request: RequestActivity }
  /** A finished session whose Photons are still held. The requester can
   *  release them; the offerer is told they are waiting. */
  | { kind: 'ending'; session: ChatSession; held: number; refunded: number }
  /** Released, and the offerer has not said thank you yet. Once they
   *  have, the thank-you is part of the conversation itself — it stays at
   *  the end of that session's messages like a reaction, for as long as
   *  the conversation does — so it is not a deal any more. */
  | { kind: 'thank'; session: ChatSession }

const REQUEST_RANK: Record<string, number> = { received: 0, accepted: 1, sent: 2, awaitpay: 3 }

export function dealWith(
  userId: number,
  activity: RequestActivity[],
  sessions: ChatSession[],
): Deal | null {
  const withThem = sessions.filter((s) => s.other_participant.user_id === userId)

  const open = withThem.find((s) => s.status === 'open')
  if (open) return { kind: 'session', session: open }

  let best: { stage: Exclude<Stage, 'session' | 'chat'>; request: RequestActivity } | null = null
  for (const request of activity) {
    if (request.counterpart_user_id !== userId) continue
    const stage = stageOfRequest(request, sessions)
    if (!stage || stage === 'session' || stage === 'chat') continue
    if (!best || REQUEST_RANK[stage] < REQUEST_RANK[best.stage]) best = { stage, request }
  }
  if (best) return { kind: 'request', ...best }

  // The latest finished session is the only one that can still need
  // anything; older ones are settled history.
  const closed = withThem
    .filter((s) => s.status === 'closed')
    .sort((a, b) => ((b.closed_at ?? '') > (a.closed_at ?? '') ? 1 : -1))[0]
  if (!closed) return null

  const held = closed.consumed_blocks * closed.block_price_photons
  const refunded = Math.max(0, closed.reserved_blocks - closed.consumed_blocks) * closed.block_price_photons
  if (closed.transaction_status === 'pending' && !closed.disputed && held > 0) {
    return { kind: 'ending', session: closed, held, refunded }
  }
  if (closed.transaction_status === 'succeeded' && closed.my_role === 'provider' && !closed.thanks_reaction) {
    return { kind: 'thank', session: closed }
  }
  return null
}

/** Who has to act next on a request — which decides how its card looks,
 *  never a new colour (section 30.19). */
export function requestWaitsOn(stage: Stage): 'you' | 'them' | null {
  if (NEEDS_YOU.includes(stage)) return 'you'
  if (WAITS_ON_THEM.includes(stage)) return 'them'
  return null
}

/** Which block of a running session we are in (1-based) and whether it is
 *  the last — the last block is where "one more block" lives and "stop
 *  after this block" does not (section 15). */
export function blockNow(session: ChatSession, now: number = Date.now()): { block: number; of: number; last: boolean } | null {
  if (!session.started_at || session.block_duration_seconds <= 0) return null
  const elapsed = (now - new Date(session.started_at).getTime()) / (session.block_duration_seconds * 1000)
  const of = Math.max(1, session.reserved_blocks)
  const block = Math.min(of, Math.floor(Math.max(0, elapsed)) + 1)
  return { block, of, last: block >= of }
}
