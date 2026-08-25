/**
 * Minimal Gregorian <-> Jalali (Persian/Solar Hijri) calendar conversion,
 * plus the small bits of formatting the profile birthday feature needs.
 *
 * Implements the standard arithmetic algorithm (the same one behind the
 * jalaali-js package and originally described by Kazimierz M. Borkowski)
 * directly, with no external dependency — the app only ever needs
 * "convert a month/day" and "name the month", not a full calendar
 * library, and avoiding the dependency means one less thing to `npm
 * install` before this feature shows up.
 *
 * Only Profile.birthday_month/birthday_day (see
 * backend/app/models/profile.py) need this: no year is ever stored or
 * computed here, on purpose — see that field's docstring for why.
 */

function div(a: number, b: number): number {
  return ~~(a / b)
}
function mod(a: number, b: number): number {
  return a - ~~(a / b) * b
}

// Break points of the 33-year leap-year cycle used by the algorithm —
// not calendar-specific magic numbers to tune, just the fixed table the
// arithmetic method is built on.
const BREAKS = [
  -61, 9, 38, 199, 426, 686, 756, 818, 1111, 1181, 1210, 1635, 2060, 2097, 2192, 2262, 2324, 2394,
  2456, 3178,
]

function jalCal(jy: number): { leap: number; gy: number; march: number } {
  const gy = jy + 621
  let leapJ = -14
  let jp = BREAKS[0]
  let jump = 0
  for (let i = 1; i < BREAKS.length; i += 1) {
    const jm = BREAKS[i]
    jump = jm - jp
    if (jy < jm) break
    leapJ = leapJ + div(jump, 33) * 8 + div(mod(jump, 33), 4)
    jp = jm
  }
  let n = jy - jp
  leapJ = leapJ + div(n, 33) * 8 + div(mod(n, 33) + 3, 4)
  if (mod(jump, 33) === 4 && jump - n === 4) leapJ += 1
  const leapG = div(gy, 4) - div((div(gy, 100) + 1) * 3, 4) - 150
  const march = 20 + leapJ - leapG
  if (jump - n < 6) n = n - jump + div(jump, 33) * 33
  let leap = mod(mod(n + 1, 33) - 1, 4)
  if (leap === -1) leap = 4
  return { leap, gy, march }
}

function g2d(gy: number, gm: number, gd: number): number {
  let d =
    div((gy + div(gm - 8, 6) + 100100) * 1461, 4) + div(153 * mod(gm + 9, 12) + 2, 5) + gd - 34840408
  d = d - div(div(gy + 100100 + div(gm - 8, 6), 100) * 3, 4) + 752
  return d
}

function d2g(jdn: number): { gy: number; gm: number; gd: number } {
  let j = 4 * jdn + 139361631
  j = j + div(div(4 * jdn + 183187720, 146097) * 3, 4) * 4 - 3908
  const i = div(mod(j, 1461), 4) * 5 + 308
  const gd = div(mod(i, 153), 5) + 1
  const gm = mod(div(i, 153), 12) + 1
  const gy = div(j, 1461) - 100100 + div(8 - gm, 6)
  return { gy, gm, gd }
}

function d2j(jdn: number): { jy: number; jm: number; jd: number } {
  const gy = d2g(jdn).gy
  let jy = gy - 621
  const r = jalCal(jy)
  const jdn1f = g2d(r.gy, 3, r.march)
  let k = jdn - jdn1f
  if (k >= 0) {
    if (k <= 185) {
      return { jy, jm: 1 + div(k, 31), jd: mod(k, 31) + 1 }
    }
    k -= 186
  } else {
    jy -= 1
    k += 179
    if (r.leap === 1) k += 1
  }
  return { jy, jm: 7 + div(k, 30), jd: mod(k, 30) + 1 }
}

function j2d(jy: number, jm: number, jd: number): number {
  const r = jalCal(jy)
  return g2d(r.gy, 3, r.march) + (jm - 1) * 31 - div(jm, 7) * (jm - 7) + jd - 1
}

/** Gregorian month/day (no year — see the module docstring) -> Jalali
 * month/day, anchored to `gregorianYear` purely to pick the right side
 * of a Jalali/Gregorian year boundary; the returned month/day is what
 * matters, not the year that comes back. */
