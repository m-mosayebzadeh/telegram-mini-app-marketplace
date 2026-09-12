import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { getPricingConfig } from '../lib/pricing'
import { computePriceBreakdown } from '../lib/priceBreakdown'
import type { PricingConfig } from '../lib/types'

/**
 * One line under a Star price, saying what that price means in Toman —
 * but a different thing depending on who is looking (see priceBreakdown.ts
 * for why each side is shown a single number and not a breakdown):
 *
 * - `buyer`: the amount they will be charged.
 * - `provider`: what they will actually earn, after the platform's
 *   commission. For a chat that commission is only ever taken once the
 *   session has closed cleanly, never at the moment of sale.
 */
export function PriceBreakdown({
  priceStars,
  audience = 'buyer',
}: {
  priceStars: number
  audience?: 'buyer' | 'provider'
}) {
  const { t, i18n } = useTranslation()
  const [pricing, setPricing] = useState<PricingConfig | null>(null)
  useEffect(() => {
    let active = true
    getPricingConfig()
      .then((c) => {
        if (active) setPricing(c)
      })
      .catch(() => {})
    return () => {
      active = false
    }
  }, [])
  if (!pricing || priceStars <= 0) return null

  const breakdown = computePriceBreakdown(
    priceStars,
    pricing.star_to_toman_rate,
    audience === 'provider' ? pricing.chat_commission_percent : 0,
  )
  const isProvider = audience === 'provider'
  return (
    <div className="hp-kv-row">
      <span className="hp-kv-label">
        {isProvider ? t('offers.providerNetEarnings') : t('offers.priceInToman')}
      </span>
      <span className="hp-kv-value">
        {(isProvider ? breakdown.netProviderToman : breakdown.grossPriceToman).toLocaleString(
          i18n.language,
        )}
      </span>
    </div>
  )
}
