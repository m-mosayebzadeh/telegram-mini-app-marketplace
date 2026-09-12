import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { getPricingConfig } from '../lib/pricing'

export function PriceBreakdown({ priceStars }: { priceStars: number }) {
  const { t, i18n } = useTranslation()
  const [rate, setRate] = useState<number | null>(null)
  useEffect(() => {
    let active = true
    getPricingConfig()
      .then((c) => {
        if (active) setRate(c.star_to_toman_rate)
      })
      .catch(() => {})
    return () => {
      active = false
    }
  }, [])
  if (!rate || priceStars <= 0) return null
  return (
    <div className="hp-kv-row">
      <span className="hp-kv-label">{t('offers.priceInToman')}</span>
      <span className="hp-kv-value">
        {(priceStars * rate).toLocaleString(i18n.language)}
      </span>
    </div>
  )
}
