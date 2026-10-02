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

/** The interests the server accepts, in the groups the picker shows them
 *  in (section 32). Kept here rather than fetched: they change rarely, and
 *  a list that arrives late means a form that jumps while somebody is
 *  reading it. The server's copy (backend/app/random_chat/tags.py) is the
 *  source of truth; the two must stay the same. */
export const TAG_GROUPS = {
  fun: ['music', 'film', 'art', 'photography', 'games'],
  learning: ['books', 'study', 'language', 'tech'],
  work: ['work', 'startup', 'advice'],
  life: ['sport', 'travel', 'food', 'nature', 'animals'],
  talk: ['nightowl', 'deeptalk', 'smalltalk'],
} as const satisfies Record<string, readonly string[]>

export type TagGroup = keyof typeof TAG_GROUPS
export const GROUPS = Object.keys(TAG_GROUPS) as TagGroup[]

/** Every interest, once, in the groups' order. */
export const SEARCH_TAGS: readonly string[] = GROUPS.flatMap((group) => TAG_GROUPS[group])

/** Which group an interest is in. */
export function groupOf(tag: string): TagGroup | undefined {
  return GROUPS.find((group) => (TAG_GROUPS[group] as readonly string[]).includes(tag))
}

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
  /** Their own line, for the "found" card. */
  tagline?: string | null
  /** When you met; "found" is shown only for a meeting that just happened. */
  started_at?: string | null
}

export interface EchoSearch {
  wants_gender: string
  wants_age_min: number | null
  wants_age_max: number | null
  tags: string[]
}

/**
 * Somebody found for you, held while you both decide (section 32). No name
 * and no photo: only their own line and what you share, so the one thing
 * the card lets you judge is whether there is something to talk about.
 */
export interface EchoProposal {
  id: number
  tagline: string | null
  shared_tags: string[]
  /** Groups both picked in, said only when no interest is shared. */
  shared_groups?: string[]
  expires_at: string
  /** The whole hold, for the ring that empties around the card. */
  seconds: number
  /** You have said "start" and are waiting for them. */
  accepted: boolean
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
  /** People here right now, and people waiting for somebody new — you
   *  included in both — the honest numbers the waiting screen is built from. */
  online_now?: number
  waiting_now?: number
  /** The panel's switch: false means the waiting screen shows no numbers. */
  show_counts?: boolean
  /** Somebody found for you and waiting for both answers. */
  proposal?: EchoProposal | null
  /** When an open Echo shuts, so the door changes by itself. */
  minutes_until_close?: number | null
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

/** Sends this device's own clock: whether Echo is open depends on the
 *  hour where the person is, not on one hour worldwide. */
export function fetchEchoStatus(): Promise<EchoStatus> {
  return apiFetch<EchoStatus>(`/random-chat/status?local_minute=${localMinuteNow()}`)
}

/** "Start". Once both have said it, the status carries the conversation. */
export function acceptEchoProposal(id: number): Promise<EchoStatus> {
  return apiFetch<EchoStatus>(`/random-chat/proposals/${id}/accept?local_minute=${localMinuteNow()}`, { method: 'POST' })
}

/** "No" — both go back to searching, and neither is told who said it. */
export function declineEchoProposal(id: number): Promise<EchoStatus> {
  return apiFetch<EchoStatus>(`/random-chat/proposals/${id}/decline?local_minute=${localMinuteNow()}`, { method: 'POST' })
}

export function startEchoSearch(search: EchoSearch): Promise<EchoStatus> {
  return apiFetch<EchoStatus>('/random-chat/search', {
    method: 'POST',
    body: JSON.stringify({ ...search, local_minute: localMinuteNow() }),
  })
}

/** One interest in tonight's order: `tonight` when at least three people
 *  in Echo right now chose it. */
export interface TonightTag {
  tag: string
  tonight: boolean
}

/** Every interest, the ones most chosen in Echo right now first. */
export function fetchTonightTags(): Promise<TonightTag[]> {
  return apiFetch<TonightTag[]>('/random-chat/tags/tonight')
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
