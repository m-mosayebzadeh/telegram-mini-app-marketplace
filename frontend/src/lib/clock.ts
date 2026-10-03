/**
 * Echo's hours in the admin panel, as a clock and back.
 *
 * Kept apart from pages/AdminEcho.tsx so that file exports only the component: the
 * development server can then swap the component in place on every save
 * instead of reloading the whole app.
 */

/** "22:30" ⇄ minutes past midnight. 1440, the end of the day, is written
 *  "00:00": a time field has no "24:00" and showed it empty. Saved back it
 *  becomes 0, which the server reads as the same midnight (a window that
 *  closes at 0 wraps, so 22:00 to 00:00 is still "after 22:00"). */
export function toClock(minutes: number): string {
  if (minutes >= 1440) return '00:00'
  const h = Math.floor(minutes / 60)
  const m = minutes % 60
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`
}

export function fromClock(value: string): number | null {
  const match = /^(\d{1,2}):(\d{2})$/.exec(value)
  if (!match) return null
  const minutes = Number(match[1]) * 60 + Number(match[2])
  return minutes >= 0 && minutes <= 1440 ? minutes : null
}
