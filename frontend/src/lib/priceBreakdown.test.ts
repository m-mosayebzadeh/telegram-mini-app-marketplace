import { describe, it, expect } from 'vitest'
import { computePriceBreakdown } from './priceBreakdown'

describe('computePriceBreakdown', () => {
  it('gives the buyer the full price at the current conversion rate', () => {
    const breakdown = computePriceBreakdown(25, 2500)
    expect(breakdown.grossPriceDrops).toBe(25)
    expect(breakdown.grossPriceToman).toBe(62500)
  })

  it('with no commission, the provider earns the whole price', () => {
    const breakdown = computePriceBreakdown(25, 2500)
    expect(breakdown.netProviderDrops).toBe(25)
    expect(breakdown.netProviderToman).toBe(62500)
  })

  it('subtracts the commission from what the provider earns', () => {
    const breakdown = computePriceBreakdown(40, 2500, 10)
    expect(breakdown.netProviderDrops).toBe(36)
    expect(breakdown.netProviderToman).toBe(90000)
    // The buyer's side is untouched by the commission.
    expect(breakdown.grossPriceToman).toBe(100000)
  })

  it('rounds a fractional commission in the provider favour', () => {
    // 5% of 25 Drops is 1.25 — the platform takes 1, not 2.
    expect(computePriceBreakdown(25, 2500, 5).netProviderDrops).toBe(24)
    // 10% of 25 Drops is 2.5 — again floored on the platform's side.
    expect(computePriceBreakdown(25, 2500, 10).netProviderDrops).toBe(23)
  })
})
