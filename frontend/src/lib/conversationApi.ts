import { apiFetch, apiFetchBlob } from './api'

/**
 * Talking to somebody.
 *
 * Messaging is free (TECHNICAL_REQUIREMENTS.md section 24), so a
 * conversation is the ordinary way two people talk and a paid session is
 * something that happens INSIDE one for a while. That is why nothing here
 * mentions money: the same thread carries both.
 */

export interface ConversationPerson {
  user_id: number
  display_name: string
  username: string | null
  avatar_url: string | null
}

export interface Conversation {
  id: number
  kind: string
  created_at: string
  last_message_at: string | null
  /** Everyone except you. A direct thread has exactly one, but a group
   *  and an event room have many, so this is a list even where the common
   *  case is a single person. */
  others: ConversationPerson[]
  /** What may be sent right now: the thread's free baseline plus whatever
   *  a running paid session adds. The composer is built from this rather
   *  than from its own copy of the rules. */
  capabilities: string[]
  active_session_id: number | null
  archived: boolean
  unread: boolean
  last_text: string | null
  /** How far anybody else has read. Your messages up to here show two
   *  ticks. */
  others_read_at: string | null
}

/** Enough of an answered message to draw the quote above a reply. */
export interface ReplyPreview {
  id: number
  sender_id: number
  type: string
  text: string | null
}

export interface Reaction {
  user_id: number
  emoji: string
}

export interface ConversationMessage {
  id: number
  conversation_id: number
  /** Which paid session it was written during, or null for a free
   *  message. */
  chat_session_id: number | null
  sender_id: number
  type: string
  text: string | null
  duration_seconds: number | null
  created_at: string
  /** This message carried a card number, Sheba, phone number or handle.
   *  The conversation shows its warning under the first one of these. */
  flagged_payment: boolean
  /** The name the sender's phone gave it before sending (see
   *  lib/thread.ts, newClientId). Lets a confirmed message replace its own
   *  clock-marked copy, and lets a resend be recognised as a resend. */
  client_id: string | null
  /** When the text was last changed, or null. */
  edited_at?: string | null
  reply_to_id?: number | null
  reply_to?: ReplyPreview | null
  reactions?: Reaction[]
}

/** Every thread you are in, most recent first. */
export function fetchConversations(): Promise<Conversation[]> {
  return apiFetch<Conversation[]>('/conversations')
}

/**
 * The thread with this person, opened if it does not exist yet.
 *
 * Safe to call every time the screen opens: two people have exactly one
 * conversation, so this is "give me it" rather than "make a new one".
 */
export function openConversationWith(userId: number): Promise<Conversation> {
  return apiFetch<Conversation>('/conversations', {
    method: 'POST',
    body: JSON.stringify({ user_id: userId }),
  })
}

export function fetchConversation(id: number): Promise<Conversation> {
  return apiFetch<Conversation>(`/conversations/${id}`)
}

export function fetchMessages(id: number): Promise<ConversationMessage[]> {
  return apiFetch<ConversationMessage[]>(`/conversations/${id}/messages`)
}

/**
 * Says something.
 *
 * Sent as form data rather than JSON because the same endpoint takes a
 * file for the message types a paid session unlocks, and one shape for
 * both is one thing to get right instead of two.
 */
export function sendText(
  id: number,
  text: string,
  clientId: string,
  replyToId?: number | null,
): Promise<ConversationMessage> {
  const body = new FormData()
  body.append('type', 'text')
  body.append('text', text)
  body.append('client_id', clientId)
  if (replyToId) body.append('reply_to_id', String(replyToId))
  return apiFetch<ConversationMessage>(`/conversations/${id}/messages`, {
    method: 'POST',
    body,
  })
}

/** Marks the thread read up to now, so the other side's unread mark
 *  clears. Failure is ignored by callers: an unread badge that lingers is
 *  not worth an error in front of somebody mid-conversation. */
export function markRead(id: number): Promise<void> {
  return apiFetch<void>(`/conversations/${id}/read`, { method: 'POST' })
}

/**
 * A voice note or a photograph.
 *
 * Returned as a local object URL rather than a server address, because the
 * file is behind authentication and neither an <img> nor an <audio> can
 * send our header. The caller owns the URL and must revoke it, or every
 * photograph opened stays in memory for the life of the tab.
 */
export async function fetchMessageFile(conversationId: number, messageId: number): Promise<string> {
  const blob = await apiFetchBlob(`/conversations/${conversationId}/messages/${messageId}/file`)
  return URL.createObjectURL(blob)
}

export function sendVoice(
  id: number,
  file: File,
  durationSeconds: number,
  clientId: string,
): Promise<ConversationMessage> {
  const body = new FormData()
  body.append('type', 'voice')
  body.append('client_id', clientId)
  body.append('duration_seconds', String(durationSeconds))
  body.append('file', file)
  return apiFetch<ConversationMessage>(`/conversations/${id}/messages`, { method: 'POST', body })
}

export function sendPhoto(id: number, file: File, clientId: string): Promise<ConversationMessage> {
  const body = new FormData()
  body.append('type', 'photo')
  body.append('client_id', clientId)
  body.append('file', file)
  return apiFetch<ConversationMessage>(`/conversations/${id}/messages`, { method: 'POST', body })
}

/** Changes the text of your own message. The server keeps what it said
 *  before, for staff; the people talking see "edited". */
export function editMessage(id: number, messageId: number, text: string): Promise<ConversationMessage> {
  return apiFetch<ConversationMessage>(`/conversations/${id}/messages/${messageId}`, {
    method: 'PATCH',
    body: JSON.stringify({ text }),
  })
}

/**
 * Deletes one message or a whole selection in one request.
 *
 * `forEveryone` is a wish, not an order: the server honours it only for
 * your own messages (and, in a paid session, only briefly), and hides the
 * rest from your view alone. Either way they leave your screen.
 */
export function deleteMessages(
  id: number,
  messageIds: number[],
  forEveryone: boolean,
): Promise<{ for_everyone: number[]; only_for_me: number[] }> {
  return apiFetch(`/conversations/${id}/messages/delete`, {
    method: 'POST',
    body: JSON.stringify({ message_ids: messageIds, for_everyone: forEveryone }),
  })
}

/** Sets your reaction, replacing any earlier one; null takes it back. */
export function setReaction(id: number, messageId: number, emoji: string | null): Promise<void> {
  return apiFetch<void>(`/conversations/${id}/messages/${messageId}/reaction`, {
    method: 'PUT',
    body: JSON.stringify({ emoji }),
  })
}

/** The reasons somebody can pick with one tap. Asking to be paid outside
 *  the app comes first, because it is the specific move this whole product
 *  exists to protect people from and the first step of most scams here. */
export const REPORT_REASONS = [
  'off_app_payment',
  'scam',
  'insult',
  'sexual',
  'spam',
  'other',
] as const

export type ReportReason = (typeof REPORT_REASONS)[number]

export const MAX_REPORT_NOTE = 500

export function sendReport(input: {
  reportedUserId: number
  reason: ReportReason
  note?: string
  conversationId?: number
}): Promise<void> {
  return apiFetch<void>('/reports', {
    method: 'POST',
    body: JSON.stringify({
      reported_user_id: input.reportedUserId,
      reason: input.reason,
      note: input.note?.trim() || null,
      conversation_id: input.conversationId ?? null,
    }),
  })
}
