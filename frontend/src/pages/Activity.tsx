import { useCallback, useEffect, useState } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { apiFetch, ApiError, formatApiError } from '../lib/api'
import { useMe } from '../lib/MeContext'
import {
  PageHeader,
  ConfirmDialog,
  ErrorState,
  Segments,
  SkeletonRows,
  useToast,
} from '../components/ui'
import { DropChip } from '../components/ui/Drop'
import { MyOffersView } from '../components/activity/MyOffersView'
import { MyRequestsView } from '../components/activity/MyRequestsView'
import type { Balance, ChatSession, Offer, RequestActivity } from '../lib/types'

type Segment = 'offers' | 'requests'

/** Optional navigation state a caller can pass to land straight on the
 *  Requests segment — used by the offer page's "you already have a live
 *  request with this provider" dialog. */
type ActivityNavState = { segment?: Segment }

/**
 * The Activity tab: everything the user is DOING on the marketplace —
 * what they are selling (Offers) and what they have asked other people
 * for (Requests).
 *
 * This file owns the data and the two mutations that are shared between
 * the segments; each segment's rendering lives in
 * components/activity/.
 */
export default function Activity() {
  const { t, i18n } = useTranslation()
  const navigate = useNavigate()
  const location = useLocation()
  const { me, refreshMe } = useMe()
  const toast = useToast()

  const navState = location.state as ActivityNavState | null
  const [segment, setSegment] = useState<Segment>(navState?.segment ?? 'offers')
  const [offers, setOffers] = useState<Offer[] | null>(null)
  const [requests, setRequests] = useState<RequestActivity[] | null>(null)
  const [sessions, setSessions] = useState<ChatSession[] | null>(null)
  const [balance, setBalance] = useState<Balance | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [cancelTarget, setCancelTarget] = useState<RequestActivity | null>(null)
  const [cancelling, setCancelling] = useState(false)
  const [payingId, setPayingId] = useState<number | null>(null)
  const [busyOfferId, setBusyOfferId] = useState<number | null>(null)

  const loadOffers = useCallback(() => {
    if (!me) return
    setError(null)
    apiFetch<Offer[]>(`/offers?provider_id=${me.id}`)
      .then(setOffers)
      .catch((err) => setError(formatApiError(err)))
  }, [me])

  const loadRequests = useCallback(() => {
    setError(null)
    // This exact call is what the backend treats as "the buyer has now
    // seen their sent requests' updates" — it clears
    // Me.unseen_sent_request_updates_count. refreshMe() then re-fetches
    // /me so the nav dot updates in this session rather than on the next
    // reload.
    //
    // The sessions are fetched alongside because an ACCEPTED request
    // that has been paid for is told apart from one that has not by
    // whether a chat session exists (see lib/requestActions.ts).
    apiFetch<RequestActivity[]>('/requests/activity')
      .then(setRequests)
      .then(refreshMe)
      .catch((err) => setError(formatApiError(err)))
    apiFetch<ChatSession[]>('/chat-sessions/mine').then(setSessions)
    // eslint-disable-next-line react-hooks/exhaustive-deps -- refreshMe replaces `me` on every call; depending on it here would loop
  }, [])

  useEffect(() => {
    if (segment === 'offers') loadOffers()
    else loadRequests()
    // Depends on the segment and the user's numeric id — NOT on
    // loadOffers/loadRequests' identities and NOT on the whole `me`
    // object. loadRequests() calls refreshMe(), which replaces `me` with
    // a new object reference every time even when nothing changed;
    // depending on that here would re-run this effect forever for as
    // long as the Requests segment stayed open.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [segment, me?.id])

  useEffect(() => {
    // The header's balance chip. Secondary: if it fails the page still
    // works and the chip simply does not appear.
    apiFetch<Balance>('/wallet/balance')
      .then(setBalance)
      .catch(() => undefined)
  }, [])

  async function toggleOffer(offer: Offer) {
    const action = offer.status === 'active' ? 'deactivate' : 'activate'
    setBusyOfferId(offer.id)
    try {
      await apiFetch(`/offers/${offer.id}/${action}`, { method: 'POST' })
      loadOffers()
    } catch (err) {
      toast.error(formatApiError(err))
    } finally {
      setBusyOfferId(null)
    }
  }

  async function removeOffer(offer: Offer) {
    setBusyOfferId(offer.id)
    try {
      await apiFetch(`/offers/${offer.id}`, { method: 'DELETE' })
      loadOffers()
    } catch (err) {
      toast.error(formatApiError(err))
    } finally {
      setBusyOfferId(null)
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
      toast.error(formatApiError(err))
    } finally {
      setCancelling(false)
    }
  }

  async function payForRequest(requestId: number) {
    setPayingId(requestId)
    try {
      await apiFetch(`/requests/${requestId}/pay`, { method: 'POST' })
      toast.success(t('requests.paySuccess'))
      loadRequests()
    } catch (err) {
      // 402 is the one failure with a real way out, so it says what to
      // do rather than repeating the server's wording.
      toast.error(
        err instanceof ApiError && err.status === 402
          ? t('requests.insufficientBalance')
          : formatApiError(err),
      )
    } finally {
      setPayingId(null)
    }
  }

  // Every offer's own unseen count, totalled for the segment button. It
  // goes down by opening a specific offer, never by opening this list.
  const unseenOffers = (offers ?? []).reduce((sum, o) => sum + (o.request_count ?? 0), 0)
  const unseenRequests = me?.unseen_sent_request_updates_count ?? 0

  const reload = segment === 'offers' ? loadOffers : loadRequests

  return (
    <div className="ui-page">
      <PageHeader
        title={t('tabs.activity')}
        action={
          balance && (
            <DropChip
              amount={balance.balance_stars_equivalent}
              locale={i18n.language}
              onClick={() => navigate('/wallet')}
              label={t('wallet.title')}
            />
          )
        }
      />

      <div
        className={`ui-page-body${
          segment === 'offers' && offers && offers.length > 0 ? ' ui-page-body-action' : ''
        }`}
      >
        <Segments
          label={t('tabs.activity')}
          value={segment}
          onChange={setSegment}
          options={[
            { id: 'offers', label: t('activityPage.offersTab'), count: unseenOffers },
            { id: 'requests', label: t('activityPage.requestsTab'), count: unseenRequests },
          ]}
        />

        {error ? (
          <ErrorState text={error} onRetry={reload} />
        ) : !me ? (
          <SkeletonRows count={3} />
        ) : segment === 'offers' ? (
          <MyOffersView
            offers={offers}
            onToggle={toggleOffer}
            onDelete={removeOffer}
            onCreate={() => navigate('/offers/new')}
            busyOfferId={busyOfferId}
          />
        ) : (
          <MyRequestsView
            requests={requests}
            sessions={sessions}
            onCancel={setCancelTarget}
            onPay={payForRequest}
            onBrowse={() => navigate('/offers')}
            payingId={payingId}
          />
        )}
      </div>

      {cancelTarget && (
        <ConfirmDialog
          title={t('requests.cancelButton')}
          text={t('requests.cancelConfirmBody')}
          confirmLabel={t('requests.cancelButton')}
          destructive
          loading={cancelling}
          onCancel={() => setCancelTarget(null)}
          onConfirm={confirmCancelRequest}
        />
      )}
    </div>
  )
}
