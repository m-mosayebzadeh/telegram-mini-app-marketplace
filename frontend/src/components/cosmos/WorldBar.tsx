import { useLocation, useNavigate } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { useUnread } from '../../lib/useUnread'
import { useEcho } from '../../lib/echoStore'
import { useMe } from '../../lib/MeContext'
import { doorOf, echoDoorOf, type Door, type EchoDoor } from './worldBarDoors'

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

/** Sent when Sol is tapped while you are already in the world. */
export const HOME_EVENT = 'cos:home'

const PATH: Record<Door, string> = {
  talk: '/sky/talk',
  echo: '/echo',
  world: '/sky',
  events: '/events',
  me: '/profile',
}

function EchoMark({ state }: { state: EchoDoor }) {
  if (state === 'seeking') {
    return (
      <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true" className="cos-echo-mark is-seeking">
        <circle cx="12" cy="12" r="3" />
        <g className="cos-echo-orbit">
          <circle cx="12" cy="4.2" r="2.3" />
        </g>
      </svg>
    )
  }
  if (state === 'shut') {
    return (
      <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true" className="cos-echo-mark is-shut">
        <circle cx="5.5" cy="15.5" r="2.6" />
        <circle cx="18.5" cy="8.5" r="2.6" />
      </svg>
    )
  }
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true" className={`cos-echo-mark is-${state}`}>
      <g className="cos-echo-pair">
        <circle cx="7" cy="14" r="3" />
        <circle cx="17" cy="10" r="3" />
      </g>
    </svg>
  )
}

export function WorldBar() {
  const { t, i18n } = useTranslation()
  const navigate = useNavigate()
  const { pathname } = useLocation()
  const here = doorOf(pathname)
  const unread = useUnread()
  const echoDoor = echoDoorOf(useEcho())
  // Friend requests waiting: the only news "me" carries (section 32).
  const asking = useMe().me?.pending_friend_requests_count ?? 0

  function open(door: Door) {
    if (door === 'world' && here === 'world' && pathname === '/sky') {
      window.dispatchEvent(new Event(HOME_EVENT))
      return
    }
    navigator.vibrate?.(8)
    navigate(PATH[door])
  }

  const plain = (door: Exclude<Door, 'world'>, icon: React.ReactNode, extra?: React.ReactNode, state?: string) => (
    <button
      type="button"
      className={`cos-worldbar-door is-${door}`}
      aria-label={state ? `${t(`bar.${door}`)} · ${state}` : undefined}
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
      {plain('echo', <EchoMark state={echoDoor} />, null, t(`bar.echoState.${echoDoor}`))}
      <button
        type="button"
        className={`cos-worldbar-sol${here === 'world' ? ' is-here' : ''}`}
        aria-label={t('bar.world')}
        aria-current={here === 'world' ? 'page' : undefined}
        onClick={() => open('world')}
      />
      {plain('events', <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M12 3l2.6 5.6 6 .7-4.5 4.1 1.2 6L12 16.4 6.7 19.4l1.2-6L3.4 9.3l6-.7z" /></svg>)}
      {plain(
        'me',
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" aria-hidden="true"><circle cx="12" cy="12" r="8" /><circle cx="12" cy="12" r="3" fill="currentColor" /></svg>,
        asking > 0 ? (
          <span className="cos-worldbar-count" aria-label={t('bar.friendRequests', { count: asking })}>
            {asking.toLocaleString(i18n.language)}
          </span>
        ) : null,
      )}
    </nav>
  )
}
