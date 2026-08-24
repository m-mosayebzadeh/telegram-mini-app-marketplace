/** Strips everything except digits (0-9) from a string — e.g. turns a
 * formatted "1,000,000" back into "1000000". */
export function digitsOnly(value: string): string {
  return value.replace(/\D/g, '')
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
