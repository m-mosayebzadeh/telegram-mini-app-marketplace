import { afterEach, describe, expect, it } from 'vitest'
import { offerLater, offerWaiting } from './pushOffer'

/** "Not now" is respected for a week (section 38). */
describe('when the offer may come again', () => {
  afterEach(() => localStorage.clear())
  it('waits a week after "not now", then offers again', () => {
    const now = 1_800_000_000_000
    expect(offerWaiting(now)).toBe(true)
    offerLater(now)
    expect(offerWaiting(now + 6 * 24 * 3600 * 1000)).toBe(false)
    expect(offerWaiting(now + 8 * 24 * 3600 * 1000)).toBe(true)
  })
})
