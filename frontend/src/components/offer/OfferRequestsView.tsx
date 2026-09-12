import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { Button } from '../ui/Button'
import { Sheet } from '../ui/Sheet'
import { EmptyState, SkeletonRows } from '../ui/States'
import { DropAmount } from '../ui/Drop'
import { IconChevron, IconPersonFallback, IconUsers } from '../icons'
import type { ChatSession, IncomingRequest, Offer } from '../../lib/types'

interface OfferRequestsViewProps {
  offer: Offer
  /** null while loading — the skeleton, not an empty list. */
  requests: IncomingRequest[] | null
  sessions: ChatSession[] | null
  onAccept: (requestId: number) => void
  onReject: (requestId: number, reason: string) => void
  /** The request currently being accepted or rejected, so only that
   *  row's buttons go into their loading state. */
  busyRequestId: number | null
}

/**
 * What the OWNER sees on their own offer: the people who have asked for
 * it, and a decision on each.
 *
 * The previous version asked for a rejection reason through
 * `window.prompt`. That is the browser's own dialog: it cannot be
 * styled, it looks nothing like the app around it, and inside a
 * Telegram mini app it reads as the page having gone wrong. It is a
 * sheet now, like every other short form in the product.
 */
export function OfferRequestsView({
  offer,
  requests,
  sessions,
  onAccept,
  onReject,
  busyRequestId,
}: OfferRequestsViewProps) {
  const { t, i18n } = useTranslation()
  const navigate = useNavigate()
  const [rejecting, setRejecting] = useState<IncomingRequest | null>(null)
  const [reason, setReason] = useState('')

  const pending = requests?.filter((r) => r.status === 'pending') ?? []

  return (
    <>
      {/* What the offer is, kept to one line: the owner wrote it and
          does not need it read back to them. The requests are the page. */}
      <section className="of-own-summary">
        <span className="of-own-title" dir="auto">
          {offer.title}
        </span>
        <span className="of-own-meta">
          <DropAmount amount={offer.price_stars} locale={i18n.language} size={16} />
          <span className="of-own-dot" aria-hidden="true" />
          <span className="tabular">
            {t('discover.minutes', { minutes: offer.display_duration_minutes })}
          </span>
          <span className="of-own-dot" aria-hidden="true" />
          <span>
            {offer.status === 'active' ? t('offers.statusActive') : t('offers.statusInactive')}
          </span>
        </span>
      </section>

      <section className="ui-section">
        <h2 className="ui-section-title">
          {t('offers.incomingRequestsTitle')}
          {pending.length > 0 && <span className="ui-badge">{pending.length.toLocaleString(i18n.language)}</span>}
        </h2>

        {requests === null ? (
          <SkeletonRows count={2} />
        ) : requests.length === 0 ? (
          <EmptyState
            icon={<IconUsers size={24} />}
            title={t('offers.noIncomingRequests')}
            text={t('offers.noIncomingRequestsHint')}
          />
        ) : (
          <div className="ui-list">
            {requests.map((request) => {
              // A session exists the instant payment succeeds (see
              // backend/app/request/router.py's pay_for_request), so
              // "a session exists" and "this was paid for" are the same
              // fact — and this is the provider's own way in.
              const session = sessions?.find((s) => s.request_id === request.id)
              const busy = busyRequestId === request.id

              return (
                <div className="of-request" key={request.id}>
                  <button
                    type="button"
                    className="ui-row ui-row-avatar of-request-person"
                    onClick={() => navigate(`/profiles/${request.buyer_id}`)}
                  >
                    <span className="ui-row-media">
                      {request.buyer_avatar_url ? (
                        <img src={request.buyer_avatar_url} alt="" />
                      ) : (
                        <IconPersonFallback size={22} />
                      )}
                    </span>
                    <span className="ui-row-main">
                      <span className="ui-row-title" dir="auto">
                        {request.buyer_display_name}
                      </span>
                      {request.buyer_username && (
                        <span className="ui-row-subtitle">@{request.buyer_username}</span>
                      )}
                    </span>
                    <span className="ui-row-trailing">
                      <IconChevron size={20} className="ui-row-chevron" />
                    </span>
                  </button>

                  {/* Only a pending request asks anything of the owner.
                      Accept is primary because it is the outcome both
                      sides came here for; reject is a plain danger
                      action, never a filled red block. */}
                  {request.status === 'pending' && (
                    <div className="ui-btn-row of-request-actions">
                      <Button
                        variant="danger"
                        size="sm"
                        disabled={busy}
                        onClick={() => {
                          setReason('')
                          setRejecting(request)
                        }}
                      >
                        {t('requests.rejectButton')}
                      </Button>
                      <Button
                        variant="primary"
                        size="sm"
                        loading={busy}
                        onClick={() => onAccept(request.id)}
                      >
                        {t('requests.acceptButton')}
                      </Button>
                    </div>
                  )}

                  {session && (
                    <div className="of-request-session">
                      <span
                        className={`ui-status ${
                          session.status === 'open' ? 'ui-status-success' : 'ui-status-neutral'
                        }`}
                      >
                        {session.status === 'open'
                          ? t('chatSession.statusOpen')
                          : t('chatSession.statusClosed')}
                      </span>
                      <Button
                        variant="secondary"
                        size="sm"
                        onClick={() => navigate(`/chat-sessions/${session.id}`)}
                      >
                        {t('requests.openSession')}
                      </Button>
                    </div>
                  )}

                  {request.status !== 'pending' && !session && (
                    <span className="of-request-note">
                      {request.status === 'accepted'
                        ? t('requests.statusAccepted')
                        : request.status === 'rejected'
                          ? t('requests.statusRejected')
                          : t('requests.statusCancelled')}
                    </span>
                  )}
                </div>
              )
            })}
          </div>
        )}
      </section>

      {rejecting && (
        <Sheet
          title={t('requests.rejectButton')}
          onClose={() => setRejecting(null)}
          footer={
            <Button
              variant="danger"
              size="lg"
              block
              // The reason is what the other person will read, so an
              // empty one is not a rejection anyone can act on.
              disabled={reason.trim().length === 0}
              loading={busyRequestId === rejecting.id}
              onClick={() => {
                onReject(rejecting.id, reason.trim())
                setRejecting(null)
              }}
            >
              {t('requests.rejectButton')}
            </Button>
          }
        >
          <label className="ui-field">
            <span className="ui-field-label">{t('requests.reasonLabel')}</span>
            <textarea
              className="ui-textarea"
              id="reject-reason"
              value={reason}
              onChange={(event) => setReason(event.target.value)}
              placeholder={t('requests.rejectReasonPlaceholder')}
              autoFocus
            />
            <span className="ui-field-help">
              {t('requests.rejectReasonHint', { name: rejecting.buyer_display_name })}
            </span>
          </label>
        </Sheet>
      )}
    </>
  )
}
