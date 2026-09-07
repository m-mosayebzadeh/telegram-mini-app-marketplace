import { useCallback, useEffect, useState } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { Placeholder, Spinner } from '@telegram-apps/telegram-ui'
import { IdentityAvatar } from '../components/IdentityAvatar'
import { apiFetch, ApiError, formatApiError } from '../lib/api'
import { useMe } from '../lib/MeContext'
import { nextUtcMidnight } from '../lib/dailyQuota'
import { getRequestAction } from '../lib/requestActions'
import type { ChatSession, Offer, RequestActivity } from '../lib/types'

type Segment = 'offers' | 'requests'

/** Optional navigation state a caller (e.g. OfferDetail.tsx's "you
 * already have an active request with this provider" modal) can pass
 * to land directly on the Requests segment instead of always opening
 * on the default Offers view. */
type ActivityNavState = { segment?: Segment }

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
  const location = useLocation()
  const { me, refreshMe } = useMe()
  const navState = location.state as ActivityNavState | null
  const [segment, setSegment] = useState<Segment>(navState?.segment ?? 'offers')
  const [offers, setOffers] = useState<Offer[] | null>(null)
  const [requests, setRequests] = useState<RequestActivity[] | null>(null)
  const [sessions, setSessions] = useState<ChatSession[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [cancelTarget, setCancelTarget] = useState<RequestActivity | null>(null)
  const [cancelling, setCancelling] = useState(false)
  const [payingId, setPayingId] = useState<number | null>(null)
  const [payMessage, setPayMessage] = useState<string | null>(null)

  const loadOffers = useCallback(() => {
    if (!me) return
    apiFetch<Offer[]>(`/offers?provider_id=${me.id}`)
      .then(setOffers)
      .catch((err) => setError(formatApiError(err)))
  }, [me])

  const loadRequests = useCallback(() => {
    // This exact call is what the backend treats as "the buyer has now
    // seen their sent requests' updates" (see backend/app/request/
    // router.py's list_activity_requests) — it clears
    // Me.unseen_sent_request_updates_count. refreshMe() re-fetches /me
    // right after, so the bottom nav's dot/badge update within this
    // same session instead of only on next reload (mirrors
    // OfferDetail.tsx's identical pattern for the provider side).
    //
    // Also fetches every chat session the current user is part of —
    // needed to tell an ACCEPTED-and-paid request (show "enter chat")
    // apart from an ACCEPTED-but-not-yet-paid one (show "pay"), the
    // same "a matching session exists" check getRequestAction() itself
    // makes (see lib/requestActions.ts).
    apiFetch<RequestActivity[]>('/requests/activity')
      .then(setRequests)
      .then(refreshMe)
      .catch((err) => setError(formatApiError(err)))
    apiFetch<ChatSession[]>('/chat-sessions/mine').then(setSessions)
    // eslint-disable-next-line react-hooks/exhaustive-deps -- intentionally not re-running on every refreshMe identity change, see OfferDetail.tsx's identical comment
  }, [])

  useEffect(() => {
    if (segment === 'offers') loadOffers()
    else loadRequests()
    // Depends on segment and the user's own numeric id — NOT on
    // loadOffers/loadRequests' own identities, and NOT on the whole
    // `me` object. loadRequests() itself calls refreshMe() (see its own
    // comment above), which replaces `me` with a brand new object
    // reference on every single call, even when nothing in it actually
    // changed. Depending on that object (or on loadOffers, which itself
    // depends on it) here would re-run this effect every time
    // loadRequests() finishes — forever, in a tight loop, for as long
    // as the Requests segment stayed open. `me?.id` never actually
    // changes mid-session, so this still fires exactly once, right when
    // `me` first finishes loading, plus once per real segment switch.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [segment, me?.id])

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

  async function confirmCancelRequest() {
    if (!cancelTarget) return
    setCancelling(true)
    try {
      await apiFetch(`/requests/${cancelTarget.id}/cancel`, { method: 'POST' })
      setCancelTarget(null)
      loadRequests()
    } catch (err) {
      setError(formatApiError(err))
    } finally {
      setCancelling(false)
    }
  }

  async function payForRequest(requestId: number) {
    setPayMessage(null)
    setPayingId(requestId)
    try {
      await apiFetch(`/requests/${requestId}/pay`, { method: 'POST' })
      loadRequests()
    } catch (err) {
      if (err instanceof ApiError && err.status === 402) {
        setPayMessage(t('requests.insufficientBalance'))
      } else {
        setPayMessage(formatApiError(err))
      }
    } finally {
      setPayingId(null)
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

  // This segment only ever shows the requests the current user
  // themselves SENT (as a buyer) — a "received" one (someone else
  // requesting one of THEIR OWN offers) is managed on that offer's own
  // detail page instead, with its accept/reject actions right there;
  // showing it a second time here, with no such action, was just noise.
  const sentRequests = (requests ?? []).filter((r) => r.direction === 'sent')

  // Sum of every offer's own unseen count (see OfferOut.request_count) —
  // the SAME per-offer numbers already shown inline below, just totaled
  // for the segment button itself. Opening one specific offer's request
  // list (pages/OfferDetail.tsx) is what reduces this, never opening
  // this list itself — see backend/app/offer/router.py's list_offers.
  const unseenOffersTotal = (offers ?? []).reduce((sum, o) => sum + (o.request_count ?? 0), 0)

  return (
    <div className="hp-page">
      <div className="hp-segmented" style={{ margin: '14px 12px 0' }}>
        <button
          className={`hp-segmented-btn ${segment === 'offers' ? 'hp-segmented-active' : ''}`}
          onClick={() => setSegment('offers')}
        >
          {t('activityPage.offersTab')}
          {unseenOffersTotal > 0 && (
            <span className="hp-badge" style={{ marginInlineStart: 6 }}>
              {unseenOffersTotal}
            </span>
          )}
        </button>
        <button
          className={`hp-segmented-btn ${segment === 'requests' ? 'hp-segmented-active' : ''}`}
          onClick={() => setSegment('requests')}
        >
          {t('activityPage.requestsTab')}
          {/* Same badge color as the Offers segment above — the label
              already says which is which, so the count doesn't also
              need its own color to tell them apart. */}
          {me.unseen_sent_request_updates_count > 0 && (
            <span className="hp-badge" style={{ marginInlineStart: 6 }}>
              {me.unseen_sent_request_updates_count}
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
          {requests === null || sessions === null ? (
            <Placeholder>
              <Spinner size="m" />
            </Placeholder>
          ) : sentRequests.length === 0 ? (
            <p className="hp-empty">{t('activityPage.requestsEmpty')}</p>
          ) : (
            <div className="hp-list" style={{ marginTop: 14 }}>
              {sentRequests.map((r) => {
                const action = getRequestAction(r, sessions)
                return (
                  <div key={r.id} className="hp-list-row">
                    <button
                      className="hp-list-row-main hp-list-row-identity"
                      onClick={() =>
                        navigate(`/profiles/${r.counterpart_user_id}`, {
                          state: { backTo: 'activity-requests' },
                        })
                      }
                    >
                      <IdentityAvatar
                        avatarUrl={r.counterpart_avatar_url}
                        displayName={r.counterpart_display_name}
                        username={r.counterpart_username}
                      />
                      <span className="hp-list-row-text">
                        <span className="hp-list-title" dir="auto">
                          {r.counterpart_display_name}
                        </span>
                        {/* The offer's own title can be arbitrarily long
                            (unlike the price) — it truncates with an
                            ellipsis instead of wrapping, so the price+star
                            (deliberately kept as one unbreakable unit,
                            never split across lines) always stays right
                            after it on the same line. */}
                        <span className="hp-offer-line">
                          <span className="hp-offer-line-title">{r.offer_title}</span>
                          <span className="hp-offer-line-price">{r.offer_price_stars} ⭐</span>
                        </span>
                        <span className="hp-list-subtitle">
                          {action.type === 'waiting' && t('requests.statusWaiting')}
                          {action.type === 'rejected' &&
                            `${t('requests.statusRejected')}${action.reason ? `: ${action.reason}` : ''}`}
                          {action.type === 'cancelled' &&
                            `${t('requests.statusCancelled')}${action.reason ? `: ${action.reason}` : ''}`}
                          {(action.type === 'pay' || action.type === 'session') &&
                            t('requests.statusAccepted')}
                        </span>
                      </span>
                    </button>
                    <div className="hp-list-row-actions">
                      <button
                        className="hp-btn-sm"
                        onClick={() =>
                          navigate(`/offers/${r.offer_id}`, { state: { backTo: 'activity-requests' } })
                        }
                      >
                        {t('requests.viewOfferButton')}
                      </button>
                      {action.type === 'waiting' && (
                        <button className="hp-btn-sm" onClick={() => setCancelTarget(r)}>
                          {t('requests.cancelButton')}
                        </button>
                      )}
                      {action.type === 'pay' && (
                        <button
                          className="hp-btn-sm hp-btn-sm-filled"
                          disabled={payingId === r.id}
                          onClick={() => payForRequest(r.id)}
                        >
                          {payingId === r.id ? t('common.loading') : t('requests.payButton')}
                        </button>
                      )}
                      {action.type === 'session' && (
                        <button className="hp-btn-sm" onClick={() => navigate(`/chat-sessions/${action.session.id}`)}>
                          {t('requests.openSession')}
                        </button>
                      )}
                    </div>
                  </div>
                )
              })}
            </div>
          )}
          {payMessage && <p className="hp-hint" style={{ padding: '0 16px' }}>{payMessage}</p>}

          {/* Fixed above the bottom nav (not part of the scrolling
              list), only while viewing this segment — a quiet reminder
              of when today's request quota resets, rendered in the
              VIEWER's own local time even though the underlying
              boundary is a fixed UTC instant (see lib/dailyQuota.ts). */}
          <p className="hp-quota-hint">
            {t('activityPage.quotaResetHint', {
              time: nextUtcMidnight(new Date()).toLocaleTimeString(undefined, {
                hour: '2-digit',
                minute: '2-digit',
              }),
            })}
          </p>
        </>
      )}

      {cancelTarget && (
        <div className="hp-confirm-backdrop" onClick={() => setCancelTarget(null)}>
          <div className="hp-confirm-box" onClick={(e) => e.stopPropagation()}>
            <p className="hp-confirm-title">{t('requests.cancelButton')}</p>
            <p className="hp-confirm-message">{t('requests.cancelConfirmBody')}</p>
            <div className="hp-confirm-actions">
              <button className="hp-confirm-btn" onClick={() => setCancelTarget(null)}>
                {t('common.cancel')}
              </button>
              <button className="hp-confirm-btn hp-confirm-btn-danger" disabled={cancelling} onClick={confirmCancelRequest}>
                {t('requests.cancelButton')}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