export function gregorianMonthDayToJalali(
  gregorianYear: number,
  gm: number,
  gd: number,
): { jm: number; jd: number } {
  const { jm, jd } = d2j(g2d(gregorianYear, gm, gd))
  return { jm, jd }
}

/** Jalali month/day -> Gregorian month/day, anchored to `jalaliYear` the
 * same way — see gregorianMonthDayToJalali. `jalaliYear` must be an
 * actual JALALI year (e.g. 1405) — use jalaliYearFor() to get the
 * current one; passing a Gregorian year here silently produces a wrong
 * date near the Esfand/Farvardin boundary (the two calendars' leap
 * years don't line up), since it changes which year's leap rule
 * jalCal() applies. */
export function jalaliMonthDayToGregorian(
  jalaliYear: number,
  jm: number,
  jd: number,
): { gm: number; gd: number } {
  const { gm, gd } = d2g(j2d(jalaliYear, jm, jd))
  return { gm, gd }
}

/** The current Jalali year — the correct `jalaliYear` anchor to pass to
 * jalaliMonthDayToGregorian() when converting a value picked "now"
 * (e.g. a birthday edit form), as opposed to gregorianMonthDayToJalali's
 * Gregorian-year anchor. */
export function jalaliYearFor(now = new Date()): number {
  return d2j(g2d(now.getFullYear(), now.getMonth() + 1, now.getDate())).jy
}

/** How many days month `jm` has in Jalali year `jy` (29 or 30 for
 * Esfand/month 12 depending on leap year, 30 for months 7-11, 31 for
 * months 1-6) — computed as an actual day-count difference rather than
 * hardcoded, so it's automatically correct for every leap year. */
export function daysInJalaliMonth(jy: number, jm: number): number {
  const nextMonthStart = jm === 12 ? j2d(jy + 1, 1, 1) : j2d(jy, jm + 1, 1)
  return nextMonthStart - j2d(jy, jm, 1)
}

export const JALALI_MONTH_NAMES = [
  'فروردین',
  'اردیبهشت',
  'خرداد',
  'تیر',
  'مرداد',
  'شهریور',
  'مهر',
  'آبان',
  'آذر',
  'دی',
  'بهمن',
  'اسفند',
]

const PERSIAN_DIGITS = ['۰', '۱', '۲', '۳', '۴', '۵', '۶', '۷', '۸', '۹']

export function toPersianDigits(value: number | string): string {
  return String(value).replace(/[0-9]/g, (digit) => PERSIAN_DIGITS[Number(digit)])
}

/** "۲۶ مرداد" for a stored Gregorian (birthday_month, birthday_day) pair
 * — the exact format the profile mockups used. `now` anchors the
 * Gregorian->Jalali conversion to the right year (rare, but matters right
 * at the Nowruz boundary); defaults to the real current time. */
export function formatJalaliBirthday(gregorianMonth: number, gregorianDay: number, now = new Date()): string {
  const { jm, jd } = gregorianMonthDayToJalali(now.getFullYear(), gregorianMonth, gregorianDay)
  return `${toPersianDigits(jd)} ${JALALI_MONTH_NAMES[jm - 1]}`
}

/** The Gregorian day-of-month to actually observe a (month, day)
 * birthday in a given year — clamped to that month's real length so a
 * Feb 29 birthday lands on Feb 28 in a non-leap `year`, instead of the
 * `Date` constructor silently rolling it over into March. */
function clampedBirthdayDay(year: number, gregorianMonth: number, gregorianDay: number): number {
  const daysInMonth = new Date(year, gregorianMonth, 0).getDate()
  return Math.min(gregorianDay, daysInMonth)
}

/** Days from `now` until the next occurrence of the (month, day)
 * birthday, in Gregorian terms (so it doesn't need the calendar
 * conversion at all) — 0 if today is the birthday. */
export function daysUntilNextBirthday(gregorianMonth: number, gregorianDay: number, now = new Date()): number {
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate())
  let next = new Date(
    now.getFullYear(),
    gregorianMonth - 1,
    clampedBirthdayDay(now.getFullYear(), gregorianMonth, gregorianDay),
  )
  if (next.getTime() < today.getTime()) {
    const nextYear = now.getFullYear() + 1
    next = new Date(nextYear, gregorianMonth - 1, clampedBirthdayDay(nextYear, gregorianMonth, gregorianDay))
  }
  return Math.round((next.getTime() - today.getTime()) / (1000 * 60 * 60 * 24))
}
