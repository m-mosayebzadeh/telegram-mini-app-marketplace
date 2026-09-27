import { describe, it, expect } from 'vitest'
import { timeAgo, timeSince } from './timeAgo'

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

// The news cards' corner, as in the approved prototype: «۵ دقیقه», no "ago".
describe('time since', () => {
  it('says how long, without the "ago"', () => {
    expect(timeSince('2026-09-27T11:55:00Z', 'en', now)).toBe('5 minutes')
    expect(timeSince('2026-09-27T09:00:00Z', 'en', now)).toBe('3 hours')
    expect(timeSince('2026-09-27T11:55:00Z', 'fa', now)).toBe('۵ دقیقه')
  })

  it('says "now" for anything under a minute, and for a clock slightly ahead', () => {
    expect(timeSince('2026-09-27T11:59:35Z', 'fa', now)).toBe('همین حالا')
    expect(timeSince('2026-09-27T12:00:20Z', 'fa', now)).toBe('همین حالا')
  })

  it('stays quiet about a date it cannot read', () => {
    expect(timeSince('not a date', 'en', now)).toBe('')
  })
})
