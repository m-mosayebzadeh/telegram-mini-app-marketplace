import { useTranslation } from 'react-i18next'
import type { ChatSession } from '../../lib/types'

interface SessionDetailsPanelProps {
  session: ChatSession
  /** The current viewer's own user id — needed to tell "you closed this"
   * apart from "the other participant closed this", since ChatSessionOut
   * only ever carries the OTHER participant's id, not the viewer's own
   * (see lib/types.ts). */
  viewerId: number
  expanded: boolean
  /** Opens the end-session confirmation sheet — does NOT close the
   * session itself; see EndSessionConfirmSheet.tsx and
   * pages/ChatSessionDetail.tsx for where the real close call happens,
   * only after the user explicitly confirms. */
  onRequestClose: () => void
  onDispute: () => void
  canDispute: boolean
  actionMessage: string | null
}

/**
 * The collapsible "what is this session" panel — offer/price/expected
 * duration, my role, the transaction's settlement status, and the real
 * lifecycle actions (close / report a problem). Collapsed by default
 * (toggled from ChatHeader) so it doesn't compete for space with the
 * conversation itself, per the spec's "session details in a collapsible
 * panel, not always open" requirement.
 *
 * Close/dispute here are the SAME real backend actions the previous,
 * minimal chat session page already had (see
 * backend/app/chat_session/router.py) — this redesign only changes
 * where/how they're presented, not what they do.
 */
export function SessionDetailsPanel({
  session,
  viewerId,
  expanded,
  onRequestClose,
  onDispute,
  canDispute,
  actionMessage,
}: SessionDetailsPanelProps) {
  const { t } = useTranslation()

  if (!expanded) return null

  const canClose = session.status === 'open'

  return (
    <div className="hp-chat-details">
      <div className="hp-chat-details-row">
        <span className="hp-chat-details-label">{t('chatSession.offerTitle')}</span>
        <span className="hp-chat-details-value">{session.offer_title}</span>
      </div>
      <div className="hp-chat-details-row">
        <span className="hp-chat-details-label">{t('chatSession.priceLabel')}</span>
        <span className="hp-chat-details-value">{session.price_stars}</span>
      </div>
      <div className="hp-chat-details-row">
        {/* "Expected", never a countdown — display_duration_minutes is
            informational only (TECHNICAL_REQUIREMENTS.md section 3), the
            session itself never enforces or ends on it. */}
        <span className="hp-chat-details-label">{t('chatSession.expectedDuration')}</span>
        <span className="hp-chat-details-value">{session.display_duration_minutes}</span>
      </div>
      <div className="hp-chat-details-row">
        <span className="hp-chat-details-label">{t('chatSession.myRoleLabel')}</span>
        <span className="hp-chat-details-value">
          {session.my_role === 'buyer' ? t('chatSession.roleBuyer') : t('chatSession.roleProvider')}
        </span>
      </div>
      <div className="hp-chat-details-row">
        <span className="hp-chat-details-label">{t('chatSession.settlementLabel')}</span>
        <span className="hp-chat-details-value">
          {session.disputed
            ? t('chatSession.statusDisputed')
            : t(`chatSession.transactionStatus.${session.transaction_status}`)}
        </span>
      </div>

      {(canClose || canDispute) && (
        <div className="hp-chat-details-actions">
          {canClose && (
            <button className="hp-btn hp-btn-gradient" onClick={onRequestClose}>
              {t('chatSession.closeButton')}
            </button>
          )}
          {canDispute && (
            <button className="hp-btn hp-btn-outline hp-btn-wide" onClick={onDispute}>
              {t('chatSession.disputeButton')}
            </button>
          )}
        </div>
      )}

      {session.status === 'closed' && (
        <p className="hp-hint">
          {session.closed_by_user_id === viewerId
            ? t('chatSession.closedByYou')
            : t('chatSession.closedByOther')}
        </p>
      )}

      {actionMessage && <p className="hp-hint">{actionMessage}</p>}
    </div>
  )
}
