import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { getPricingConfig } from '../lib/pricing'
import { computePriceBreakdown } from '../lib/priceBreakdown'
import type { PricingConfig } from '../lib/types'

/**
 * A caption under a Drop price, saying what that price means in Toman — but a
 * different thing depending on who is looking (see priceBreakdown.ts for why
 * each side gets a single number and not a breakdown):
 *
 * - `buyer`: the amount they will be charged.
 * - `provider`: what they will actually earn, plus a plain line naming the
 *   commission. For a chat that commission is only ever taken once the session
 *   has closed cleanly, never at the moment of sale — but the raw price sits
 *   right above this on the same screen, so a smaller number with no
 *   explanation reads as money quietly disappearing.
 *
 * Renders as caption text belonging to whatever row it sits in, not as a row of
 * its own: the price is the headline and this is its footnote.
 */
export function PriceBreakdown({
  priceDrops,
  audience = 'buyer',
}: {
  priceDrops: number
  audience?: 'buyer' | 'provider'
}) {
  const { t } = useTranslation()
  const [pricing, setPricing] = useState<PricingConfig | null>(null)
  useEffect(() => {
    let active = true
    getPricingConfig()
      .then((config) => {
        if (active) setPricing(config)
      })
      .catch(() => {})
    return () => {
      active = false
    }
  }, [])
  if (!pricing || priceDrops <= 0) return null

  const isProvider = audience === 'provider'
  const commissionPercent = isProvider ? pricing.chat_commission_percent : 0
  const breakdown = computePriceBreakdown(
    priceDrops,
    pricing.drop_to_toman_rate,
    commissionPercent,
  )
  const toman = isProvider ? breakdown.netProviderToman : breakdown.grossPriceToman

  return (
    <span className="ui-stat-note">
      {t(isProvider ? 'offers.providerNetEarnings' : 'offers.priceInToman', {
        amount: toman,
      })}
      {isProvider && commissionPercent > 0 && (
        <> · {t('offers.afterCommission', { percent: commissionPercent })}</>
      )}
    </span>
  )
}
