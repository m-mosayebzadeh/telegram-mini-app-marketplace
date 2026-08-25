/**
 * The message-domain "service layer" — the one place chat UI components
 * ask for messages, mirroring how lib/contentApi.ts is the one place
 * content screens ask for content. Backed by the real
 * backend/app/chat_message/ endpoints — session/offer/participant data
 * was always real (see lib/types.ts's ChatSession); this is the piece
 * that used to be mocked (see TECHNICAL_REQUIREMENTS.md section 12) and
 * has now been swapped for the real thing, exactly as the mock-phase
 * architecture was meant to allow: only this file changed, no component
 * or type here did.
 *
 * There's no real-time push (no websockets) — pages/ChatSessionDetail.tsx
 * polls listMessages() on an interval while a session is open, which is
 * what actually lets two different real participants see each other's
 * messages (the mock phase never could, by construction: each browser
 * only ever simulated its own private copy of the conversation).
 */

import { apiFetch, apiFetchBlob } from './api'
import type { ChatMessage, ChatMessageStatus, ChatMessageType, NewMessageContent } from './chatMessageTypes'
import type { ChatSession } from './types'

/** The raw shape GET/POST /chat-sessions/{id}/messages returns — see
 * backend/app/chat_message/schemas.py's ChatMessageOut. Deliberately has
 * no `status` (every row here is already persisted — "sent" is the only
 * state a server-known message can be in) and no `media_url` (a
 * photo/video's bytes are fetched separately, see resolveMediaUrl below,
 * the same authenticated-fetch pattern lib/contentApi.ts's
 * fetchContentFileBlobUrl already uses for content). */
interface ChatMessageApiRow {
  id: number
  chat_session_id: number
  sender_id: number
  type: ChatMessageType
  text: string | null
  duration_seconds: number | null
  created_at: string
}

// Resolved object URLs for photo/video messages, keyed by the real
// (server-assigned) message id — a poll that re-fetches the same
// message reuses this instead of re-downloading and re-creating a
// fresh object URL for bytes that never change.
const fileUrlCache = new Map<number, string>()

async function resolveMediaUrl(sessionId: number, row: ChatMessageApiRow): Promise<string | null> {
  if (row.type !== 'photo' && row.type !== 'video') return null

  const cached = fileUrlCache.get(row.id)
  if (cached) return cached

  const blob = await apiFetchBlob(`/chat-sessions/${sessionId}/messages/${row.id}/file`)
  const url = URL.createObjectURL(blob)
  fileUrlCache.set(row.id, url)
  return url
}

async function toChatMessage(sessionId: number, row: ChatMessageApiRow): Promise<ChatMessage> {
  return {
    id: String(row.id),
    session_id: sessionId,
    sender_id: row.sender_id,
    type: row.type,
    text: row.text,
    media_url: await resolveMediaUrl(sessionId, row),
    duration_seconds: row.duration_seconds,
    status: 'sent',
    created_at: row.created_at,
  }
}

/** Every message in `session`'s conversation, oldest first — a plain
 * GET, no caching of the list itself (only of resolved file URLs, see
 * above): the server is always the source of truth, which is exactly
 * what makes two different participants' views converge. `viewerId`
 * isn't needed here (unlike the old mock generator, which needed it to
 * fabricate a conversation) but is kept in the signature so callers —
 * and the polling effect in pages/ChatSessionDetail.tsx — don't need to
 * change. */
export async function listMessages(session: ChatSession, _viewerId: number): Promise<ChatMessage[]> {
  const rows = await apiFetch<ChatMessageApiRow[]>(`/chat-sessions/${session.id}/messages`)
  return Promise.all(rows.map((row) => toChatMessage(session.id, row)))
}

let nextDraftSuffix = 0
// The NewMessageContent behind each still-in-flight draft message,
// keyed by the draft's own client-generated id — deliverMessage() reads
// from here (instead of needing the content passed to it again) so
// retrying a failed send just needs the ChatMessage, not the original
// content, including the raw File for a photo/video that hasn't
// uploaded yet.
const pendingContentByDraftId = new Map<string, NewMessageContent>()

/**
 * Builds a new outgoing message in the 'sending' state — optimistic UI,
 * the bubble shows up immediately, before the real upload/POST even
 * starts. Purely local/synchronous; deliverMessage() is what actually
 * talks to the backend.
 */
export function composeMessage(session: ChatSession, senderId: number, content: NewMessageContent): ChatMessage {
  const id = `draft-${Date.now()}-${nextDraftSuffix++}`
  pendingContentByDraftId.set(id, content)

  return {
    id,
    session_id: session.id,
    sender_id: senderId,
    type: content.type,
    text: content.type === 'text' ? content.text : null,
    media_url: content.type === 'photo' || content.type === 'video' ? content.media_url : null,
    duration_seconds: content.type === 'video' || content.type === 'voice' ? content.duration_seconds : null,
    status: 'sending',
    created_at: new Date().toISOString(),
  }
}

export interface DeliverResult {
  status: ChatMessageStatus
  /** The message with its real, server-assigned id/fields — present
   * only on success. The caller (pages/ChatSessionDetail.tsx) swaps its
   * local draft for this, so the NEXT poll of listMessages() recognizes
   * it as the same message (matching by id) instead of showing it twice. */
  resolved?: ChatMessage
}

/**
 * Actually sends a composed message to the backend. Looks up the
 * message's pending NewMessageContent by id (see composeMessage) rather
 * than taking it as a parameter — that's what lets retrying a failed
 * send (pages/ChatSessionDetail.tsx's retryMessage) call this the exact
 * same way as the original send, without the caller needing to hold
 * onto the original content (including a photo/video's raw File)
 * separately.
 */
export async function deliverMessage(session: ChatSession, message: ChatMessage): Promise<DeliverResult> {
  const content = pendingContentByDraftId.get(message.id)
  if (!content) {
    // Nothing to (re)send — e.g. called on an already-delivered message.
    // Shouldn't happen in practice, but failing closed is safer than
    // silently no-op-ing and leaving the bubble stuck on "sending".
    return { status: 'failed' }
  }

  const form = new FormData()
  form.append('type', content.type)
  if (content.type === 'text') {
    form.append('text', content.text)
  } else if (content.type === 'photo') {
    form.append('file', content.file)
  } else if (content.type === 'video') {
    form.append('file', content.file)
    form.append('duration_seconds', String(content.duration_seconds))
  } else {
    form.append('duration_seconds', String(content.duration_seconds))
  }

  try {
    const row = await apiFetch<ChatMessageApiRow>(`/chat-sessions/${session.id}/messages`, {
      method: 'POST',
      body: form,
    })
    pendingContentByDraftId.delete(message.id)

    // Reuse the local preview URL we already have for a photo/video
    // (it's the exact same bytes we just uploaded) instead of an
    // immediate extra round trip to re-fetch what we already hold.
    if (message.media_url && (row.type === 'photo' || row.type === 'video')) {
      fileUrlCache.set(row.id, message.media_url)
    }

    const resolved: ChatMessage = {
      id: String(row.id),
      session_id: session.id,
      sender_id: row.sender_id,
      type: row.type,
      text: row.text,
      media_url: message.media_url,
      duration_seconds: row.duration_seconds,
      status: 'sent',
      created_at: row.created_at,
    }
    return { status: 'sent', resolved }
  } catch {
    // Left in pendingContentByDraftId on purpose — a retry needs the
    // same content (and File) still available.
    return { status: 'failed' }
  }
}
