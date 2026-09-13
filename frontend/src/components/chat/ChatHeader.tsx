import { useTranslation } from 'react-i18next'
import { IconBack, IconMore, IconPersonFallback } from '../icons'
import type { ChatSession } from '../../lib/types'

interface ChatHeaderProps {
  session: ChatSession
  onBack: () => void
  /** Opens the session sheet — the details, the money, the real actions. */
  onOpenDetails: () => void
  onOpenProfile: () => void
}

/**
 * The chat screen's top bar.
 *
 * Rebuilt. What it used to be: a back chevron typed as "‹", an avatar, a
 * name, a green status pill, a running timer, a "⌄" details toggle and a
 * "⋯" overflow — six controls and two readouts crammed into 56 pixels,
 * with the timer counting up from the moment the money was reserved even
 * on a session that had not started.
 *
 * Now it is one line: who you are talking to, how to leave, and one way
 * in to everything else. Specifically:
 *
 *   - Time belongs to the block bar directly below, which owns it and
 *     shows it against the blocks it is spending. A second clock here
 *     was both duplication and, before the session started, a lie.
 *   - The status is a caption under the name rather than a coloured
 *     pill. "Open" is the ordinary case; a pill makes the ordinary case
 *     the loudest thing on the screen.
 *   - The details toggle is gone. Tapping the block bar opens them,
 *     which is where someone already looks when they want to know about
 *     the session.
 *   - The glyphs are real icons from the set, so they take stroke
 *     width, size and alignment from the same place as every other icon
 *     in the product.
 */
export function ChatHeader({ session, onBack, onOpenDetails, onOpenProfile }: ChatHeaderProps) {
  const { t } = useTranslation()

  const state = session.disputed
    ? t('chatSession.statusDisputed')
    : session.status === 'open'
      ? t('chatSession.statusOpen')
      : t('chatSession.statusClosed')

  return (
    <header className="ch-header">
      <button className="ui-header-slot ui-header-back" onClick={onBack} aria-label={t('common.back')}>
        <IconBack size={22} />
      </button>

      {/* The face and the name go to the person. The session is a
          different subject and has its own way in. */}
      <button className="ch-identity" onClick={onOpenProfile}>
        <span className="ch-avatar">
          {session.other_participant.avatar_url ? (
            <img src={session.other_participant.avatar_url} alt="" />
          ) : (
            <IconPersonFallback size={20} />
          )}
        </span>
        <span className="ch-identity-text">
          <span className="ch-name" dir="auto">
            {session.other_participant.display_name}
          </span>
          <span className={`ch-state${session.disputed ? ' ch-state-alert' : ''}`}>{state}</span>
        </span>
      </button>

      <button
        className="ui-header-slot"
        onClick={onOpenDetails}
        aria-label={t('chatSession.detailsToggle')}
      >
        <IconMore size={22} />
      </button>
    </header>
  )
}
