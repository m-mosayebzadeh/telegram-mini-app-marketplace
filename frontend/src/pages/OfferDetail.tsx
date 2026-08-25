import { Fragment, useEffect, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { Placeholder, Spinner } from '@telegram-apps/telegram-ui'
import { PriceBreakdown } from '../components/PriceBreakdown'
import { apiFetch, ApiError } from '../lib/api'
import { useMe } from '../lib/MeContext'
import type { ChatSession, Offer, Request } from '../lib/types'

/**
 * Two very different screens depending on who's looking, decided by
 * comparing offer.provider_id to the logged-in user's own id:
 *   - someone else's offer: a "Request this offer" button
 *   - your own offer: the incoming requests on it, with Accept/Reject
 * There's no separate route for these — same URL, same data, the
 * branching happens here rather than duplicating the offer-fetching
 * logic across two page components.
 */
export default function OfferDetail() {
  const { t } = useTranslation()
  const { id } = useParams()
  const navigate = useNavigate()
  const { me } = useMe()

  const [offer, setOffer] = useState<Offer | null>(null)
  const [requests, setRequests] = useState<Request[] | null>(null)
  const [sessions, setSessions] = useState<ChatSession[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [actionMessage, setActionMessage] = useState<string | null>(null)

  const isOwner = !!(me && offer && offer.provider_id === me.id)

  useEffect(() => {
    apiFetch<Offer>(`/offers/${id}`)
      .then(setOffer)
      .catch((err) => setError(err instanceof ApiError ? JSON.stringify(err.body) : String(err)))
  }, [id])

  // Only the owner can see who has requested their offer — this call
  // is skipped entirely for anyone else, matching what the backend
  // itself would reject anyway (see list_requests_for_offer).
  //
  // GET /chat-sessions/mine returns every session the current user is
  // part of as EITHER buyer or provider (see backend/app/chat_session/
  // router.py) — this is what makes the provider's own "enter chat
  // session" link possible below; without it, an accepted-and-paid
  // request had no way in for the provider at all (a real bug, not
  // just a missing nicety — the buyer side already had this via
  // MyRequests.tsx's own use of the same endpoint).
  useEffect(() => {
    if (!isOwner) return
    apiFetch<Request[]>(`/requests?offer_id=${id}`).then(setRequests)
    apiFetch<ChatSession[]>('/chat-sessions/mine').then(setSessions)
  }, [isOwner, id])

  async function sendRequest() {
    setActionMessage(null)
    try {
      await apiFetch('/requests', { method: 'POST', body: JSON.stringify({ offer_id: Number(id) }) })
      setActionMessage(t('offers.requestSent'))
    } catch (err) {
      setActionMessage(err instanceof ApiError ? JSON.stringify(err.body) : String(err))
    }
  }

  async function respond(requestId: number, action: 'accept' | 'reject') {
    try {
      if (action === 'accept') {
        await apiFetch(`/requests/${requestId}/accept`, { method: 'POST' })
      } else {
        const reason = window.prompt(t('requests.rejectReasonPlaceholder')) ?? ''
        if (!reason) return
        await apiFetch(`/requests/${requestId}/reject`, {
          method: 'POST',
          body: JSON.stringify({ reason }),
        })
      }
      const refreshed = await apiFetch<Request[]>(`/requests?offer_id=${id}`)
      setRequests(refreshed)
    } catch (err) {
      setActionMessage(err instanceof ApiError ? JSON.stringify(err.body) : String(err))
    }
  }

  if (error) return <Placeholder header={t('common.error')}>{error}</Placeholder>
  if (!offer) {
    return (
      <Placeholder>
        <Spinner size="l" />
      </Placeholder>
    )
  }

  return (
    <div className="hp-page">
      <div className="hp-page-header">{offer.title}</div>

      <div className="hp-card">
        <p className="hp-bio" style={{ margin: 0 }}>
          {offer.description}
        </p>
        <div className="hp-kv-row">
          <span className="hp-kv-label">{t('offers.priceStarsLabel')}</span>
          <span className="hp-kv-value">{offer.price_stars}</span>
        </div>
        {/* The provider (owner) sees the full breakdown, including their
            own commission/net earnings — a buyer only needs to know
            what THEY pay (Stars + Toman equivalent), never the
            provider's commission or take-home numbers. */}
        <PriceBreakdown
          priceStars={offer.price_stars}
          commissionKind="chat"
          variant={isOwner ? 'full' : 'grossOnly'}
        />
        <div className="hp-kv-row">
          <span className="hp-kv-label">{t('offers.durationLabel')}</span>
          <span className="hp-kv-value">{offer.display_duration_minutes}</span>
        </div>
        <div className="hp-kv-row">
          <span className="hp-kv-label">{t('offers.status')}</span>
          <span className="hp-kv-value">
            {offer.status === 'active' ? t('offers.statusActive') : t('offers.statusInactive')}
          </span>
        </div>
      </div>

      <div className="hp-list">
        <button className="hp-list-row" onClick={() => navigate(`/profiles/${offer.provider_id}`)}>
          <span className="hp-list-title">{t('offers.viewProfile')}</span>
        </button>
        <button className="hp-list-row" onClick={() => navigate(`/profiles/${offer.provider_id}/provider-summary`)}>
          <span className="hp-list-title">{t('offers.viewProviderSummary')}</span>
        </button>
      </div>

      {!isOwner && (
        <div className="hp-field" style={{ margin: '0 12px 14px' }}>
          <button className="hp-btn hp-btn-gradient" style={{ width: '100%' }} onClick={sendRequest}>
            {t('offers.requestButton')}
          </button>
          {actionMessage && <p className="hp-hint">{actionMessage}</p>}
        </div>
      )}

      {isOwner && (
        <>
          <div className="hp-page-header" style={{ paddingTop: 0, fontSize: 16 }}>
            {t('offers.incomingRequestsTitle')}
          </div>

          {requests === null ? (
            <Placeholder>
              <Spinner size="s" />
            </Placeholder>
          ) : requests.length === 0 ? (
            <p className="hp-empty">{t('offers.noIncomingRequests')}</p>
          ) : (
            <div className="hp-list">
              {requests.map((request) => {
                // The provider's own way into the chat session once a
                // request is accepted and paid — a session exists the
                // instant payment succeeds (see backend/app/request/
                // router.py's pay_for_request), so "a matching session
                // exists" and "this got paid for" are the same fact, same
                // logic MyRequests.tsx uses for the buyer side.
                const session = sessions?.find((s) => s.request_id === request.id)
                return (
                  <Fragment key={request.id}>
                    <button className="hp-list-row" onClick={() => navigate(`/profiles/${request.buyer_id}`)}>
                      <div className="hp-list-row-main">
                        <span className="hp-list-title">{t('offers.viewRequesterProfile')}</span>
                        <span className="hp-list-subtitle">
                          #{request.buyer_id} — {request.status}
                        </span>
                      </div>
                    </button>
                    <div className="hp-list-row">
                      <div
                        className="hp-list-row-main"
                        onClick={() => navigate(`/profiles/${request.buyer_id}/buyer-summary`)}
                        style={{ cursor: 'pointer' }}
                      >
                        <span className="hp-list-title">{t('offers.viewBuyerSummary')}</span>
                      </div>
                      {request.status === 'pending' && (
                        <div className="hp-list-row-actions">
                          <button className="hp-btn-sm hp-btn-sm-filled" onClick={() => respond(request.id, 'accept')}>
                            {t('requests.acceptButton')}
                          </button>
                          <button className="hp-btn-sm" onClick={() => respond(request.id, 'reject')}>
                            {t('requests.rejectButton')}
                          </button>
                        </div>
                      )}
                    </div>
                    {session && (
                      <div className="hp-list-row">
                        <span className="hp-list-title">
                          {session.status === 'open' ? t('chatSession.statusOpen') : t('chatSession.statusClosed')}
                        </span>
                        <button className="hp-btn-sm" onClick={() => navigate(`/chat-sessions/${session.id}`)}>
                          {t('requests.openSession')}
                        </button>
                      </div>
                    )}
                  </Fragment>
                )
              })}
            </div>
          )}
          {actionMessage && <p className="hp-hint" style={{ padding: '0 16px' }}>{actionMessage}</p>}
        </>
      )}
    </div>
  )
}
