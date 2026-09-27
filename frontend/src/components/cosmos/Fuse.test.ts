import { describe, expect, it } from 'vitest'
import { clockText, cordLeft, msLeft } from './Fuse'

/** The payment window's countdown (TECHNICAL_REQUIREMENTS.md section 16). */
describe('the fuse', () => {
  const start = '2026-09-27T10:00:00Z'
  const deadline = '2026-09-27T10:15:00Z'
  const at = (iso: string) => Date.parse(iso)

  it('counts down in minutes and seconds', () => {
    expect(clockText(msLeft(deadline, at('2026-09-27T10:02:30Z')), 'en')).toBe('12:30')
  })

  it('writes the time in the reader\'s digits', () => {
    expect(clockText(90_000, 'fa')).toBe('۱:۳۰')
  })

  it('never goes below zero', () => {
    expect(msLeft(deadline, at('2026-09-27T11:00:00Z'))).toBe(0)
  })

  it('burns the cord in proportion to the time gone', () => {
    expect(cordLeft(deadline, start, at('2026-09-27T10:00:00Z'))).toBe(1)
    expect(cordLeft(deadline, start, at('2026-09-27T10:07:30Z'))).toBeCloseTo(0.5)
    expect(cordLeft(deadline, start, at('2026-09-27T10:20:00Z'))).toBe(0)
  })

  it('has no cord when nobody knows when the wait began', () => {
    expect(cordLeft(deadline, null, at(start))).toBeNull()
  })
})
