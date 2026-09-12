import { useNavigate } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { Button } from '../ui/Button'
import { EmptyState, SkeletonRows } from '../ui/States'
import { DropAmount } from '../ui/Drop'
import { IconDiscover, IconPersonFallback } from '../icons'
import { getRequestAction } from '../../lib/requestActions'
import { nextUtcMidnight } from '../../lib/dailyQuota'
import type { ChatSession, RequestActivity } from '../../lib/types'

interface MyRequestsViewProps {
  requests: RequestActivity[] | null
  sessions: ChatSession[] | null
  onCancel: (request: RequestActivity) => void
  onPay: (requestId: number) => void
  onBrowse: () => void
  payingId: number | null
}

/**
 * The Activity tab's Requests segment: what the user has asked other
 * people for, and what they can do about each one now.
 *
 * Every row ends in exactly ONE action, chosen by
 * lib/requestActions.ts — pay, open the chat, cancel, or nothing at all
 * when the answer was no. The previous version put "view offer" on every
 * row alongside that action, which meant two buttons where only one was
 * ever the point; tapping the row itself goes to the offer now.
 */
export function MyRequestsView({
  requests,
  sessions,
  onCancel,
  onPay,
  onBrowse,
  payingId,
}: MyRequestsViewProps) {
  const { t, i18n } = useTranslation()
  const navigate = useNavigate()

  if (requests === null || sessions === null) return <SkeletonRows count={3} />

  // Only requests this user SENT. A received one — someone asking for
  // one of their own offers — is answered on that offer's own page,
  // where accept and reject live; listing it here without those actions
  // was noise.
  const sent = requests.filter((r) => r.direction === 'sent')

  if (sent.length === 0) {
    return (
      <EmptyState
        icon={<IconDiscover size={24} />}
        title={t('activityPage.requestsEmpty')}
        text={t('activityPage.requestsEmptyHint')}
        actionLabel={t('activityPage.browseShowcase')}
        onAction={onBrowse}
      />
    )
  }

  return (
    <>
      <div className="ui-list">
        {sent.map((request) => {
          const action = getRequestAction(request, sessions)
          const reason = action.type === 'rejected' || action.type === 'cancelled' ? action.reason : null

          return (
            <div className="ac-request" key={request.id}>
              <button
                type="button"
                className="ui-row ui-row-avatar"
                onClick={() =>
                  navigate(`/offers/${request.offer_id}`, {
                    state: { backTo: 'activity-requests' },
                  })
                }
              >
                <span
                  className="ui-row-media ac-request-avatar"
                  onClick={(event) => {
                    // The face goes to the person; the rest of the row
                    // goes to the offer.
                    event.stopPropagation()
                    navigate(`/profiles/${request.counterpart_user_id}`, {
                      state: { backTo: 'activity-requests' },
                    })
                  }}
                >
                  {request.counterpart_avatar_url ? (
                    <img src={request.counterpart_avatar_url} alt="" />
                  ) : (
                    <IconPersonFallback size={22} />
                  )}
                </span>

                <span className="ui-row-main">
                  <span className="ui-row-title" dir="auto">
                    {request.counterpart_display_name}
                  </span>
                  <span className="ui-row-subtitle ac-request-offer">
                    <span className="ac-request-offer-title" dir="auto">
                      {request.offer_title}
                    </span>
                    <DropAmount
                      amount={request.offer_price_stars}
                      locale={i18n.language}
                      size={16}
                    />
                  </span>
                </span>

                <span className="ui-row-trailing">
                  <RequestStatus type={action.type} />
                </span>
              </button>

              {/* The reason someone said no is the most useful thing on
                  the row when there is one — it gets its own line rather
                  than being appended to a status string and truncated. */}
              {reason && <p className="ac-request-reason">{reason}</p>}

              {action.type !== 'rejected' && action.type !== 'cancelled' && (
                <div className="ac-request-action">
                  {action.type === 'waiting' && (
                    <Button variant="danger" size="sm" onClick={() => onCancel(request)}>
                      {t('requests.cancelButton')}
                    </Button>
                  )}
                  {action.type === 'pay' && (
                    <Button
                      variant="primary"
                      size="sm"
                      loading={payingId === request.id}
                      onClick={() => onPay(request.id)}
                    >
                      {t('requests.payButton')}
                    </Button>
                  )}
                  {action.type === 'session' && (
                    <Button
                      variant="secondary"
                      size="sm"
                      onClick={() => navigate(`/chat-sessions/${action.session.id}`)}
                    >
                      {t('requests.openSession')}
                    </Button>
                  )}
                </div>
              )}
            </div>
          )
        })}
      </div>

      {/* When the daily request quota resets, in the reader's OWN local
          time even though the boundary is a fixed UTC instant (see
          lib/dailyQuota.ts). It scrolls with the list rather than
          floating over it: it is a footnote, not an alert. */}
      <p className="ac-quota">
        {t('activityPage.quotaResetHint', {
          time: nextUtcMidnight(new Date()).toLocaleTimeString(i18n.language, {
            hour: '2-digit',
            minute: '2-digit',
          }),
        })}
      </p>
    </>
  )
}

/** One chip per outcome, using the shared status palette: waiting is
 *  neutral because nothing has gone wrong yet, and only a real refusal
 *  is red. */
function RequestStatus({ type }: { type: ReturnType<typeof getRequestAction>['type'] }) {
  const { t } = useTranslation()

  if (type === 'waiting') {
    return <span className="ui-status ui-status-neutral">{t('requests.statusWaiting')}</span>
  }
  if (type === 'rejected') {
    return <span className="ui-status ui-status-danger">{t('requests.statusRejected')}</span>
  }
  if (type === 'cancelled') {
    return <span className="ui-status ui-status-neutral">{t('requests.statusCancelled')}</span>
  }
  return <span className="ui-status ui-status-success">{t('requests.statusAccepted')}</span>
}
