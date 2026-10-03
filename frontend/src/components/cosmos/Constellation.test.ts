import { describe, expect, it } from 'vitest'
import { MEET_SHARED, MEET_SIDE, meetingLayout, SKY_WIDTH } from './meetingLayout'

/** Where two skies meet (section 32): it has to hold eighty friends as
 *  well as eight, by showing a few of each side. */
describe('where the stars go', () => {
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
