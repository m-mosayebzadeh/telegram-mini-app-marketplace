import { useCallback, useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { Placeholder, Spinner } from '@telegram-apps/telegram-ui'
import { apiFetch, formatApiError } from '../lib/api'
import { useMe } from '../lib/MeContext'
import type { Offer, RequestActivity } from '../lib/types'

type Segment = 'offers' | 'requests'
type DirectionFilter = 'all' | 'sent' | 'received'

/**
 * The Activity tab: everything the current user is DOING on the
 * marketplace, as either a provider (their own offers) or as either
 * party in a request — replaces the old separate "My offers" / "My
 * requests" bottom tabs with one segmented view (Offers | Requests),
 * the same Post/Archived-style pattern the Profile tab and Chats tab
 * both use.
 */
export default function Activity() {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const { me } = useMe()
  const [segment, setSegment] = useState<Segment>('offers')
  const [offers, setOffers] = useState<Offer[] | null>(null)
  const [requests, setRequests] = useState<RequestActivity[] | null>(null)
  const [directionFilter, setDirectionFilter] = useState<DirectionFilter>('all')
  const [error, setError] = useState<string | null>(null)

  const loadOffers = useCallback(() => {
    if (!me) return
    apiFetch<Offer[]>(`/offers?provider_id=${me.id}`)
      .then(setOffers)
      .catch((err) => setError(formatApiError(err)))
  }, [me])

  const loadRequests = useCallback(() => {
    apiFetch<RequestActivity[]>('/requests/activity')
      .then(setRequests)
      .catch((err) => setError(formatApiError(err)))
  }, [])

  useEffect(() => {
    if (segment === 'offers') loadOffers()
    else loadRequests()
  }, [segment, loadOffers, loadRequests])

  async function toggleOffer(offer: Offer) {
    const action = offer.status === 'active' ? 'deactivate' : 'activate'
    try {
      await apiFetch(`/offers/${offer.id}/${action}`, { method: 'POST' })
      loadOffers()
    } catch (err) {
      setError(formatApiError(err))
    }
  }

  async function removeOffer(offer: Offer) {
    if (!window.confirm(t('offers.deleteConfirm'))) return
    try {
      await apiFetch(`/offers/${offer.id}`, { method: 'DELETE' })
      loadOffers()
    } catch (err) {
      setError(formatApiError(err))
    }
  }

  if (error) return <Placeholder header={t('common.error')}>{error}</Placeholder>
  if (!me) {
    return (
      <Placeholder>
        <Spinner size="l" />
      </Placeholder>
    )
  }

  const filteredRequests = (requests ?? []).filter(
    (r) => directionFilter === 'all' || r.direction === directionFilter,
  )

  return (
    <div className="hp-page">
      <div className="hp-segmented" style={{ margin: '14px 12px 0' }}>
        <button
          className={`hp-segmented-btn ${segment === 'offers' ? 'hp-segmented-active' : ''}`}
          onClick={() => setSegment('offers')}
        >
          {t('activityPage.offersTab')}
          {/* Total pending requests across ALL of the current user's
              offers — not just the one they're currently looking at
              (that per-offer count is the .hp-badge inside each row
              below) — so this tab itself signals "something needs a
              response" before it's even opened. */}
          {!!me.pending_requests_received_count && (
            <span className="hp-badge" style={{ marginInlineStart: 6 }}>
              {me.pending_requests_received_count}
            </span>
          )}
        </button>
        <button
          className={`hp-segmented-btn ${segment === 'requests' ? 'hp-segmented-active' : ''}`}
          onClick={() => setSegment('requests')}
        >
          {t('activityPage.requestsTab')}
          {/* Live (accepted) requests received — the engagements the
              current user, as provider, currently has open. */}
          {!!me.accepted_requests_received_count && (
            <span className="hp-badge" style={{ marginInlineStart: 6 }}>
              {me.accepted_requests_received_count}
            </span>
          )}
        </button>
      </div>

      {segment === 'offers' &&
        (offers === null ? (
          <Placeholder>
            <Spinner size="m" />
          </Placeholder>
        ) : offers.length === 0 ? (
          <p className="hp-empty">{t('activityPage.offersEmpty')}</p>
        ) : (
          <>
            <div className="hp-list" style={{ marginTop: 14 }}>
              {offers.map((offer) => (
                <div key={offer.id} className="hp-list-row">
                  <div
                    className="hp-list-row-main"
                    onClick={() => navigate(`/offers/${offer.id}`)}
                    style={{ cursor: 'pointer' }}
                  >
                    <span className="hp-list-title">
                      {offer.title}
                      {!!offer.request_count && (
                        <span className="hp-badge" style={{ marginInlineStart: 8 }}>
                          {offer.request_count}
                        </span>
                      )}
                    </span>
                    <span className="hp-list-subtitle">
                      {t('offers.priceLine', {
                        price: offer.price_stars,
                        minutes: offer.display_duration_minutes,
                      })}{' '}
                      — {offer.status === 'active' ? t('offers.statusActive') : t('offers.statusInactive')}
                    </span>
                  </div>
                  <div className="hp-list-row-actions">
                    <button className="hp-btn-sm" onClick={() => toggleOffer(offer)}>
                      {offer.status === 'active' ? t('offers.deactivate') : t('offers.activate')}
                    </button>
                    <button className="hp-btn-sm" onClick={() => removeOffer(offer)}>
                      {t('offers.delete')}
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </>
        ))}

      {segment === 'offers' && (
        <div className="hp-field" style={{ margin: '0 12px' }}>
          <button className="hp-btn hp-btn-gradient" style={{ width: '100%' }} onClick={() => navigate('/offers/new')}>
            {t('offers.createNew')}
          </button>
        </div>
      )}

      {segment === 'requests' && (
        <>
          <div className="hp-segmented" style={{ margin: '12px 12px 0' }}>
            <button
              className={`hp-segmented-btn ${directionFilter === 'all' ? 'hp-segmented-active' : ''}`}
              onClick={() => setDirectionFilter('all')}
            >
              {t('activityPage.filterAll')}
            </button>
            <button
              className={`hp-segmented-btn ${directionFilter === 'sent' ? 'hp-segmented-active' : ''}`}
              onClick={() => setDirectionFilter('sent')}
            >
              {t('activityPage.filterSent')}
            </button>
            <button
              className={`hp-segmented-btn ${directionFilter === 'received' ? 'hp-segmented-active' : ''}`}
              onClick={() => setDirectionFilter('received')}
            >
              {t('activityPage.filterReceived')}
            </button>
          </div>

          {requests === null ? (
            <Placeholder>
              <Spinner size="m" />
            </Placeholder>
          ) : filteredRequests.length === 0 ? (
            <p className="hp-empty">{t('activityPage.requestsEmpty')}</p>
          ) : (
            <div className="hp-list" style={{ marginTop: 14 }}>
              {filteredRequests.map((r) => (
                <button key={r.id} className="hp-list-row" onClick={() => navigate(`/offers/${r.offer_id}`)}>
                  <span
                    className={`hp-direction-icon ${r.direction === 'sent' ? 'hp-direction-icon-sent' : 'hp-direction-icon-received'}`}
                    aria-hidden="true"
                  >
                    {r.direction === 'sent' ? '↗' : '↘'}
                  </span>
                  <div className="hp-list-row-main">
                    <span className="hp-list-title">{r.offer_title}</span>
                    <span className="hp-list-subtitle">
                      {r.direction === 'sent'
                        ? t('activityPage.sentTo', { name: r.counterpart_display_name })
                        : t('activityPage.receivedFrom', { name: r.counterpart_display_name })}
                      {' — '}
                      {r.status === 'pending'
                        ? t('requests.statusWaiting')
                        : r.status === 'rejected'
                          ? t('requests.statusRejected')
                          : r.status === 'cancelled'
                            ? t('requests.statusCancelled')
                            : t('offers.statusActive')}
                    </span>
                  </div>
                </button>
              ))}
            </div>
          )}
        </>
      )}
    </div>
  )
}
