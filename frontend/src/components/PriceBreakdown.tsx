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
  // 'full' (default): Toman equivalent + commission + net earnings —
  // meaningful only to the PROVIDER, since the commission and net
  // earnings are their own business numbers, not something a buyer
  // needs or should see. 'grossOnly': just the Toman equivalent of the
  // price — all a buyer needs to know ("this costs X Stars / Y Toman"),
  // with no commission/earnings breakdown exposed to them at all.
  variant?: 'full' | 'grossOnly'
}

/**
 * Shows a price's Toman equivalent — and, for the provider only, the
 * commission/net-earnings split — live while a provider is typing a
 * price (CreateOffer.tsx) or for an existing offer (OfferDetail.tsx,
 * which picks the variant based on whether the viewer owns the offer).
 * Purely informational: the backend always computes and freezes the
 * real numbers itself at payment time (see Transaction), this never
 * feeds back into an actual charge.
 *
 * Renders nothing (not even a loading spinner) until both a valid price
 * and the pricing config are available — there's nothing meaningful to
 * show before that, and popping in a spinner for what's normally an
 * instant, cached fetch would just be visual noise.
 */
export function PriceBreakdown({ priceStars, commissionKind, variant = 'full' }: PriceBreakdownProps) {
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

  if (variant === 'grossOnly') {
    return <Cell subtitle={t('offers.priceInToman')}>{breakdown.grossPriceToman.toLocaleString('en-US')}</Cell>
  }

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
