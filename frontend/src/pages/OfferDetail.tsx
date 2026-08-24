import { useEffect, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { Button, Cell, List, Placeholder, Section, Spinner } from '@telegram-apps/telegram-ui'
import { apiFetch, ApiError } from '../lib/api'
import { useMe } from '../lib/MeContext'
import type { Offer, Request } from '../lib/types'

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
  useEffect(() => {
    if (!isOwner) return
    apiFetch<Request[]>(`/requests?offer_id=${id}`).then(setRequests)
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
    <List>
      <Section header={offer.description}>
        <Cell subtitle={t('offers.priceStarsLabel')}>{offer.price_stars}</Cell>
        <Cell subtitle={t('offers.durationLabel')}>{offer.display_duration_minutes}</Cell>
        <Cell subtitle={t('offers.status')}>
          {offer.status === 'active' ? t('offers.statusActive') : t('offers.statusInactive')}
        </Cell>
      </Section>

      <Section>
        <Cell onClick={() => navigate(`/profiles/${offer.provider_id}`)}>{t('offers.viewProfile')}</Cell>
      </Section>

      {!isOwner && (
        <Section>
          <Cell>
            <Button stretched onClick={sendRequest}>
              {t('offers.requestButton')}
            </Button>
          </Cell>
          {actionMessage && <Cell>{actionMessage}</Cell>}
        </Section>
      )}

      {isOwner && (
        <Section header={t('offers.incomingRequestsTitle')}>
          {requests === null && (
            <Cell>
              <Spinner size="s" />
            </Cell>
          )}
          {requests !== null && requests.length === 0 && <Cell>{t('offers.noIncomingRequests')}</Cell>}
          {requests?.map((request) => (
            <Cell
              key={request.id}
              subtitle={`#${request.buyer_id} — ${request.status}`}
              onClick={() => navigate(`/requests/mine`)}
              after={
                request.status === 'pending' ? (
                  <>
                    <Button size="s" mode="filled" onClick={(e) => { e.stopPropagation(); respond(request.id, 'accept') }}>
                      {t('requests.acceptButton')}
                    </Button>
                    <Button size="s" mode="outline" onClick={(e) => { e.stopPropagation(); respond(request.id, 'reject') }}>
                      {t('requests.rejectButton')}
                    </Button>
                  </>
                ) : undefined
              }
            >
              {request.status}
            </Cell>
          ))}
          {actionMessage && <Cell>{actionMessage}</Cell>}
        </Section>
      )}
    </List>
  )
}
