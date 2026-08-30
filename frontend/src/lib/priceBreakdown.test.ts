import { describe, expect, it } from 'vitest'
import { computePriceBreakdown } from './priceBreakdown'

describe('computePriceBreakdown', () => {
  // Same cases as backend/tests/test_wallet.py's
  // test_split_commission_rounds_in_providers_favor — this function
  // must match split_commission() exactly, or a provider would see one
  // preview number here and a different real number once actually paid.
  it.each([
    [40, 10, 4, 36], // divides evenly
    [25, 10, 2, 23], // 2.5 -> rounds DOWN; the extra half-star goes to the provider
    [100, 5, 5, 95], // the content commission rate
    [1, 10, 0, 1], // smallest possible price: commission floors to 0
    [0, 10, 0, 0], // degenerate, but shouldn't throw
  ])(
    'splits %i Stars at %i%% into %i commission / %i net, matching the backend',
    (grossStars, commissionPercent, expectedCommission, expectedNet) => {
      const result = computePriceBreakdown(grossStars, commissionPercent, /* rate */ 1)

      expect(result.commissionStars).toBe(expectedCommission)
      expect(result.netProviderStars).toBe(expectedNet)
      // The split must always account for the whole price.
      expect(result.commissionStars + result.netProviderStars).toBe(grossStars)
    },
  )

  it('multiplies every Star figure by the Toman rate', () => {
    const result = computePriceBreakdown(40, 10, 4000)

    expect(result.grossPriceToman).toBe(160_000)
    expect(result.commissionToman).toBe(16_000)
    expect(result.netProviderToman).toBe(144_000)
  })
})
