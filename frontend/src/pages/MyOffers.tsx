import { useCallback, useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { Placeholder, Spinner } from '@telegram-apps/telegram-ui'
import { apiFetch, formatApiError } from '../lib/api'
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
      .catch((err) => setError(formatApiError(err)))
  }, [me])

  useEffect(load, [load])

  async function toggle(offer: Offer) {
    const action = offer.status === 'active' ? 'deactivate' : 'activate'
    try {
      await apiFetch(`/offers/${offer.id}/${action}`, { method: 'POST' })
      load()
    } catch (err) {
      setError(formatApiError(err))
    }
  }

  async function remove(offer: Offer) {
    if (!window.confirm(t('offers.deleteConfirm'))) return
    try {
      await apiFetch(`/offers/${offer.id}`, { method: 'DELETE' })
      load()
    } catch (err) {
      setError(formatApiError(err))
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
    <div className="hp-page">
      <div className="hp-page-header">{t('offers.mineTitle')}</div>

      {offers.length === 0 ? (
        <p className="hp-empty">{t('offers.none')}</p>
      ) : (
        <div className="hp-list">
          {offers.map((offer) => (
            <div key={offer.id} className="hp-list-row">
              <div className="hp-list-row-main" onClick={() => navigate(`/offers/${offer.id}`)} style={{ cursor: 'pointer' }}>
                <span className="hp-list-title">{offer.title}</span>
                <span className="hp-list-subtitle">
                  {t('offers.priceLine', {
                    price: offer.price_stars,
                    minutes: offer.display_duration_minutes,
                  })}{' '}
                  — {offer.status === 'active' ? t('offers.statusActive') : t('offers.statusInactive')}
                </span>
              </div>
              <div className="hp-list-row-actions">
                <button className="hp-btn-sm" onClick={() => toggle(offer)}>
                  {offer.status === 'active' ? t('offers.deactivate') : t('offers.activate')}
                </button>
                <button className="hp-btn-sm" onClick={() => remove(offer)}>
                  {t('offers.delete')}
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      <div className="hp-field" style={{ margin: '0 12px' }}>
        <button className="hp-btn hp-btn-gradient" style={{ width: '100%' }} onClick={() => navigate('/offers/new')}>
          {t('offers.createNew')}
        </button>
      </div>
    </div>
  )
}
