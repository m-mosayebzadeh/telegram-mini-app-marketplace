import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { Placeholder, Spinner } from '@telegram-apps/telegram-ui'
import { apiFetch, formatApiError } from '../lib/api'
import { getPricingConfig } from '../lib/pricing'
import type { Offer } from '../lib/types'

/** Marketplace-wide discovery: every ACTIVE offer from every provider
 * (GET /offers with no provider_id — see backend/app/offer/router.py).
 * This is the "Divar-style" browse list TECHNICAL_REQUIREMENTS.md
 * section 9 settled on, not a content feed. Styled with the same hp-*
 * "premium lounge" system as the profile tab (TECHNICAL_REQUIREMENTS.md
 * section 12's follow-up: unifying every page onto one visual template) —
 * loading/error states still use telegram-ui's Placeholder/Spinner, the
 * same convention every other hp-page screen already follows. */
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
      .catch((err) => setError(formatApiError(err)))
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

  return (
    <div className="hp-page">
      <div className="hp-page-header">{t('offers.browseTitle')}</div>

      {offers.length === 0 ? (
        <p className="hp-empty">{t('offers.none')}</p>
      ) : (
        <div className="hp-list">
          {offers.map((offer) => (
            <button key={offer.id} className="hp-list-row" onClick={() => navigate(`/offers/${offer.id}`)}>
              <div className="hp-list-row-main">
                <span className="hp-list-title">{offer.title}</span>
                <span className="hp-list-subtitle">
                  {starToTomanRate
                    ? t('offers.priceLineWithToman', {
                        price: offer.price_stars,
                        minutes: offer.display_duration_minutes,
                        toman: (offer.price_stars * starToTomanRate).toLocaleString('en-US'),
                      })
                    : t('offers.priceLine', {
                        price: offer.price_stars,
                        minutes: offer.display_duration_minutes,
                      })}
                </span>
              </div>
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
