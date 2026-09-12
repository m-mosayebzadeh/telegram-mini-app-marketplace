import { useEffect, useState } from 'react'
import { useLocation, useNavigate, useParams } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { apiFetch, ApiError, formatApiError } from '../lib/api'
import { useMe } from '../lib/MeContext'
import { getPricingConfig } from '../lib/pricing'
import { PageHeader, ConfirmDialog, ErrorState, SkeletonRows, useToast } from '../components/ui'
import { OfferBuyerView } from '../components/offer/OfferBuyerView'
import { OfferRequestsView } from '../components/offer/OfferRequestsView'
import type { BackNavState } from '../lib/navState'
import type { Balance, ChatSession, IncomingRequest, Offer } from '../lib/types'

/**
 * One URL, two screens, decided by whether the viewer owns the offer:
 *
 * - someone else's: the person, the deal, and a request button
 *   (components/offer/OfferBuyerView.tsx)
 * - your own: the requests that have come in, with accept and reject
 *   (components/offer/OfferRequestsView.tsx)
 *
 * There is no second route: both need exactly the same offer fetch, and
 * splitting them would mean maintaining that twice. This file owns the
 * data and the decisions; the two views only render.
 */

/** The two refusals POST /requests reports as structured detail rather
 *  than a message (see backend/app/request/router.py's create_request).
 *  Each is a real situation with its own way out, so each gets a dialog
 *  instead of raw error text. */
type Refusal = { kind: 'daily_cap'; limit: number } | { kind: 'live_conflict' } | { kind: 'funds' }

