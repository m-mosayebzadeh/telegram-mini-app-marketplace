/**
 * "5 minutes ago", in the reader's own language and digits.
 *
 * Built on the browser's own relative-time formatter rather than on
 * hand-written strings, so it is right in Persian ("۵ دقیقه پیش"), English
 * and every language the product will grow into (it is not an Iran-only
 * product — TECHNICAL_REQUIREMENTS.md, and the owner's standing direction).
 */
const STEPS: Array<[Intl.RelativeTimeFormatUnit, number]> = [
  ['second', 60],
  ['minute', 60],
  ['hour', 24],
  ['day', 7],
  ['week', 4.35],
  ['month', 12],
  ['year', Infinity],
]

export function timeAgo(iso: string, language: string, now: number = Date.now()): string {
  const then = new Date(iso).getTime()
  if (Number.isNaN(then)) return ''
  let amount = (then - now) / 1000
  const format = new Intl.RelativeTimeFormat(language, { numeric: 'auto' })
  // Under a minute is "now", as in the approved prototype: counting
  // seconds on a conversation that just happened is noise.
  // The browser's Persian for it is the formal «اکنون»; the prototype —
  // and ordinary speech — says «همین حالا».
  if (Math.abs(amount) < 60) return language.startsWith('fa') ? 'همین حالا' : format.format(0, 'second')
  for (const [unit, size] of STEPS) {
    if (Math.abs(amount) < size) return format.format(Math.round(amount), unit)
    amount /= size
  }
  return ''
}

/**
 * "5 minutes" — how long since, without the "ago".
 *
 * The approved prototype's news cards say «۵ دقیقه», not «۵ دقیقه پیش»: on
 * a small card in a stream of recent things the "ago" is understood, and
 * dropping it keeps the corner quiet. Built on the browser's own unit
 * formatter, for the same reason as timeAgo.
 */
export function timeSince(iso: string, language: string, now: number = Date.now()): string {
  const then = new Date(iso).getTime()
  if (Number.isNaN(then)) return ''
  let amount = Math.max(0, (now - then) / 1000)
  if (amount < 60) return language.startsWith('fa') ? 'همین حالا' : new Intl.RelativeTimeFormat(language, { numeric: 'auto' }).format(0, 'second')
  for (const [unit, size] of STEPS) {
    if (amount < size) {
      return new Intl.NumberFormat(language, { style: 'unit', unit, unitDisplay: 'long' }).format(Math.round(amount))
    }
    amount /= size
  }
  return ''
}
