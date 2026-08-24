import { useCallback, useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { Button, Cell, List, Placeholder, Section, Spinner } from '@telegram-apps/telegram-ui'
import { apiFetch, ApiError } from '../lib/api'
import { useMe } from '../lib/MeContext'
import type { Offer } from '../lib/types'

/** Every offer the logged-in user owns, active or not — GET /offers
 * with provider_id set to your own id returns everything, unlike
 * browsing someone else's (see backend/app/offer/router.py's
 * list_offers). Includes the manage actions (activate/deactivate/
 * delete) that only make sense on your own offers. */
export default function MyOffers() {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const { me } = useMe()
  const [offers, setOffers] = useState<Offer[] | null>(null)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(() => {
    if (!me) return
    apiFetch<Offer[]>(`/offers?provider_id=${me.id}`)
      .then(setOffers)
      .catch((err) => setError(err instanceof ApiError ? JSON.stringify(err.body) : String(err)))
  }, [me])

  useEffect(load, [load])

  async function toggle(offer: Offer) {
    const action = offer.status === 'active' ? 'deactivate' : 'activate'
    try {
      await apiFetch(`/offers/${offer.id}/${action}`, { method: 'POST' })
      load()
    } catch (err) {
      setError(err instanceof ApiError ? JSON.stringify(err.body) : String(err))
    }
  }

  async function remove(offer: Offer) {
    if (!window.confirm(t('offers.deleteConfirm'))) return
    try {
      await apiFetch(`/offers/${offer.id}`, { method: 'DELETE' })
      load()
    } catch (err) {
      setError(err instanceof ApiError ? JSON.stringify(err.body) : String(err))
    }
  }

  if (error) return <Placeholder header={t('common.error')}>{error}</Placeholder>
  if (!me || !offers) {
    return (
      <Placeholder>
        <Spinner size="l" />
      </Placeholder>
    )
  }

  return (
    <List>
      <Section header={t('offers.mineTitle')}>
        {offers.length === 0 && <Cell>{t('offers.none')}</Cell>}
        {offers.map((offer) => (
          <Cell
            key={offer.id}
            subtitle={`${t('offers.priceLine', {
              price: offer.price_stars,
              minutes: offer.display_duration_minutes,
            })} — ${offer.status === 'active' ? t('offers.statusActive') : t('offers.statusInactive')}`}
            onClick={() => navigate(`/offers/${offer.id}`)}
            after={
              <>
                <Button size="s" mode="outline" onClick={(e) => { e.stopPropagation(); toggle(offer) }}>
                  {offer.status === 'active' ? t('offers.deactivate') : t('offers.activate')}
                </Button>
                <Button size="s" mode="outline" onClick={(e) => { e.stopPropagation(); remove(offer) }}>
                  {t('offers.delete')}
                </Button>
              </>
            }
          >
            {offer.description}
          </Cell>
        ))}
      </Section>
      <Section>
        <Cell>
          <Button stretched onClick={() => navigate('/offers/new')}>
            {t('offers.createNew')}
          </Button>
        </Cell>
      </Section>
    </List>
  )
}
