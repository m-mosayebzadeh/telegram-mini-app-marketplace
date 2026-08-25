/**
 * Mock conversation data for the chat session UI (TECHNICAL_REQUIREMENTS.md
 * section 12, spec item 43: message content is mocked while session /
 * offer / participant data stays real). This is the ONLY file that knows
 * what a fake conversation looks like — lib/chatMessageApi.ts wraps it
 * behind a service function, so swapping in a real backend later means
 * changing that one file, not any component.
 *
 * A session's conversation is generated deterministically from its own
 * id (a seeded PRNG, not Math.random()) so reloading the same session
 * always shows the exact same messages instead of reshuffling — this
 * matters for real manual testing/screenshots, and for this file's own
 * unit tests.
 */

import type { ChatMessage, ChatMessageType } from './chatMessageTypes'
import type { ChatSession } from './types'

/** A tiny inline placeholder image (a soft gradient rectangle) used as
 * every mock photo message's media_url — there is no real uploaded file
 * behind it, so a data: URI keeps this file fully self-contained instead
 * of depending on a static asset that may or may not exist. */
const MOCK_PHOTO_DATA_URL =
  "data:image/svg+xml;utf8,%3Csvg xmlns='http://www.w3.org/2000/svg' width='320' height='320'%3E" +
  "%3Cdefs%3E%3ClinearGradient id='g' x1='0' y1='0' x2='1' y2='1'%3E" +
  "%3Cstop offset='0%25' stop-color='%23a855f7'/%3E%3Cstop offset='55%25' stop-color='%23f472b6'/%3E" +
  "%3Cstop offset='100%25' stop-color='%23ff8a3d'/%3E%3C/linearGradient%3E%3C/defs%3E" +
  "%3Crect width='320' height='320' fill='url(%23g)'/%3E%3C/svg%3E"

/** One template message in the scripted mock conversation. `role` is
 * relative to the SESSION (buyer/provider), not a fixed user id — the
 * actual sender_id is resolved per-viewer in generateMockConversation()
 * below, since the same session looks different depending on who's
 * asking ("me" vs. "the other participant"). */
interface MockMessageTemplate {
  role: 'buyer' | 'provider'
  type: ChatMessageType
  text?: string
  durationSeconds?: number
}

// A short, realistic back-and-forth: greeting, the actual ask, a photo
// shared as reference, a voice reply, and a friendly close — enough
// variety to exercise every bubble type (text/photo/voice) the UI needs
// to render. Persian, matching the app's default language and its
// real-world (Iranian) user base.
const MOCK_TEMPLATES: MockMessageTemplate[] = [
  { role: 'buyer', type: 'text', text: 'سلام! ممنون که وقت گذاشتید 🙏' },
  { role: 'provider', type: 'text', text: 'سلام، خواهش می‌کنم! خب بفرمایید، چطور می‌تونم کمکتون کنم؟' },
  { role: 'buyer', type: 'text', text: 'می‌خواستم راهنمایی بگیرم، یه سوال مشخص دارم' },
  { role: 'provider', type: 'text', text: 'حتماً، بذارید یه تصویر براتون بفرستم که بهتر توضیح بدم' },
  { role: 'provider', type: 'photo' },
  { role: 'buyer', type: 'text', text: 'آها، دقیقاً همینو می‌خواستم بدونم. ممنون' },
  { role: 'provider', type: 'voice', durationSeconds: 14 },
  { role: 'buyer', type: 'text', text: 'خیلی روشن شد، دستتون درد نکنه' },
  { role: 'provider', type: 'text', text: 'خواهش می‌کنم، اگه سوال دیگه‌ای بود در خدمتم' },
]

/** Deterministic PRNG (mulberry32) seeded from a plain number — used
 * instead of Math.random() so the SAME session id always produces the
 * SAME conversation. Not cryptographic, just needs to be fast, seedable,
 * and reasonably well-distributed for spacing out mock timestamps. */
function mulberry32(seed: number): () => number {
  let state = seed
  return () => {
    state = (state + 0x6d2b79f5) | 0
    let t = Math.imul(state ^ (state >>> 15), 1 | state)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

/**
 * Builds the full mock conversation for one session, from `viewerId`'s
 * point of view. Every message in MOCK_TEMPLATES gets a resolved
 * sender_id (comparing its relative `role` against the session's own
 * my_role/other_participant) and a timestamp spread evenly — with a bit
 * of seeded jitter, so it doesn't look robotically regular — across the
 * session's real opened_at..closed_at window (or opened_at..now for a
 * still-open session).
 */
export function generateMockConversation(session: ChatSession, viewerId: number): ChatMessage[] {
  const rng = mulberry32(session.id)
  const openedMs = new Date(session.opened_at).getTime()
  const endMs = session.closed_at ? new Date(session.closed_at).getTime() : Date.now()
  // Guarantee at least a minute of spread per message so a very
  // freshly-opened session (opened_at ~= now) still produces a sensible,
  // strictly increasing timeline instead of every message piling onto
  // the same instant.
  const windowMs = Math.max(endMs - openedMs, MOCK_TEMPLATES.length * 60_000)

  const otherId = session.other_participant.user_id

  return MOCK_TEMPLATES.map((template, index) => {
    const senderId = template.role === session.my_role ? viewerId : otherId

    // Each message gets a "slot" [index, index+1) out of MOCK_TEMPLATES.length
    // slots, plus up to 0.6 of a slot's worth of seeded jitter — jitter is
    // capped below 1 slot so ordering across messages can never invert.
    const fraction = (index + rng() * 0.6) / MOCK_TEMPLATES.length
    const createdAt = new Date(openedMs + fraction * windowMs).toISOString()

    return {
      id: `mock-${session.id}-${index}`,
      session_id: session.id,
      sender_id: senderId,
      type: template.type,
      text: template.text ?? null,
      media_url: template.type === 'photo' ? MOCK_PHOTO_DATA_URL : null,
      duration_seconds: template.durationSeconds ?? null,
      // Every message in the mock conversation is history — nothing here
      // is actively "sending" or "failed" (those states only apply once
      // the composer sends a real new message; see MessageBubble.tsx for
      // the states it renders).
      status: 'sent' as const,
      created_at: createdAt,
    }
  })
}
