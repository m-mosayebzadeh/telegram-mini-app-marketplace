/**
 * Splits a Star price into (commissionStars, netProviderStars) — a
 * direct mirror of the backend's split_commission()
 * (backend/app/wallet/service.py). Stars are a whole unit, so a
 * percentage that doesn't divide evenly is rounded DOWN on the
 * commission side, same as the backend: a provider is never
 * shortchanged by a fractional Star. This has to match the backend
 * exactly, or a provider would see one preview number here and a
 * different real number once they actually get paid — see
 * priceBreakdown.test.ts for cases cross-checked against the backend's
 * own test suite.
 */
function splitCommission(
  grossPriceStars: number,
  commissionPercent: number,
): { commissionStars: number; netProviderStars: number } {
  const commissionStars = Math.floor((grossPriceStars * commissionPercent) / 100)
  return { commissionStars, netProviderStars: grossPriceStars - commissionStars }
}

export interface PriceBreakdown {
  grossPriceStars: number
  grossPriceToman: number
  commissionStars: number
  commissionToman: number
  netProviderStars: number
  netProviderToman: number
}

/**
 * The full Stars -> Toman + commission breakdown for one price, using
 * the current rate/commission from GET /pricing (see lib/pricing.ts).
 * Used both as a live preview while a provider is typing a price
 * (CreateOffer.tsx) and to explain an existing offer's price
 * (OfferDetail.tsx) — purely informational in both cases; the backend
 * always computes and freezes the real numbers itself at payment time
 * (see Transaction in backend/app/models/transaction.py), this never
 * feeds back into an actual charge.
 */
export function computePriceBreakdown(
  grossPriceStars: number,
  commissionPercent: number,
  starToTomanRate: number,
): PriceBreakdown {
  const { commissionStars, netProviderStars } = splitCommission(grossPriceStars, commissionPercent)
  return {
    grossPriceStars,
    grossPriceToman: grossPriceStars * starToTomanRate,
    commissionStars,
    commissionToman: commissionStars * starToTomanRate,
    netProviderStars,
    netProviderToman: netProviderStars * starToTomanRate,
  }
}
