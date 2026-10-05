import { apiFetch } from './api'

/**
 * The account itself (section 32, step 4): eighteen or over, privacy,
 * blocked people, deleting the account, and "report a problem".
 */

/** "open" — anyone may start a conversation (the default, the freest);
 *  "friends" — only your friends. */
export type ChatDoor = 'open' | 'friends'

/** Who may see your list of friends. Everyone by default. */
export type FriendsSeenBy = 'everyone' | 'friends' | 'chosen' | 'nobody'

export interface Privacy {
  chat_door: ChatDoor
  /** Not shown as online, and not shown anybody else's — Telegram's rule. */
  hide_online: boolean
  friends_seen_by?: FriendsSeenBy
}

export function confirmAdult(): Promise<void> {
  return apiFetch<void>('/me/adult', { method: 'POST' })
}

export function fetchPrivacy(): Promise<Privacy> {
  return apiFetch<Privacy>('/me/privacy')
}

export function savePrivacy(privacy: Privacy): Promise<Privacy> {
  return apiFetch<Privacy>('/me/privacy', { method: 'PUT', body: JSON.stringify(privacy) })
}

export interface BlockedPerson {
  user_id: number
  display_name: string
  username: string | null
  avatar_url: string | null
}

export function fetchBlocked(): Promise<BlockedPerson[]> {
  return apiFetch<BlockedPerson[]>('/blocks')
}

export function blockPerson(userId: number): Promise<void> {
  return apiFetch<void>('/blocks', { method: 'POST', body: JSON.stringify({ user_id: userId }) })
}

export function unblockPerson(userId: number): Promise<void> {
  return apiFetch<void>(`/blocks/${userId}`, { method: 'DELETE' })
}

/** Deletes the account. The app asks twice before calling this. */
export function deleteAccount(): Promise<void> {
  return apiFetch<void>('/me?sure=true', { method: 'DELETE' })
}

export function sendFeedback(text: string, where: string | null): Promise<void> {
  return apiFetch<void>('/feedback', { method: 'POST', body: JSON.stringify({ text, where }) })
}

export interface FeedbackRow {
  id: number
  user_id: number
  display_name: string
  text: string
  where: string | null
  created_at: string
}

export function fetchFeedback(): Promise<FeedbackRow[]> {
  return apiFetch<FeedbackRow[]>('/admin/feedback')
}
