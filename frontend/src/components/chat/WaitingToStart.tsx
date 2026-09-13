import { useTranslation } from 'react-i18next'
import { IconClock } from '../icons'
import type { ChatSession } from '../../lib/types'

/**
 * A session that has been paid for and has not started.
 *
 * The most important state on this screen, and the one that says
 * something DIFFERENT to each side — so it is written out rather than
 * left to be inferred from an empty bar:
 *
 *   - The buyer needs to know they are not being charged for waiting,
 *     and that writing now is free. Without this, the natural thing to
 *     do — say hello — feels like it might be costing money.
 *   - The provider needs to know that their first message starts the
 *     clock. Without this, someone types "سلام" and starts a paid
 *     session they had not decided to start yet.
 *
 * It disappears the moment the session starts, so it costs the
 * conversation nothing once the conversation exists.
 */
export function WaitingToStart({ session }: { session: ChatSession }) {
  const { t } = useTranslation()
  const isProvider = session.my_role === 'provider'

  return (
    <div className={`wts${isProvider ? ' wts-provider' : ''}`} role="status">
      <span className="wts-icon">
        <IconClock size={20} />
      </span>
      <span className="wts-text">
        {isProvider
          ? t('chatSession.waitingProvider')
          : t('chatSession.waitingBuyer', { name: session.other_participant.display_name })}
      </span>
    </div>
  )
}
