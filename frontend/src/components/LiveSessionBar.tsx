import { useCallback, useEffect, useState } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import type { TFunction } from 'i18next'
import { apiFetch } from '../lib/api'
import type { ChatSession } from '../lib/types'

/** How often the countdown redraws. The end time comes from the server once;
 *  only the text between ticks is local, so a minute is plenty. */
const TICK_MS = 30_000

function remainingLabel(endsAt: string | null, t: TFunction): string {
  if (!endsAt) return ''
  const msLeft = new Date(endsAt).getTime() - Date.now()
  if (msLeft <= 0) return t('liveSession.endingNow')
  const minutes = Math.ceil(msLeft / 60_000)
  return t('liveSession.minutesLeft', { minutes })
}

/**
 * The way back into a conversation that is still running, from anywhere in the
 * app.
 *
 * A session holds the buyer's money and the provider's time, and either of
 * them may step out of the chat for a moment — to check their wallet, to
 * answer something else, or because the app was closed or crashed. Without a
 * standing way back, the only route is remembering to go and look for it.
 *
 * This is the pattern a phone already uses for a call in progress: a thin bar
 * that says who and how long, and returns you with one tap. It is deliberately
 * not a floating bubble — a bubble sits on top of the content, has nowhere to
 * put the remaining time, and lands in the same corner as the primary action
 * the design system reserves for the thumb.
 *
 * The state comes from the server on every navigation, so it is correct after
 * a reopen with nothing remembered locally. It hides itself on the chat screen
 * — you are already there.
 */
export function LiveSessionBar() {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const location = useLocation()
  const [session, setSession] = useState<ChatSession | null>(null)
  const [, setTick] = useState(0)

  const onChatScreen = location.pathname.startsWith('/chat-sessions/')

  const load = useCallback(() => {
    if (onChatScreen) {
      setSession(null)
      return
    }
    apiFetch<ChatSession | null>('/chat-sessions/live')
      .then(setSession)
      // Silent: a bar that cannot load is simply absent, and the next
      // navigation tries again. It must never take a screen down with it.
      .catch(() => setSession(null))
  }, [onChatScreen])

  useEffect(load, [load, location.pathname])

  useEffect(() => {
    if (!session) return
    const timer = setInterval(() => setTick((n) => n + 1), TICK_MS)
    return () => clearInterval(timer)
  }, [session])

  if (!session) return null

  const waiting = session.started_at === null
  const name = session.other_participant.display_name

  return (
    <button
      className="lv-bar"
      onClick={() => navigate(`/chat-sessions/${session.id}`)}
      aria-label={t('liveSession.returnTo', { name })}
    >
      <span className="lv-bar-dot" aria-hidden="true" />
      <span className="lv-bar-name">{name}</span>
      <span className="lv-bar-status">
        {waiting ? t('liveSession.waitingToStart') : remainingLabel(session.ends_at, t)}
      </span>
      <span className="lv-bar-chevron" aria-hidden="true">
        ›
      </span>
    </button>
  )
}
