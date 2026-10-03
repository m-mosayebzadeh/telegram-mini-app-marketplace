import { apiFetch } from './api'

/**
 * Friends, two-way (section 32, step 4; backend/app/friends/router.py).
 * Every change is announced live ("friends"), so nothing here is asked on
 * a clock.
 */

export type FriendStatus = 'none' | 'requested' | 'incoming' | 'friends'

export interface FriendPerson {
  user_id: number
  display_name: string
  avatar_url: string | null
  /** Today's note, if they wrote one. */
  note: string | null
  /** A friend of yours too (only on somebody else's list). */
  mutual: boolean
}

export interface TheirFriends {
  /** False when their setting keeps the list from you: then nobody. */
  visible: boolean
  people: FriendPerson[]
}

export function askFriend(userId: number): Promise<{ status: FriendStatus }> {
  return apiFetch(`/friends/${userId}`, { method: 'POST' })
}

export function acceptFriend(userId: number): Promise<{ status: FriendStatus }> {
  return apiFetch(`/friends/${userId}/accept`, { method: 'POST' })
}

/** Says no, takes back a request, or unfriends. Nobody is told. */
export function endFriend(userId: number): Promise<void> {
  return apiFetch<void>(`/friends/${userId}`, { method: 'DELETE' })
}

export function fetchFriends(): Promise<FriendPerson[]> {
  return apiFetch<FriendPerson[]>('/friends')
}

export function fetchFriendRequests(): Promise<FriendPerson[]> {
  return apiFetch<FriendPerson[]>('/friends/requests')
}

/** Somebody you really talked with this week and are not friends with yet. */
export interface WeekPerson extends FriendPerson {
  /** Where a request between you stands: never "friends" here. */
  status: Exclude<FriendStatus, 'friends'>
}

/** The people of this week, for the empty half of "me" (section 32). */
export function fetchThisWeek(): Promise<WeekPerson[]> {
  return apiFetch<WeekPerson[]>('/friends/this-week')
}

export function fetchTheirFriends(userId: number): Promise<TheirFriends> {
  return apiFetch<TheirFriends>(`/profiles/${userId}/friends`)
}

/** The friends chosen to see your list ("people I choose"). */
export function fetchFriendsViewers(): Promise<number[]> {
  return apiFetch<number[]>('/me/friends-viewers')
}

export function saveFriendsViewers(userIds: number[]): Promise<number[]> {
  return apiFetch<number[]>('/me/friends-viewers', { method: 'PUT', body: JSON.stringify({ user_ids: userIds }) })
}
