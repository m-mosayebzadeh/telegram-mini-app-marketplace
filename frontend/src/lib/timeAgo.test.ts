import { describe, it, expect } from 'vitest'
import { timeAgo } from './timeAgo'

const now = new Date('2026-09-27T12:00:00Z').getTime()

describe('time ago', () => {
  it('says minutes in English', () => {
    expect(timeAgo('2026-09-27T11:55:00Z', 'en', now)).toBe('5 minutes ago')
  })

  it('climbs to hours and days', () => {
    expect(timeAgo('2026-09-27T09:00:00Z', 'en', now)).toBe('3 hours ago')
    expect(timeAgo('2026-09-25T12:00:00Z', 'en', now)).toBe('2 days ago')
  })

  it('speaks Persian, with Persian digits', () => {
    expect(timeAgo('2026-09-27T11:55:00Z', 'fa', now)).toMatch(/۵/)
  })

  it('says "now" for anything under a minute', () => {
    expect(timeAgo('2026-09-27T11:59:35Z', 'en', now)).toBe('now')
    expect(timeAgo('2026-09-27T11:59:35Z', 'fa', now)).toBe('همین حالا')
  })

  it('stays quiet about a date it cannot read', () => {
    expect(timeAgo('not a date', 'en', now)).toBe('')
  })
})
