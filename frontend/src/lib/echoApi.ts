/**
 * Echo — meeting somebody at random.
 *
 * The whole feature is one endpoint answered over and over. `status` says
 * where you are in it: shut, missing something, waiting, or sitting with
 * somebody. Nothing ticks on the server (TECHNICAL_REQUIREMENTS.md
 * section 28.1), so finding out you have been matched means asking, which
 * is why the waiting screen polls and nothing else does.
 */

import { apiFetch } from './api'

/** Answers to "who do you want to meet" — a mood for this search, never
 *  stored as a setting. `anyone` is both the default and the only value
 *  that can be paired with somebody who declined to state a gender. */
export const WANT_ANYONE = 'anyone'
export const WANT_MALE = 'male'
export const WANT_FEMALE = 'female'

/** The tags the server accepts, in the order they should be shown. Kept
 *  here rather than fetched: they change about once a year, and a list
 *  that arrives late means a form that jumps while somebody is reading
 *  it. `GET /random-chat/tags` exists and stays the source of truth if
 *  the two ever disagree. */
export const SEARCH_TAGS = [
  'music', 'film', 'books', 'games', 'sport', 'travel', 'food', 'art',
  'tech', 'study', 'work', 'startup', 'animals', 'nature', 'photography',
  'nightowl', 'deeptalk', 'smalltalk', 'advice', 'language',
] as const

/** At most three, because tags are openers rather than requirements —
 *  the point is having something to say, not narrowing a small pool. */
export const MAX_TAGS = 3

export interface EchoMatch {
  session_id: number
  conversation_id: number
  other_user_id: number
  display_name: string
  username: string | null
  avatar_url: string | null
  shared_tags: string[]
  /** False when the pool had nobody of the kind that was asked for. The
   *  screen says so rather than quietly handing over a mismatch. */
  gender_as_asked: boolean
  age_as_asked: boolean
  follow_status: 'none' | 'requested' | 'following'
}

export interface EchoSearch {
  wants_gender: string
  wants_age_min: number | null
  wants_age_max: number | null
  tags: string[]
}

export interface EchoStatus {
  /** The admin switch and the nightly window, already combined. */
  open_now: boolean
  minutes_until_open: number | null
  /** What the profile still owes before anyone can be matched: 'gender',
   *  'birth_year', or both. */
  missing: string[]
  suspended: boolean
  waiting: boolean
  waiting_since: string | null
  matched: EchoMatch | null
  /** Pre-fill for the form. Null the very first time. */
  last_search: EchoSearch | null
  /** Null means unlimited, which is where the cap starts. */
  remaining_today: number | null
}

/**
 * Minutes past midnight on this device's own clock.
 *
 * Sent with every search because the pool gives a small nudge to two
 * people awake at the same odd hour, and because the nightly window is
 * "ten at night wherever you are" rather than one moment worldwide
 * (section 28). The server stores no timezone at all.
 */
export function localMinuteNow(now: Date = new Date()): number {
  return now.getHours() * 60 + now.getMinutes()
}

export function fetchEchoStatus(): Promise<EchoStatus> {
  return apiFetch<EchoStatus>('/random-chat/status')
}

export function startEchoSearch(search: EchoSearch): Promise<EchoStatus> {
  return apiFetch<EchoStatus>('/random-chat/search', {
    method: 'POST',
    body: JSON.stringify({ ...search, local_minute: localMinuteNow() }),
  })
}

export function cancelEchoSearch(): Promise<void> {
  return apiFetch<void>('/random-chat/search', { method: 'DELETE' })
}

/** Leave the conversation. Both sides lose the messages — what is kept is
 *  the person, never the transcript (section 28.1). */
export function leaveEchoSession(sessionId: number): Promise<void> {
  return apiFetch<void>(`/random-chat/sessions/${sessionId}/leave`, { method: 'POST' })
}

export function keepEchoSession(sessionId: number): Promise<void> {
  return apiFetch<void>(`/random-chat/sessions/${sessionId}/keep`, { method: 'POST' })
}

export interface EchoFollowResult {
  /** True when they had already asked to follow you, so pressing it made
   *  a follow and a follow-back at once. */
  mutual: boolean
  follow_status: 'none' | 'requested' | 'following'
}

export function followFromEcho(sessionId: number): Promise<EchoFollowResult> {
  return apiFetch<EchoFollowResult>(`/random-chat/sessions/${sessionId}/follow`, {
    method: 'POST',
  })
}