export default function OfferDetail() {
  const { t, i18n } = useTranslation()
  const { id } = useParams()
  const navigate = useNavigate()
  const location = useLocation()
  const { me, refreshMe } = useMe()
  const toast = useToast()

  const [offer, setOffer] = useState<Offer | null>(null)
  const [requests, setRequests] = useState<IncomingRequest[] | null>(null)
  const [sessions, setSessions] = useState<ChatSession[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [balance, setBalance] = useState<Balance | null>(null)
  const [starToTomanRate, setStarToTomanRate] = useState<number | null>(null)
  const [sending, setSending] = useState(false)
  const [busyRequestId, setBusyRequestId] = useState<number | null>(null)
  const [refusal, setRefusal] = useState<Refusal | null>(null)

  const isOwner = !!(me && offer && offer.provider_id === me.id)

  // Where "back" should actually go — plain history-back by default, but
  // explicitly to Activity's Requests segment when that is genuinely
  // where this page was opened from (see lib/navState.ts).
  const backState = location.state as BackNavState | null
  function goBack() {
    if (backState?.backTo === 'activity-requests') {
      navigate('/activity', { state: { segment: 'requests' } })
    } else {
      navigate(-1)
    }
  }

  function loadOffer() {
    setError(null)
    apiFetch<Offer>(`/offers/${id}`)
      .then(setOffer)
      .catch((err) => setError(formatApiError(err)))
  }

  useEffect(loadOffer, [id])

  useEffect(() => {
    if (!isOwner) return
    // This exact call is what the backend treats as "the provider has
    // now seen this offer's requests" — it clears THIS offer's unseen
    // badge and no other's. refreshMe() then re-fetches /me so the nav
    // dot updates in this session rather than on the next reload.
    apiFetch<IncomingRequest[]>(`/requests?offer_id=${id}`).then(setRequests).then(refreshMe)
    apiFetch<ChatSession[]>('/chat-sessions/mine').then(setSessions)
    // eslint-disable-next-line react-hooks/exhaustive-deps -- re-runs on isOwner/id only; refreshMe is current through the closure either way
  }, [isOwner, id])

  useEffect(() => {
    // Only a buyer needs their own balance, and only once ownership is
    // settled — a provider never triggers either of these.
    if (isOwner || !offer) return
    apiFetch<Balance>('/wallet/balance')
      .then(setBalance)
      .catch(() => setBalance(null))
    getPricingConfig()
      .then((config) => setStarToTomanRate(config.star_to_toman_rate))
      .catch(() => setStarToTomanRate(null))
  }, [isOwner, offer])

  // Payment only happens once the provider accepts, so a request is free
  // to send with an empty wallet — which used to mean a buyer could send
  // one that was doomed to fail at payment time, with no warning. This
  // is that warning, raised before the request is even created.
  const missingStars =
    offer && balance ? Math.max(0, offer.price_stars - balance.balance_stars_equivalent) : 0

  async function sendRequest() {
    setSending(true)
    try {
      await apiFetch('/requests', {
        method: 'POST',
        body: JSON.stringify({ offer_id: Number(id) }),
      })
      toast.success(t('offers.requestSent'))
      // Refetch so the button reflects the new pending request instead
      // of staying live until the next full reload.
      loadOffer()
    } catch (err) {
      if (err instanceof ApiError && err.status === 400) {
        const detail = (err.body as { detail?: { reason?: string; limit?: number } } | null)?.detail
        if (detail?.reason === 'daily_cap_reached') {
          setRefusal({ kind: 'daily_cap', limit: detail.limit ?? 10 })
          return
        }
        if (detail?.reason === 'live_request_with_provider') {
          setRefusal({ kind: 'live_conflict' })
          return
        }
      }
      toast.error(formatApiError(err))
    } finally {
      setSending(false)
    }
  }

  function handleRequestClick() {
    if (missingStars > 0) {
      setRefusal({ kind: 'funds' })
      return
    }
    sendRequest()
  }

  async function respond(requestId: number, action: 'accept' | 'reject', reason?: string) {
    setBusyRequestId(requestId)
    try {
      if (action === 'accept') {
        await apiFetch(`/requests/${requestId}/accept`, { method: 'POST' })
      } else {
        await apiFetch(`/requests/${requestId}/reject`, {
          method: 'POST',
          body: JSON.stringify({ reason }),
        })
      }
      setRequests(await apiFetch<IncomingRequest[]>(`/requests?offer_id=${id}`))
    } catch (err) {
      if (err instanceof ApiError && err.status === 400) {
        const why = (err.body as { detail?: { reason?: string } } | null)?.detail?.reason
        if (why === 'provider_has_open_accepted_request') {
          toast.error(t('offers.openAcceptedRequestError'))
          return
        }
      }
      toast.error(formatApiError(err))
    } finally {
      setBusyRequestId(null)
    }
  }

  return (
    <div className="ui-page">
      <PageHeader
        title={
          isOwner ? t('offers.incomingRequestsTitle') : (offer?.title ?? t('offers.browseTitle'))
        }
        onBack={goBack}
      />

      <div className={`ui-page-body${!isOwner && offer ? ' ui-page-body-action' : ''}`}>
        {error ? (
          <ErrorState text={error} onRetry={loadOffer} />
        ) : !offer ? (
          <SkeletonRows count={3} />
        ) : isOwner ? (
          <OfferRequestsView
            offer={offer}
            requests={requests}
            sessions={sessions}
            onAccept={(requestId) => respond(requestId, 'accept')}
            onReject={(requestId, reason) => respond(requestId, 'reject', reason)}
            busyRequestId={busyRequestId}
          />
        ) : (
          <OfferBuyerView
            offer={offer}
            alreadyRequested={offer.my_request_status != null}
            sending={sending}
            onRequest={handleRequestClick}
          />
        )}
      </div>

      {refusal?.kind === 'funds' && (
        <ConfirmDialog
          title={t('offers.insufficientBalanceTitle')}
          text={t('offers.insufficientBalanceMessage', {
            stars: missingStars.toLocaleString(i18n.language),
            toman: (missingStars * (starToTomanRate ?? 0)).toLocaleString(i18n.language),
          })}
          confirmLabel={t('offers.quickTopUpButton')}
          onCancel={() => setRefusal(null)}
          onConfirm={() =>
            navigate('/wallet/topup', { state: { prefillStars: missingStars, from: `/offers/${id}` } })
          }
        />
      )}

      {refusal?.kind === 'daily_cap' && (
        <ConfirmDialog
          title={t('offers.dailyCapTitle')}
          text={t('offers.dailyCapMessage', { limit: refusal.limit })}
          confirmLabel={t('common.close')}
          onCancel={() => setRefusal(null)}
          onConfirm={() => setRefusal(null)}
        />
      )}

      {refusal?.kind === 'live_conflict' && (
        <ConfirmDialog
          title={t('offers.liveConflictTitle')}
          text={t('offers.liveConflictMessage')}
          confirmLabel={t('offers.viewMyRequestsButton')}
          onCancel={() => setRefusal(null)}
          onConfirm={() => navigate('/activity', { state: { segment: 'requests' } })}
        />
      )}
    </div>
  )
}
