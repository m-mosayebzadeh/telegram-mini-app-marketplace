/**
 * Persian (۰-۹) and Arabic-Indic (٠-٩) digits folded to ASCII.
 *
 * The app's default language is Persian and phone keyboards follow the
 * app, so this is the ordinary way a number arrives here — not an edge
 * case. Every numeric field goes through it, so the same number stores
 * identically however it was typed.
 */
export function toLatinDigits(value: string): string {
  return value
    .replace(/[۰-۹]/g, (c) => String(c.charCodeAt(0) - 1776))
    .replace(/[٠-٩]/g, (c) => String(c.charCodeAt(0) - 1632))
}

/**
 * Everything except digits removed — "1,000,000" back to "1000000".
 *
 * Persian digits are folded FIRST. Stripping non-ASCII digits before
 * folding them is the bug this function exists to make impossible: it
 * silently deletes what a Persian speaker just typed, and the field goes
 * blank with no explanation.
 */
export function digitsOnly(value: string): string {
  return toLatinDigits(value).replace(/\D/g, '')
}

/**
 * Formats a numeric string with comma thousand-separators, e.g.
 * "1000000" -> "1,000,000". Used for price/amount inputs — plain HTML
 * `<input type="number">` can't display separators at all (the browser
 * rejects the comma characters), so those fields use a text input and
 * this function instead (see components/NumberField.tsx).
 *
 * Empty or non-numeric input passes through as an empty string, not
 * "0" or "NaN" — an input the user hasn't typed anything into yet
 * should just look empty.
 */
export function formatThousands(value: string): string {
  const digits = digitsOnly(value)
  return digits ? Number(digits).toLocaleString('en-US') : ''
}

/** The ten digits of a language, in order, indexed 0-9. */
const DIGIT_SETS: Record<string, string> = {
  fa: '۰۱۲۳۴۵۶۷۸۹',
}

/**
 * ASCII digits rewritten in the language's own digits, for DISPLAY only.
 *
 * Persian text with Latin numerals in it looks like two languages sharing
 * a line, and an input is not exempt: a field reading "100" under a label
 * reading "چقدر" is the same mismatch as a caption would be. What is
 * STORED stays ASCII — this is the last thing that happens before the
 * characters reach the screen, and digitsOnly() undoes it on the way back
 * in, so the two can never disagree.
 *
 * A language with no entry here keeps ASCII, which is the right answer
 * for English and a safe one for anything unlisted.
 */
export function localizeDigits(value: string, language: string): string {
  const digits = DIGIT_SETS[language.split('-')[0]]
  if (!digits) return value
  return value.replace(/[0-9]/g, (d) => digits[Number(d)])
}
