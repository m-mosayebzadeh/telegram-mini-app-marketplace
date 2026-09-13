/**
 * What each side of a purchase should be told about a price.
 *
 * A buyer only ever sees what they pay: the platform's commission is not
 * their business and showing it would only make the price look negotiable.
 *
 * A provider is shown one number too — what they will actually earn — rather
 * than a price/commission/net breakdown. The commission is real and documented,
 * but a running subtraction next to the price they just typed makes every
 * provider feel charged before they have done anything; the net figure is the
 * only one they can act on.
 *
 * The commission is floored (`Math.floor`), exactly like the backend's
 * split_commission(): a fraction of a Toman that rounding would otherwise lose
 * always ends up on the provider's side, never the platform's, so the two
 * never disagree about what a provider is owed.
 */
export function computePriceBreakdown(
  grossPriceDrops: number,
  dropToTomanRate: number,
  commissionPercent = 0,
) {
  const commissionDrops = Math.floor((grossPriceDrops * commissionPercent) / 100)
  const netProviderDrops = grossPriceDrops - commissionDrops
  return {
    grossPriceDrops,
    grossPriceToman: grossPriceDrops * dropToTomanRate,
    netProviderDrops,
    netProviderToman: netProviderDrops * dropToTomanRate,
  }
}
