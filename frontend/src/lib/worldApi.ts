import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { apiFetch } from './api'
import { fetchConversations, type Conversation } from './conversationApi'
import { subscribe } from './live'
import { buildNews, loadDismissed, saveDismissed, type NewsItem } from './news'
import { buildRelations, orderRelations, type Relation } from './relations'
import { dealWith, type Deal } from './deal'
import type { ChatSession, IncomingFollowRequest, RequestActivity } from './types'

/**
 * Everything the world's regions need to know about the people you deal
 * with, read from the server and kept fresh.
 *
 * Conversations refresh the moment a message arrives over the live
 * connection. Requests, sessions and follow requests have no live events,
 * so they refresh on a slow clock, when the app comes back into view, and
 * right after anything you do to them — which covers every change you
 * cause yourself, and most of the ones other people cause.
 */

const REFRESH_MS = 30_000

// ------------------------------------------------------------------ calls

export const fetchActivity = () => apiFetch<RequestActivity[]>('/requests/activity')
export const fetchMySessions = () => apiFetch<ChatSession[]>('/chat-sessions/mine')
export const fetchIncomingFollows = () => apiFetch<IncomingFollowRequest[]>('/follow/incoming-requests')

const post = <T>(path: string) => apiFetch<T>(path, { method: 'POST' })

/** Confirming an acceptance of your offer is, on the server, accepting the
 *  buyer's request. The product's word is "confirm" (section 30.19). */
export const confirmRequest = (id: number) => post(`/requests/${id}/accept`)
export const refuseRequest = (id: number) => post(`/requests/${id}/reject`)
export const withdrawRequest = (id: number) => post(`/requests/${id}/cancel`)
export const payRequest = (id: number) => post(`/requests/${id}/pay`)

export const acceptFollow = (userId: number) => post(`/follow/${userId}/accept`)
export const refuseFollow = (userId: number) => post(`/follow/${userId}/reject`)

export const fetchSession = (id: number) => apiFetch<ChatSession>(`/chat-sessions/${id}`)
export const stopAtBlockEnd = (id: number) => post<ChatSession>(`/chat-sessions/${id}/stop-at-block-end`)
export const keepGoing = (id: number) => apiFetch<ChatSession>(`/chat-sessions/${id}/stop-at-block-end`, { method: 'DELETE' })
export const askOneMoreBlock = (id: number) => post<ChatSession>(`/chat-sessions/${id}/extension`)
export const acceptOneMoreBlock = (id: number) => post<ChatSession>(`/chat-sessions/${id}/extension/accept`)
export const declineOneMoreBlock = (id: number) => post<ChatSession>(`/chat-sessions/${id}/extension/decline`)
export const releaseSession = (id: number) => post<ChatSession>(`/chat-sessions/${id}/confirm-settlement`)
export const disputeSession = (id: number) => post<ChatSession>(`/chat-sessions/${id}/dispute`)

/** The only thank-yous there are (the server refuses anything else). */
export const THANKS = ['heart', 'pray', 'handshake'] as const
export type Thanks = (typeof THANKS)[number]
export const sendThanks = (id: number, reaction: Thanks) =>
  apiFetch<ChatSession>(`/chat-sessions/${id}/thanks`, { method: 'POST', body: JSON.stringify({ reaction }) })

/** The Fluent picture for each thank-you, as the rest of the app shows
 *  emoji (TECHNICAL_REQUIREMENTS.md section 29.14). */
export const THANKS_IMAGE: Record<Thanks, string> = {
  heart: '/emoji/2764.webp',
  pray: '/emoji/1f64f.webp',
  handshake: '/emoji/1f91d.webp',
}

// ------------------------------------------------------------------- hook

export interface World {
  loaded: boolean
  error: string | null
  relations: Relation[]
  news: NewsItem[]
  sessions: ChatSession[]
  liveSession: ChatSession | null
  reload: () => Promise<void>
  dismiss: (key: string) => void
}

