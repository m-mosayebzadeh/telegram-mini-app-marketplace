import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Avatar } from '@telegram-apps/telegram-ui'
import { formatElapsedTime } from '../../lib/chatTime'
import type { ChatSession } from '../../lib/types'

interface ChatHeaderProps {
  session: ChatSession
  onBack: () => void
  detailsOpen: boolean
  onToggleDetails: () => void
  moreMenuOpen: boolean
  onToggleMoreMenu: () => void
  onReportClick: () => void
  onBlockClick: () => void
}

/**
 * The chat screen's sticky top bar: back button, the other participant's
 * avatar/name, a live elapsed-time readout, a status pill, and the
 * toggle for the collapsible session-details panel below it (see
 * SessionDetailsPanel.tsx).
 *
 * The timer counts UP from opened_at and never counts down or implies a
 * deadline — TECHNICAL_REQUIREMENTS.md section 3 is explicit that a
 * session never auto-closes on elapsed time, so this is purely an
 * informational "how long so far" readout, the same idea as a phone
 * call's duration display.
 */
export function ChatHeader({
  session,
  onBack,
  detailsOpen,
  onToggleDetails,
  moreMenuOpen,
  onToggleMoreMenu,
  onReportClick,
  onBlockClick,
}: ChatHeaderProps) {
  const { t } = useTranslation()

  // Blocking is explicitly disallowed while a transaction is still
  // active (spec rule) — allowed again once the session is closed. No
  // real blocking system exists anywhere in this app yet (see
  // ProfileHeader.tsx's own inert Block entry), so this only controls
  // whether the menu item is enabled, not any actual blocking behavior.
  const canBlock = session.status !== 'open'

  // A closed session's timer is frozen at its own closed_at (the total
  // duration it was open for) rather than still ticking against "now" —
  // ticking a closed conversation's clock forward would be misleading.
  const isOpen = session.status === 'open'
  const [now, setNow] = useState(() => new Date())

  useEffect(() => {
    if (!isOpen) return
    // Once a second is plenty for a stopwatch-style MM:SS readout —
    // no need for anything finer-grained.
    const interval = setInterval(() => setNow(new Date()), 1000)
    return () => clearInterval(interval)
  }, [isOpen])

  const elapsed = formatElapsedTime(session.opened_at, isOpen ? now : new Date(session.closed_at!))

  // The status pill folds the richer state model from
  // TECHNICAL_REQUIREMENTS.md section 12 (open/closed/disputed) down to
  // one label + color, computed from fields the backend already sends
  // (status, disputed) rather than inventing any new backend state.
  const pillLabel = session.disputed
    ? t('chatSession.statusDisputed')
    : isOpen
      ? t('chatSession.statusOpen')
      : t('chatSession.statusClosed')
  const pillClass = session.disputed
    ? 'hp-chat-status-pill hp-chat-status-disputed'
    : isOpen
      ? 'hp-chat-status-pill hp-chat-status-open'
      : 'hp-chat-status-pill hp-chat-status-closed'

  return (
    <div className="hp-chat-header">
      <button className="hp-chat-back" onClick={onBack} aria-label={t('common.back')}>
        ‹
      </button>

      <button className="hp-chat-header-identity" onClick={onToggleDetails}>
        <Avatar
          size={40}
          src={session.other_participant.avatar_url ?? undefined}
          acronym={session.other_participant.display_name.slice(0, 1).toUpperCase()}
        />
        <div className="hp-chat-header-text">
          <span className="hp-chat-header-name">{session.other_participant.display_name}</span>
          <span className="hp-chat-header-meta">
            <span className={pillClass}>{pillLabel}</span>
            <span className="hp-chat-timer">{elapsed}</span>
          </span>
        </div>
      </button>

      <button
        className={`hp-chat-details-toggle ${detailsOpen ? 'hp-chat-details-toggle-open' : ''}`}
        onClick={onToggleDetails}
        aria-label={t('chatSession.detailsToggle')}
        aria-expanded={detailsOpen}
      >
        ⌄
      </button>

      <div className="hp-chat-more-wrap">
        <button className="hp-chat-details-toggle" onClick={onToggleMoreMenu} aria-label={t('chatSession.moreButton')}>
          ⋯
        </button>
        {moreMenuOpen && (
          <div className="hp-menu hp-chat-more-menu">
            <button className="hp-menu-item" onClick={onReportClick}>
              {t('chatSession.reportButton')}
            </button>
            <button className="hp-menu-item" onClick={onBlockClick} disabled={!canBlock}>
              {t('chatSession.blockButton')}
              {!canBlock && <span className="hp-hint"> — {t('chatSession.blockDisabledHint')}</span>}
            </button>
          </div>
        )}
      </div>
    </div>
  )
}
