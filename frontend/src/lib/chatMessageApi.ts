/**
 * The message-domain "service layer" — the one place chat UI components
 * ask for messages, mirroring how lib/contentApi.ts is the one place
 * content screens ask for content. Every function here is currently
 * backed by mock data (lib/mockChatData.ts), per TECHNICAL_REQUIREMENTS.md
 * section 12 (spec item 43): session/offer/participant data is real, but
 * there's no real message backend yet. When one exists, only the bodies
 * of the functions in this file need to change — every component already
 * calls them as if they were async network calls (they return Promises),
 * so nothing else has to be touched.
 */

import { generateMockConversation } from './mockChatData'
import type { ChatMessage, ChatMessageStatus, NewMessageContent } from './chatMessageTypes'
import type { ChatSession } from './types'

// Keyed by session id, so re-opening the same session's chat screen
// during one page session shows the same conversation instead of
// re-rolling it — matters once sendMessage() (a later stage) starts
// appending real in-memory messages that must not disappear on
// navigating away and back.
const conversationsBySessionId = new Map<number, ChatMessage[]>()

/** Simulates real network latency so the message list's loading state
 * actually gets exercised during manual testing, instead of always
 * resolving instantly. */
function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

/**
 * Returns every message in `session`'s conversation, from `viewerId`'s
 * point of view, oldest first. Generates (and caches) the mock
 * conversation on first call for a given session.
 */
export async function listMessages(session: ChatSession, viewerId: number): Promise<ChatMessage[]> {
  await delay(250)

  let messages = conversationsBySessionId.get(session.id)
  if (!messages) {
    messages = generateMockConversation(session, viewerId)
    conversationsBySessionId.set(session.id, messages)
  }
  return messages
}

let nextDraftSuffix = 0

/**
 * Builds a new outgoing message in the 'sending' state and adds it to
 * the session's cached conversation immediately (optimistic UI: the
 * bubble shows up right away, before delivery is confirmed — exactly
 * like every real chat app's own send flow). Pure/synchronous on
 * purpose, so the caller can put the returned message into its own
 * render state in the same tick it was composed, then separately await
 * deliverMessage() to learn how it resolved.
 */
export function composeMessage(session: ChatSession, senderId: number, content: NewMessageContent): ChatMessage {
  const message: ChatMessage = {
    // Date.now() + an incrementing suffix (not just Math.random()) keeps
    // ids unique even if two messages are composed within the same
    // millisecond, while still being trivially readable in a debugger.
    id: `draft-${Date.now()}-${nextDraftSuffix++}`,
    session_id: session.id,
    sender_id: senderId,
    text: null,
    media_url: null,
    duration_seconds: null,
    ...content,
    status: 'sending',
    created_at: new Date().toISOString(),
  }

  const list = conversationsBySessionId.get(session.id) ?? []
  list.push(message)
  conversationsBySessionId.set(session.id, list)

  return message
}

/**
 * Simulates actually delivering a composed message: waits a bit (like a
 * real network round trip), then resolves to 'sent' or 'failed' — and
 * updates the cached copy of the message to match, so re-visiting this
 * session later in the same page session still shows the outcome.
 *
 * Two ways a delivery fails, both deliberate:
 *   - a small random chance on every send, so the UI's failed/retry
 *     state is something a reviewer will actually run into during
 *     normal manual testing, not just a code path nobody ever sees;
 *   - a text message whose entire body is "fail" (case-insensitive)
 *     ALWAYS fails — a deterministic way to summon that state on demand
 *     for testing/demoing the retry button specifically.
 *
 * `random` and `delayMs` are overridable so tests can make this
 * deterministic and instant instead of actually waiting and rolling
 * dice — see chatMessageApi.test.ts.
 */
export async function deliverMessage(
  message: ChatMessage,
  options: { random?: () => number; delayMs?: number } = {},
): Promise<ChatMessageStatus> {
  const random = options.random ?? Math.random
  const delayMs = options.delayMs ?? 500 + Math.random() * 500
  await delay(delayMs)

  const forcedFailure = message.type === 'text' && message.text?.trim().toLowerCase() === 'fail'
  const randomFailure = random() < 0.12
  const finalStatus: ChatMessageStatus = forcedFailure || randomFailure ? 'failed' : 'sent'

  const cached = conversationsBySessionId.get(message.session_id)?.find((m) => m.id === message.id)
  if (cached) cached.status = finalStatus

  return finalStatus
}
