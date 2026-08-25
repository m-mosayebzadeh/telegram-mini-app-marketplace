/**
 * Message-domain types for the chat session UI (TECHNICAL_REQUIREMENTS.md
 * section 12). Deliberately kept separate from lib/types.ts: those types
 * mirror REAL backend response shapes one-to-one, while messages are
 * still mock data (see lib/mockChatData.ts) sitting behind a
 * service-layer interface (lib/chatMessageApi.ts) so a real backend can
 * be wired in later without any component or type here needing to change.
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
 * `text`, or a 'voice' draft without `duration_seconds`. */
export type NewMessageContent =
  | { type: 'text'; text: string }
  | { type: 'photo'; media_url: string }
  | { type: 'video'; media_url: string; duration_seconds: number }
  | { type: 'voice'; duration_seconds: number }

/** One calendar day's worth of consecutive messages — see
 * lib/chatTime.ts's groupMessagesByDate(), which produces these for the
 * message list's date-separator rendering. */
export interface MessageDateGroup {
  /** The YYYY-MM-DD this group's messages share. */
  dateKey: string
  messages: ChatMessage[]
}
