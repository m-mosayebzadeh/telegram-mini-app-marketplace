import { describe, it, expect } from 'vitest'
import {
  GAP, ITEM_H, clampScroll, edgeFade, emerging, endY, flightPoint, maxScroll, slotY, streamGeometry,
  swallowed, toSpine, touchable,
} from './newsStream'

/**
 * The news region's layout is the approved prototype's arithmetic
 * (docs/prototypes/regions.html, geo() and layoutNews()). These pin the
 * numbers, so a later change cannot quietly move the region away from
 * what the owner approved.
 */
describe('news stream geometry', () => {
  // A 390 × 844 phone with no notch: the size the prototype was compared at.
  const phone = streamGeometry({ width: 390, height: 844, safeTop: 0, safeBottom: 0, rtl: true })

  it('places the holes, the line and the cards where the prototype does', () => {
    expect(phone.spineX).toBe(330)
    expect(phone.srcY).toBe(122)
    expect(phone.top).toBe(174)
    expect(phone.bottom).toBe(612)
    expect(phone.sinkY).toBe(648)
    expect(phone.cardLeft).toBe(16)
    expect(phone.cardWidth).toBe(298)
  })

  it('hangs a card so its connector ends on the line', () => {
    // The CSS draws a 15 px connector out of the card's near edge and a
    // 9 px dot whose far side is 20 px out: the dot's middle is on the line.
    const nearEdge = phone.cardLeft + phone.cardWidth
    expect(nearEdge + 15).toBe(phone.spineX - 1)
    expect(Math.abs(nearEdge + 20 - 4.5 - phone.spineX)).toBeLessThanOrEqual(0.5)
  })

  it('moves everything down and up by the phone’s safe areas', () => {
    const notched = streamGeometry({ width: 390, height: 844, safeTop: 47, safeBottom: 34, rtl: true })
    expect(notched.srcY).toBe(phone.srcY + 47)
    expect(notched.sinkY).toBe(phone.sinkY - 34)
  })

  it('mirrors the region for a left-to-right language', () => {
    const ltr = streamGeometry({ width: 390, height: 844, safeTop: 0, safeBottom: 0, rtl: false })
    expect(ltr.spineX).toBe(60)
    expect(ltr.cardLeft).toBe(76)
    // The card still ends 44 px short of the line, on the other side.
    expect(ltr.cardLeft - ltr.spineX).toBe(phone.spineX - (phone.cardLeft + phone.cardWidth))
  })

  it('steps cards by their height and gap, and scrolls them together', () => {
    expect(slotY(phone, 0, 0)).toBe(174)
    expect(slotY(phone, 2, 0)).toBe(174 + 2 * (ITEM_H + GAP))
    expect(slotY(phone, 2, 50)).toBe(slotY(phone, 2, 0) - 50)
  })

  it('scrolls only as far as there are cards to see', () => {
    expect(maxScroll(phone, 3)).toBe(0)
    expect(maxScroll(phone, 10)).toBe(10 * 76 + 40 - (612 - 174))
    expect(clampScroll(phone, 10, -20)).toBe(0)
    expect(clampScroll(phone, 10, 99999)).toBe(maxScroll(phone, 10))
  })

  it('fades cards at both ends of the stream instead of cutting them', () => {
    expect(edgeFade(phone, phone.top)).toBe(1)
    expect(edgeFade(phone, phone.top - 35)).toBeCloseTo(0.5)
    expect(edgeFade(phone, phone.top - 100)).toBe(0)
    expect(edgeFade(phone, phone.bottom + 30)).toBe(0)
    // A card that has mostly faded cannot be touched.
    expect(touchable(edgeFade(phone, phone.top - 50))).toBe(false)
    expect(touchable(edgeFade(phone, phone.top))).toBe(true)
  })

  it('shrinks a card into each hole, centred on the line', () => {
    expect(toSpine(phone)).toBe(330 - 16 - 149)
    expect(emerging(phone)).toBe('translate3d(165px, 90px, 0) scale(0.05) rotate(-260deg)')
    expect(swallowed(phone)).toBe('translate3d(165px, 616px, 0) scale(0.04) rotate(480deg)')
  })

  it('puts the "that is all" line under the last card, or near the top', () => {
    expect(endY(phone, 0, 0)).toBe(214)
    expect(endY(phone, 2, 0)).toBe(slotY(phone, 2, 0) + 8)
  })

  it('flies from the card to Sol along a curve that bows out to one side', () => {
    const from = { x: 300, y: 200 }
    const to = { x: 195, y: 790 }
    expect(flightPoint(from, to, 0, true)).toEqual(from)
    expect(flightPoint(from, to, 1, true)).toEqual(to)
    // Half way, it has swung past both ends on the far side from the line.
    expect(flightPoint(from, to, 0.5, true).x).toBeLessThan(to.x)
    expect(flightPoint(from, to, 0.5, false).x).toBeGreaterThan(from.x)
  })
})
