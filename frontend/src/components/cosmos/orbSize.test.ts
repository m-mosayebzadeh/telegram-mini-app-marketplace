import { describe, expect, it } from 'vitest'
import { ORB_MAX_SIZE, ORB_MIN_SIZE, clamp01, orbSize } from './orbSize'

/** Size is presence, in a narrow band (CLAUDE.md: one meaning per property). */
describe('how big an orb is', () => {
  it('stays inside the band, whatever the presence', () => {
    expect(orbSize(0)).toBe(ORB_MIN_SIZE)
    expect(orbSize(1)).toBe(ORB_MAX_SIZE)
    expect(orbSize(5)).toBe(ORB_MAX_SIZE)
    expect(orbSize(-1)).toBe(ORB_MIN_SIZE)
  })

  it('reads a broken value as no presence at all', () => {
    expect(clamp01(Number.NaN)).toBe(0)
    expect(orbSize(Number.NaN)).toBe(ORB_MIN_SIZE)
  })
})
