import { useTranslation } from 'react-i18next'
import { Sheet } from '../ui/Sheet'
import { Button } from '../ui/Button'
import { StatList, type Stat } from '../ui/StatList'
import { DropAmount } from '../ui/Drop'
import { IconBan, IconFlag } from '../icons'
import type { ChatSession } from '../../lib/types'

interface SessionSheetProps {
  session: ChatSession
  viewerId: number
  onClose: () => void
  /** Opens the confirmation — never closes the session directly. */
  onRequestEnd: () => void
  onDispute: () => void
  onReport: () => void
  onBlock: () => void
  canDispute: boolean
}

/**
 * Everything about the session that is not the conversation.
 *
 * This used to be a panel that expanded INSIDE the screen, pushing the
 * messages down far enough that the empty-state text ended up below it.
 * A sheet is the design system's own answer to "a short thing to look at
 * while staying where you are": the conversation stays visible behind
 * it, nothing is displaced, and it goes away with a tap anywhere.
 *
 * Two things it also fixes outright:
 *
 *   - The expected duration was printed in SECONDS under a label that
 *     said minutes — 2400 where it meant 40.
 *   - The settlement status rendered "chatSession.transactionStatus.null"
 *     on a live session, because a session has no transaction until it
 *     closes and there is no translation for null. A session still
 *     running is not "settled: null"; it has nothing to settle yet.
 */
export function SessionSheet({
  session,
  viewerId,
  onClose,
  onRequestEnd,
  onDispute,
  onReport,
  onBlock,
  canDispute,
}: SessionSheetProps) {
  const { t, i18n } = useTranslation()

  const isOpen = session.status === 'open'
  // Blocking is disallowed while money is still in play, and allowed once
  // the session is over.
  const canBlock = !isOpen

  const stats: Stat[] = [
    { label: t('chatSession.offerTitle'), value: session.offer_title },
    {
      label: t('chatSession.priceLabel'),
      value: <DropAmount amount={session.price_drops} locale={i18n.language} size={16} />,
      note: t('chatSession.priceNote', {
        blocks: session.reserved_blocks,
        drops: session.block_price_drops,
      }),
    },
    {
      label: t('chatSession.sessionLength'),
      value: t('offers.minutesUnitValue', {
        minutes: Math.round(session.session_duration_seconds / 60),
      }),
      note: t('chatSession.blockNote', {
        minutes: Math.round(session.block_duration_seconds / 60),
      }),
    },
    {
      label: t('chatSession.myRoleLabel'),
      value:
        session.my_role === 'buyer' ? t('chatSession.roleBuyer') : t('chatSession.roleProvider'),
    },
    {
      label: t('chatSession.settlementLabel'),
      value: settlementLabel(session, t),
    },
  ]

  return (
    <Sheet title={t('chatSession.detailsToggle')} onClose={onClose}>
      <StatList stats={stats} />

      {session.status === 'closed' && (
        <p className="cs-closed-note">
          {session.closed_by_user_id === viewerId
            ? t('chatSession.closedByYou')
            : t('chatSession.closedByOther')}
        </p>
      )}

      {/* Report and block are about the PERSON; ending is about the
          session. They are separated because confusing the two is how
          someone ends a conversation when they meant to report it. */}
      <div className="ui-list cs-actions">
        <button className="ui-row" onClick={onReport}>
          <span className="ui-row-media ui-row-media-plain">
            <IconFlag size={20} />
          </span>
          <span className="ui-row-main">
            <span className="ui-row-title">{t('chatSession.reportButton')}</span>
          </span>
        </button>

        <button className="ui-row" onClick={onBlock} disabled={!canBlock}>
          <span className="ui-row-media ui-row-media-plain">
            <IconBan size={20} />
          </span>
          <span className="ui-row-main">
            <span className="ui-row-title">{t('chatSession.blockButton')}</span>
            {!canBlock && (
              <span className="ui-row-subtitle">{t('chatSession.blockDisabledHint')}</span>
            )}
          </span>
        </button>
      </div>

      {/* Ending is irreversible and it is not what most people opened
          this sheet for, so it sits at the bottom past everything else
          and is a danger action rather than a filled accent block. */}
      {(isOpen || canDispute) && (
        <div className="cs-end">
          {isOpen && (
            <Button variant="danger" size="md" block onClick={onRequestEnd}>
              {t('chatSession.closeButton')}
            </Button>
          )}
          {canDispute && (
            <Button variant="secondary" size="md" block onClick={onDispute}>
              {t('chatSession.disputeButton')}
            </Button>
          )}
        </div>
      )}
    </Sheet>
  )
}

/**
 * What there is to say about settlement right now.
 *
 * A running session has no transaction at all — money is reserved, not
 * spent — so it says so, rather than looking up a translation for null
 * and printing the key.
 */
function settlementLabel(
  session: ChatSession,
  t: (key: string, args?: Record<string, unknown>) => string,
): string {
  if (session.disputed) return t('chatSession.statusDisputed')
  if (session.status === 'open') return t('chatSession.settlementNotYet')
  if (session.transaction_status == null) return t('chatSession.settlementNothingOwed')
  return t(`chatSession.transactionStatus.${session.transaction_status}`)
}
