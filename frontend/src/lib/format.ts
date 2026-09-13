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
