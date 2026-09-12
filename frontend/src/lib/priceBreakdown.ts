/** New purchases transfer the full price; fees apply at withdrawal only. */
export function computePriceBreakdown(
  grossPriceStars: number,
  starToTomanRate: number,
) {
  return { grossPriceStars, grossPriceToman: grossPriceStars * starToTomanRate }
}
