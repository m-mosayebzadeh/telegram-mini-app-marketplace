import type { Relation } from './relations'
import type { ChatSession } from './types'

/**
 * The news: what is waiting for you, derived from what is actually true.
 *
 * There is no notifications table behind this. Each item is a POINTER to
 * something real — a request to confirm, a payment to make, a message
 * unread, a session to release — so it appears when that thing becomes
 * true and disappears when it stops being true. Throwing an item into
 * the black hole only removes the pointer; the thing it pointed at stays
 * exactly where it lives (TECHNICAL_REQUIREMENTS.md section 30.16: "news
 * is a pointer, not the thing").
 *
 * Pure, so the rules are tested on their own (news.test.ts).
 */

export type NewsKind =
  | 'confirm'  // they accepted your offer — confirm or refuse, right here
  | 'pay'      // your acceptance was confirmed — pay to start
  | 'message'  // something unread from them
  | 'settle'   // a session ended — its Photons wait for your release
  | 'thanks'   // they thanked you for a session you released

export interface NewsItem {
  /** Stable while the thing it points at is unchanged; a NEW message
   *  gets a new key, so it comes back even after the last one was
   *  dismissed. */
  key: string
  kind: NewsKind
  userId: number
  name: string
  avatarUrl: string | null
  at: string
  /** For the answerable kinds: what the answer acts on. */
  requestId?: number
  /** Where tapping through goes. */
  conversationId: number | null
  sessionId?: number
  offerTitle?: string
  photons?: number
  reaction?: string
  /** For a message: what it said, so the card can show it. */
  text?: string | null
  /** A payment to make: when the window closes, and when it opened. */
  payBy?: string | null
  confirmedAt?: string | null
  /** A confirmation that must wait: who holds the slot, and until when. */
  queuedBehind?: string | null
  freesAt?: string | null
}

/** Whether this item can be answered on the card itself. */
export const ANSWERABLE: readonly NewsKind[] = ['confirm']

export function buildNews(
  relations: Relation[],
  sessions: ChatSession[],
  dismissed: ReadonlySet<string>,
): NewsItem[] {
  const items: NewsItem[] = []
  const conversationOf = new Map(relations.map((r) => [r.userId, r.conversationId]))

  for (const r of relations) {
    const base = { userId: r.userId, name: r.name, avatarUrl: r.avatarUrl, conversationId: r.conversationId }
    if (r.stage === 'received' && r.request) {
      items.push({ ...base, key: `confirm:${r.request.id}`, kind: 'confirm', at: r.request.created_at, requestId: r.request.id, offerTitle: r.request.offer_title, photons: r.request.offer_price_photons, queuedBehind: r.request.queued_behind_name ?? null, freesAt: r.request.frees_at ?? null })
    } else if (r.stage === 'accepted' && r.request) {
      items.push({ ...base, key: `pay:${r.request.id}`, kind: 'pay', at: r.request.responded_at ?? r.request.created_at, requestId: r.request.id, offerTitle: r.request.offer_title, photons: r.request.offer_price_photons, payBy: r.request.pay_by ?? null, confirmedAt: r.request.responded_at })
    }
    // Unread is its own pointer, whatever the stage: a message can arrive
    // during a request as easily as during a plain conversation.
    if (r.unread && r.conversationId !== null) {
      items.push({ ...base, key: `message:${r.conversationId}:${r.lastAt}`, kind: 'message', at: r.lastAt, text: r.lastText })
    }
  }

  for (const s of sessions) {
    if (s.status !== 'closed' || s.my_role !== 'buyer') continue
    const other = s.other_participant
    const base = { userId: other.user_id, name: other.display_name, avatarUrl: other.avatar_url, conversationId: conversationOf.get(other.user_id) ?? null, sessionId: s.id }
    const held = s.consumed_blocks * s.block_price_photons
    if (s.transaction_status === 'pending' && !s.i_confirmed_settlement && !s.disputed && held > 0) {
      items.push({ ...base, key: `settle:${s.id}`, kind: 'settle', at: s.closed_at ?? s.opened_at, photons: held })
    }
    if (s.thanks_reaction) {
      items.push({ ...base, key: `thanks:${s.id}`, kind: 'thanks', at: s.closed_at ?? s.opened_at, reaction: s.thanks_reaction })
    }
  }

  return items
    .filter((item) => !dismissed.has(item.key))
    .sort((a, b) => (b.at > a.at ? 1 : b.at < a.at ? -1 : 0))
}

// ---------------------------------------------------------------- dismissal
// Kept on the device for now: a dismissed pointer is a convenience, and
// losing it only means seeing an item again. Stored as keys, trimmed so the
// list cannot grow forever.

const STORE = 'cos-news-dismissed'
const KEEP = 400

export function loadDismissed(): Set<string> {
  try {
    const raw = localStorage.getItem(STORE)
    return new Set(raw ? (JSON.parse(raw) as string[]) : [])
  } catch {
    return new Set()
  }
}

export function saveDismissed(keys: Set<string>): void {
  try {
    localStorage.setItem(STORE, JSON.stringify([...keys].slice(-KEEP)))
  } catch {
    // Storage may be unavailable; the only cost is seeing an item again.
  }
}
