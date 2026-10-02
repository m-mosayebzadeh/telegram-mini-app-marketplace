import { describe, expect, it } from 'vitest'
import { constellationLayout, MEET_SHARED, MEET_SIDE, meetingLayout, SKY_WIDTH } from './Constellation'

/** Friends as a constellation (section 32): it has to hold eighty as well
 *  as eight. */
describe('where the stars go', () => {
  it('winds down the page four to a row, so eighty friends are a longer sky, not a tangle', () => {
    const few = constellationLayout(3)
    const many = constellationLayout(80)
    expect(many.points).toHaveLength(80)
    expect(many.height).toBeGreaterThan(few.height * 10)
    for (const p of many.points) {
      expect(p.x).toBeGreaterThan(0)
      expect(p.x).toBeLessThan(SKY_WIDTH)
    }
    // Each step is short: the next star is always in reach.
    for (let i = 1; i < many.points.length; i++) {
      const a = many.points[i - 1]
      const b = many.points[i]
      expect(Math.hypot(a.x - b.x, a.y - b.y)).toBeLessThan(130)
    }
  })

  it('starts on the right, the way the page reads', () => {
    const { points } = constellationLayout(2)
    expect(points[0].x).toBeGreaterThan(points[1].x)
  })

  it('puts their sky on the right, yours on the left, the shared down the middle, a few of each', () => {
    const at = meetingLayout(20, 20, 20)
    expect(at.theirs).toHaveLength(MEET_SIDE)
    expect(at.mine).toHaveLength(MEET_SIDE)
    expect(at.shared).toHaveLength(MEET_SHARED)
    expect(Math.min(...at.theirs.map((p) => p.x))).toBeGreaterThan(SKY_WIDTH / 2)
    expect(Math.max(...at.mine.map((p) => p.x))).toBeLessThan(SKY_WIDTH / 2)
    expect(at.shared.every((p) => p.x === SKY_WIDTH / 2)).toBe(true)
  })
})
