import { useEffect, useState } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { fetchConversations } from '../../lib/conversationApi'
import { subscribe } from '../../lib/live'

/**
 * The five doors along the bottom (TECHNICAL_REQUIREMENTS.md section 32).
 *
 * The simplified world: every way of getting around is one plain tap, with
 * nothing to learn. Conversations, Echo, events and you, with Sol in the
 * middle — and Sol always means the world. Tapped anywhere else it brings
 * you back to the world; tapped in the world it brings you home to the
 * middle of it (the world screen listens for HOME_EVENT).
 *
 * It replaces the hold-and-sweep menu on Sol: beautiful, but one more way
 * of working that every newcomer had to learn before they could talk to
 * anybody.
 */

export type Door = 'talk' | 'echo' | 'world' | 'events' | 'me'

/** Sent when Sol is tapped while you are already in the world. */
export const HOME_EVENT = 'cos:home'

/** Which door a path belongs to, or null where the bar is not shown. */
export function doorOf(pathname: string): Door | null {
  if (pathname === '/sky/talk') return 'talk'
  if (pathname === '/sky' || pathname.startsWith('/sky/')) return 'world'
  if (pathname === '/echo') return 'echo'
  if (pathname === '/events') return 'events'
  if (pathname === '/profile') return 'me'
  return null
}

const PATH: Record<Door, string> = {
  talk: '/sky/talk',
  echo: '/echo',
  world: '/sky',
  events: '/events',
  me: '/profile',
}

/**
 * How many conversations have something unread, for the dot on the door.
 * Asked again when a message arrives and on a slow clock; the first page
 * of conversations is enough, since unread ones sort to the top.
 */
function useUnread(): number {
  const [count, setCount] = useState(0)
  useEffect(() => {
    let alive = true
    const read = () =>
      fetchConversations()
        .then((list) => { if (alive && Array.isArray(list)) setCount(list.filter((c) => c.unread).length) })
        .catch(() => {})
    void read()
    const timer = setInterval(read, 30_000)
    const unsubscribe = subscribe((event) => {
      if (event.type === 'message' || event.type === 'read' || event.type === 'ready') void read()
    })
    return () => {
      alive = false
      clearInterval(timer)
      unsubscribe()
    }
  }, [])
  return count
}

export function WorldBar() {
  const { t, i18n } = useTranslation()
  const navigate = useNavigate()
  const { pathname } = useLocation()
  const here = doorOf(pathname)
  const unread = useUnread()

  function open(door: Door) {
    if (door === 'world' && here === 'world' && pathname === '/sky') {
      window.dispatchEvent(new Event(HOME_EVENT))
      return
    }
    navigator.vibrate?.(8)
    navigate(PATH[door])
  }

  const plain = (door: Exclude<Door, 'world'>, icon: React.ReactNode, extra?: React.ReactNode) => (
    <button
      type="button"
      className={`cos-worldbar-door is-${door}`}
      aria-current={here === door ? 'page' : undefined}
      onClick={() => open(door)}
    >
      {icon}
      <span>{t(`bar.${door}`)}</span>
      {extra}
    </button>
  )

  return (
    <nav className="cos-worldbar" aria-label={t('bar.label')} data-chrome>
      {plain(
        'talk',
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M4 12a8 8 0 1 1 3.5 6.6L4 20l1.3-3.6A8 8 0 0 1 4 12z" /></svg>,
        unread > 0 ? (
          <span className="cos-worldbar-count" aria-label={t('bar.unread', { count: unread })}>
            {unread.toLocaleString(i18n.language)}
          </span>
        ) : null,
      )}
      {plain('echo', <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><circle cx="7" cy="14" r="3" /><circle cx="17" cy="10" r="3" /></svg>)}
      <button
        type="button"
        className={`cos-worldbar-sol${here === 'world' ? ' is-here' : ''}`}
        aria-label={t('bar.world')}
        aria-current={here === 'world' ? 'page' : undefined}
        onClick={() => open('world')}
      />
      {plain('events', <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M12 3l2.6 5.6 6 .7-4.5 4.1 1.2 6L12 16.4 6.7 19.4l1.2-6L3.4 9.3l6-.7z" /></svg>)}
      {plain('me', <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" aria-hidden="true"><circle cx="12" cy="12" r="8" /><circle cx="12" cy="12" r="3" fill="currentColor" /></svg>)}
    </nav>
  )
}
