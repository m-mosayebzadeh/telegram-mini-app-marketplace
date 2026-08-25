/**
 * Message-domain types for the chat session UI (TECHNICAL_REQUIREMENTS.md
 * section 12). Kept separate from lib/types.ts (which mirrors backend
 * response shapes one-to-one) because a ChatMessage carries a few
 * client-only concerns real API rows don't have — `status` (delivery
 * state) and a temporary client-generated `id` for a message still in
 * flight — that lib/chatMessageApi.ts's real backend calls (see
 * backend/app/chat_message/) resolve into their final, server-assigned
 * form once sending succeeds.
 */

/** Only these four kinds of message content are allowed — no arbitrary
 * file attachments (spec section on message types). */
export type ChatMessageType = 'text' | 'photo' | 'video' | 'voice'

/** A message's delivery state, shown on the sender's own bubble only
 * (mirrors any real chat app): still going out, confirmed sent, or
 * failed and retryable. */
export type ChatMessageStatus = 'sending' | 'sent' | 'failed'

export interface ChatMessage {
  /** String, not number — real ids will eventually come from the
   * backend, but a locally-composed message (still "sending") needs an
   * id of its own before the server has assigned one, the same reason
   * most chat apps key drafts by a client-generated id. */
  id: string
  session_id: number
  sender_id: number
  type: ChatMessageType
  /** Set for 'text' messages, null otherwise. */
  text: string | null
  /** Set for 'photo' and 'video' messages (a displayable image/video
   * source — an object URL or data URI), null otherwise. */
  media_url: string | null
  /** Set for 'voice' and 'video' messages, null otherwise. */
  duration_seconds: number | null
  status: ChatMessageStatus
  /** ISO 8601 timestamp string, matching how every other timestamp in
   * this app (lib/types.ts) is represented. */
  created_at: string
}

/** The content of a message the viewer is about to send — everything
 * ChatMessage needs EXCEPT the bookkeeping fields (id, sender, status,
 * timestamp) that only get filled in once sending actually starts (see
 * lib/chatMessageApi.ts's composeMessage()). A discriminated union on
 * `type` so e.g. a 'text' draft can't accidentally be built without
 * `text`, or a 'voice' draft without `duration_seconds`.
 *
 * `media_url` (photo/video) is a LOCAL object URL — from
 * `URL.createObjectURL(file)` in components/chat/Composer.tsx — used
 * for the optimistic preview bubble before the real upload finishes;
 * `file` is the actual picked File, which is what gets uploaded (see
 * lib/chatMessageApi.ts's deliverMessage()). Voice has neither: a voice
 * "recording" is simulated (no real microphone access, see
 * TECHNICAL_REQUIREMENTS.md section 12), so there's never a real file
 * to upload for it — only the reported duration. */
export type NewMessageContent =
  | { type: 'text'; text: string }
  | { type: 'photo'; media_url: string; file: File }
  | { type: 'video'; media_url: string; file: File; duration_seconds: number }
  | { type: 'voice'; duration_seconds: number }

/** One calendar day's worth of consecutive messages — see
 * lib/chatTime.ts's groupMessagesByDate(), which produces these for the
 * message list's date-separator rendering. */
export interface MessageDateGroup {
  /** The YYYY-MM-DD this group's messages share. */
  dateKey: string
  messages: ChatMessage[]
}
