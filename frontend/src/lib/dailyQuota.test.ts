import { describe, expect, it } from 'vitest'
import { nextUtcMidnight } from './dailyQuota'

describe('nextUtcMidnight', () => {
  it('returns the next UTC midnight for a time earlier the same day', () => {
    const now = new Date('2026-09-07T10:15:00Z')
    expect(nextUtcMidnight(now).toISOString()).toBe('2026-09-08T00:00:00.000Z')
  })

  it('rolls over the month correctly', () => {
    const now = new Date('2026-09-30T23:59:59Z')
    expect(nextUtcMidnight(now).toISOString()).toBe('2026-10-01T00:00:00.000Z')
  })

  it('rolls over the year correctly', () => {
    const now = new Date('2026-12-31T12:00:00Z')
    expect(nextUtcMidnight(now).toISOString()).toBe('2027-01-01T00:00:00.000Z')
  })

  it('still returns TOMORROW even when called exactly at midnight UTC', () => {
    const now = new Date('2026-09-07T00:00:00Z')
    expect(nextUtcMidnight(now).toISOString()).toBe('2026-09-08T00:00:00.000Z')
  })
})
