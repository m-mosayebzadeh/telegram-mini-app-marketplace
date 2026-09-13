import { describe, it, expect } from 'vitest'
import { formatBirthday, gregorianToJalali, jalaliToGregorian } from './jalali'

/**
 * A birthday is stored once, in Gregorian, and shown in whichever
 * calendar the reader's language uses. The point of these tests is that
 * it stays the SAME DAY across that switch: someone who picked
 * 1 فروردین 1405 and then reads the app in English must see 21 March
 * 2026, not a different date and not both at once.
 */
describe('formatBirthday', () => {
  it('shows a Persian reader the Jalali date', () => {
    expect(formatBirthday(3, 21, 1995, 'fa')).toBe('۱ فروردین ۱۳۷۴')
  })

  it('shows an English reader the same day in Gregorian', () => {
    expect(formatBirthday(3, 21, 1995, 'en')).toBe('Mar 21, 1995')
  })

  it('leaves the year out when there is none, in both calendars', () => {
    expect(formatBirthday(3, 21, null, 'fa')).toBe('۱ فروردین')
    expect(formatBirthday(3, 21, null, 'en')).toBe('Mar 21')
  })

  it('keeps 29 February, which a non-leap anchor year would lose', () => {
    expect(formatBirthday(2, 29, null, 'en')).toBe('Feb 29')
  })
})

describe('calendar conversion', () => {
  it('round-trips a date through Jalali and back', () => {
    const { jy, jm, jd } = gregorianToJalali(2026, 3, 21)
    expect([jy, jm, jd]).toEqual([1405, 1, 1])
    const { gy, gm, gd } = jalaliToGregorian(1405, 1, 1)
    expect([gy, gm, gd]).toEqual([2026, 3, 21])
  })
})