export function useWorld(): World {
  const [conversations, setConversations] = useState<Conversation[]>([])
  const [activity, setActivity] = useState<RequestActivity[]>([])
  const [sessions, setSessions] = useState<ChatSession[]>([])
  const [follows, setFollows] = useState<IncomingFollowRequest[]>([])
  const [dismissed, setDismissed] = useState<Set<string>>(() => loadDismissed())
  const [loaded, setLoaded] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const alive = useRef(true)

  const reload = useCallback(async () => {
    try {
      // Each source stands on its own: one failing must not blank the
      // others, so a missing follow list still leaves the stair working.
      const [c, a, s, f] = await Promise.allSettled([
        fetchConversations(), fetchActivity(), fetchMySessions(), fetchIncomingFollows(),
      ])
      if (!alive.current) return
      if (c.status === 'fulfilled') setConversations(c.value)
      if (a.status === 'fulfilled') setActivity(a.value)
      if (s.status === 'fulfilled') setSessions(s.value)
      if (f.status === 'fulfilled') setFollows(f.value)
      const failed = [c, a, s, f].find((r) => r.status === 'rejected') as PromiseRejectedResult | undefined
      setError(failed ? String(failed.reason?.message ?? failed.reason) : null)
    } finally {
      if (alive.current) setLoaded(true)
    }
  }, [])

  useEffect(() => {
    alive.current = true
    void reload()
    const timer = setInterval(() => void reload(), REFRESH_MS)
    const onVisible = () => { if (document.visibilityState === 'visible') void reload() }
    document.addEventListener('visibilitychange', onVisible)
    const unsubscribe = subscribe((event) => {
      if (event.type === 'message' || event.type === 'read' || event.type === 'ready') {
        fetchConversations().then((c) => { if (alive.current) setConversations(c) }).catch(() => {})
      }
    })
    return () => {
      alive.current = false
      clearInterval(timer)
      document.removeEventListener('visibilitychange', onVisible)
      unsubscribe()
    }
  }, [reload])

  const relations = useMemo(() => orderRelations(buildRelations(conversations, activity, sessions)), [conversations, activity, sessions])
  const news = useMemo(() => buildNews(relations, follows, sessions, dismissed), [relations, follows, sessions, dismissed])
  const liveSession = useMemo(() => sessions.find((s) => s.status === 'open') ?? null, [sessions])

  const dismiss = useCallback((key: string) => {
    setDismissed((prev) => {
      const next = new Set(prev)
      next.add(key)
      saveDismissed(next)
      return next
    })
  }, [])

  return { loaded, error, relations, news, sessions, liveSession, reload, dismiss }
}

// ------------------------------------------------------- one person's deal

/**
 * What is going on with one person besides talking, for their
 * conversation (lib/deal.ts decides; this only keeps it fresh).
 *
 * Refreshed on a clock and whenever a message arrives, because the things
 * that change a deal — a session starting with the offerer's first
 * message, a session ending, a block being added — mostly arrive together
 * with a message or at a moment the clock catches.
 */
export function useDeal(userId: number | null): { deal: Deal | null; sessions: ChatSession[]; reload: () => Promise<void> } {
  const [activity, setActivity] = useState<RequestActivity[]>([])
  const [sessions, setSessions] = useState<ChatSession[]>([])
  const alive = useRef(true)

  const reload = useCallback(async () => {
    const [a, s] = await Promise.allSettled([fetchActivity(), fetchMySessions()])
    if (!alive.current) return
    // Only a list is taken as an answer: this runs inside the conversation
    // screen, and a malformed reply must cost the card, never the screen.
    if (a.status === 'fulfilled' && Array.isArray(a.value)) setActivity(a.value)
    if (s.status === 'fulfilled' && Array.isArray(s.value)) setSessions(s.value)
  }, [])

  useEffect(() => {
    alive.current = true
    if (userId === null) return
    void reload()
    const timer = setInterval(() => void reload(), 20_000)
    const unsubscribe = subscribe((event) => {
      if (event.type === 'message' || event.type === 'ready') void reload()
    })
    return () => {
      alive.current = false
      clearInterval(timer)
      unsubscribe()
    }
  }, [userId, reload])

  const deal = useMemo(
    () => (userId === null ? null : dealWith(userId, activity, sessions)),
    [userId, activity, sessions],
  )
  return { deal, sessions, reload }
}
