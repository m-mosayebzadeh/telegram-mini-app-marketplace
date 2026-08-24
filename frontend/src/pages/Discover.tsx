import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { Cell, List, Placeholder, Section, Spinner } from '@telegram-apps/telegram-ui'
import { apiFetch, ApiError } from '../lib/api'
import { getPricingConfig } from '../lib/pricing'
import type { Offer } from '../lib/types'

/** Marketplace-wide discovery: every ACTIVE offer from every provider
 * (GET /offers with no provider_id — see backend/app/offer/router.py).
 * This is the "Divar-style" browse list TECHNICAL_REQUIREMENTS.md
 * section 9 settled on, not a content feed. */
export default function Discover() {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const [offers, setOffers] = useState<Offer[] | null>(null)
  // Just the rate, not a full breakdown — a buyer browsing offers only
  // ever needs to know what THEY would pay (Stars + its Toman
  // equivalent), never a provider's commission or net earnings (see
  // components/PriceBreakdown.tsx's 'grossOnly' variant, used the same
  // way on the offer detail page for non-owners).
  const [starToTomanRate, setStarToTomanRate] = useState<number | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    apiFetch<Offer[]>('/offers')
      .then(setOffers)
      .catch((err) => setError(err instanceof ApiError ? JSON.stringify(err.body) : String(err)))
    getPricingConfig().then((config) => setStarToTomanRate(config.star_to_toman_rate))
  }, [])

  if (error) return <Placeholder header={t('common.error')}>{error}</Placeholder>
  if (!offers) {
    return (
      <Placeholder>
        <Spinner size="l" />
      </Placeholder>
    )
  }
  if (offers.length === 0) return <Placeholder>{t('offers.none')}</Placeholder>

  return (
    <List>
      <Section header={t('offers.browseTitle')}>
        {offers.map((offer) => (
          <Cell
            key={offer.id}
            subtitle={
              starToTomanRate
                ? t('offers.priceLineWithToman', {
                    price: offer.price_stars,
                    minutes: offer.display_duration_minutes,
                    toman: (offer.price_stars * starToTomanRate).toLocaleString('en-US'),
                  })
                : t('offers.priceLine', {
                    price: offer.price_stars,
                    minutes: offer.display_duration_minutes,
                  })
            }
            onClick={() => navigate(`/offers/${offer.id}`)}
          >
            {offer.title}
          </Cell>
        ))}
      </Section>
    </List>
  )
}
