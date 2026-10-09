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
  /** When they were last here, roughly — never an exact time. */
  /** "recently" when either side hides being online (section 32). */
  seen?: 'now' | 'minutes' | 'hours' | 'days' | 'long' | 'recently'
  /** Cosmos Team (section 37): the app itself writing to you — no profile,
   *  no presence, no place in the world, its own mark. */
  team?: boolean
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
  /** Kept out of the unread number on the conversations door. */
  muted?: boolean
  /** Pinned to the top of the list; the server sends pinned ones first. */
  pinned?: boolean
  unread: boolean
  /** How many messages from the others are unread. */
  unread_count?: number
  /** How the two of you met: Echo made the thread, or a hello from the world. */
  origin?: 'world' | 'echo'
  last_text: string | null
  /** How far anybody else has read. Your messages up to here show two
   *  ticks. */
  others_read_at: string | null
  /** Staff answering as Cosmos Team (section 43): the team's id, which
   *  the conversation screen treats as "me". Absent everywhere else. */
  acting_as?: number | null
  support?: SupportInfo | null
}

/** What staff see about a team conversation they answer. Never shown to
 *  the person. */
export interface SupportInfo {
  /** Who is answering it now, or null when it is free. */
  holder_name: string | null
  held_by_me: boolean
  /** Handed over by the owner: holds until that person answers. */
  handed: boolean
  /** The owner may hand it to somebody. */
  can_hand: boolean
  language: string | null
  joined_at: string | null
  /** What the team last told them: "new_sign_in", "notice", or null. */
  last_notice: string | null
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
  /** The note of the day this message answers, copied by the server when
   *  it was sent (section 32). */
  note_quote?: string | null
  reactions?: Reaction[]
  /** What a Cosmos Team message offers to do: "close_session:<id>". */
  action?: string | null
  /** For "close_session": whether that session is still open. */
  action_open?: boolean | null
  /** Which staff member wrote a team answer — only ever for the owner. */
  staff_name?: string | null
}

/** Every thread you are in, most recent first. */
export function fetchConversations(page?: { limit: number; offset?: number }): Promise<Conversation[]> {
  if (!page) return apiFetch<Conversation[]>('/conversations')
  return apiFetch<Conversation[]>(`/conversations?limit=${page.limit}&offset=${page.offset ?? 0}`)
}

/** Pins a chat to the top of the list, or unpins it. At most five: the
 *  sixth is refused with the reason "pin_limit". */
export function setConversationPinned(id: number, pinned: boolean): Promise<void> {
  return apiFetch<void>(`/conversations/${id}/pin?pinned=${pinned}`, { method: 'POST' })
}

/** Moves a chat into the archive, or back out of it. */
export function setConversationArchived(id: number, archived: boolean): Promise<void> {
  return apiFetch<void>(`/conversations/${id}/archive?archived=${archived}`, { method: 'POST' })
}

/** The archived chats. */
export function fetchArchivedConversations(): Promise<Conversation[]> {
  return apiFetch<Conversation[]>('/conversations?archived=true')
}

/** Mutes or unmutes a chat, for you alone. */
export function setConversationMuted(id: number, muted: boolean): Promise<void> {
  return apiFetch<void>(`/conversations/${id}/mute?muted=${muted}`, { method: 'POST' })
}

/** Clears the history: the chat stays in the list, empty. With
 *  `forEveryone`, the other person's copy is cleared too. */
export function clearConversationHistory(id: number, forEveryone: boolean): Promise<void> {
  return apiFetch<void>(`/conversations/${id}/clear?for_everyone=${forEveryone}`, { method: 'POST' })
}

/** Deletes the chat: cleared, and out of the list until somebody writes
 *  again. With `forEveryone`, for the other person as well. */
export function deleteConversation(id: number, forEveryone: boolean): Promise<void> {
  return apiFetch<void>(`/conversations/${id}?for_everyone=${forEveryone}`, { method: 'DELETE' })
}

/**
 * How many conversations have something unread, across all of them — not
 * only the page the list has loaded. The door and the list's header both
 * show this, so they can never disagree.
 */
export function fetchUnreadCount(): Promise<number> {
  return apiFetch<{ conversations: number }>('/conversations/unread').then((r) => r.conversations)
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

/** How many strangers you can still meet today, across "say hello" and
 *  Echo (section 30.21). */
export function fetchNewPeopleLeft(): Promise<{ limit: number; left: number }> {
  return apiFetch<{ limit: number; left: number }>('/conversations/new-people')
}

export function fetchConversation(id: number): Promise<Conversation> {
  return apiFetch<Conversation>(`/conversations/${id}`)
}

export function fetchMessages(id: number): Promise<ConversationMessage[]> {
  return apiFetch<ConversationMessage[]>(`/conversations/${id}/messages`)
}

/** What the conversation screen is opened with when somebody tapped a
 *  note of the day to answer it (section 32). Passed as router state. */
export interface NoteReplyState {
  noteReply?: { note: string }
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
  /** Answering the other person's note of the day: the server copies the
   *  note itself, so only "yes, it answers the note" is sent. */
  toNote = false,
): Promise<ConversationMessage> {
  const body = new FormData()
  body.append('type', 'text')
  body.append('text', text)
  body.append('client_id', clientId)
  if (replyToId) body.append('reply_to_id', String(replyToId))
  if (toNote) body.append('to_note', 'true')
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

/** Settings → "contact support": your conversation with Cosmos Team,
 *  started if it never was (section 43). */
export function openTeamConversation(): Promise<Conversation> {
  return apiFetch<Conversation>('/conversations/team', { method: 'POST' })
}

/* ---- Support (section 43): the team conversations, for staff ---------- */

/** The conversations people have with Cosmos Team, newest first, from the
 *  team's side. Only for staff with the support permission. */
export function fetchSupportConversations(page?: { limit: number; offset?: number }): Promise<Conversation[]> {
  const query = page ? `?limit=${page.limit}&offset=${page.offset ?? 0}` : ''
  return apiFetch<Conversation[]>(`/support/conversations${query}`)
}

/** How many of them wait for an answer. */
export async function fetchSupportUnread(): Promise<number> {
  return (await apiFetch<{ conversations: number }>('/support/unread')).conversations
}

/** Taken as somebody starts writing; refused (409, reason "support_held")
 *  while another staff member holds it. */
export function claimSupport(id: number): Promise<void> {
  return apiFetch<void>(`/support/conversations/${id}/claim`, { method: 'POST' })
}

/** The owner gives a conversation to one staff member, or frees it (null). */
export function handSupport(id: number, userId: number | null): Promise<void> {
  return apiFetch<void>(`/support/conversations/${id}/hand`, { method: 'POST', body: JSON.stringify({ user_id: userId }) })
}

export function fetchSupportStaff(): Promise<{ user_id: number; display_name: string }[]> {
  return apiFetch('/support/staff')
}
