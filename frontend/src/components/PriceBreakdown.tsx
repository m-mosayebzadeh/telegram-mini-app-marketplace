import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Cell } from '@telegram-apps/telegram-ui'
import { computePriceBreakdown, type PriceBreakdown as PriceBreakdownResult } from '../lib/priceBreakdown'
import { getPricingConfig } from '../lib/pricing'

interface PriceBreakdownProps {
  priceStars: number
  // Which commission rate applies — offers are chat-only today, but
  // this component is written to also cover a future photo/offer mix
  // without needing a second copy of it (see GET /pricing, which
  // already returns both rates).
  commissionKind: 'chat' | 'photo'
}

/**
 * Shows "X Stars = Y Toman, Z commission, W net" under a price field —
 * live while a provider is typing (CreateOffer.tsx) or for an existing
 * offer (OfferDetail.tsx). Purely informational: the backend always
 * computes and freezes the real numbers itself at payment time (see
 * Transaction), this never feeds back into an actual charge.
 *
 * Renders nothing (not even a loading spinner) until both a valid price
 * and the pricing config are available — there's nothing meaningful to
 * show before that, and popping in a spinner for what's normally an
 * instant, cached fetch would just be visual noise.
 */
export function PriceBreakdown({ priceStars, commissionKind }: PriceBreakdownProps) {
  const { t } = useTranslation()
  const [breakdown, setBreakdown] = useState<PriceBreakdownResult | null>(null)

  useEffect(() => {
    if (!priceStars || priceStars <= 0) {
      setBreakdown(null)
      return
    }
    let cancelled = false
    getPricingConfig().then((config) => {
      if (cancelled) return
      const percent =
        commissionKind === 'chat' ? config.chat_commission_percent : config.photo_commission_percent
      setBreakdown(computePriceBreakdown(priceStars, percent, config.star_to_toman_rate))
    })
    return () => {
      cancelled = true
    }
  }, [priceStars, commissionKind])

  if (!breakdown) return null

  return (
    <>
      <Cell subtitle={t('offers.priceInToman')}>{breakdown.grossPriceToman.toLocaleString('en-US')}</Cell>
      <Cell subtitle={t('offers.commission')}>
        {t('offers.starsAndToman', {
          stars: breakdown.commissionStars,
          toman: breakdown.commissionToman.toLocaleString('en-US'),
        })}
      </Cell>
      <Cell subtitle={t('offers.netEarnings')}>
        {t('offers.starsAndToman', {
          stars: breakdown.netProviderStars,
          toman: breakdown.netProviderToman.toLocaleString('en-US'),
        })}
      </Cell>
    </>
  )
}
