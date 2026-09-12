import { describe, it, expect } from 'vitest'
import { computePriceBreakdown } from './priceBreakdown'
describe('purchase price without commission', () => {
  it('shows the complete price at the current conversion rate', () => {
    expect(computePriceBreakdown(25, 2500)).toEqual({
      grossPriceStars: 25,
      grossPriceToman: 62500,
    })
  })
})
