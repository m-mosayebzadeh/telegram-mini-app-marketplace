import { describe, expect, it } from 'vitest'
import { digitsOnly, formatThousands, localizeDigits, toLatinDigits } from './format'

describe('toLatinDigits', () => {
  it('folds Persian digits', () => {
    expect(toLatinDigits('۱۲۳۴۵۶۷۸۹۰')).toBe('1234567890')
  })

  it('folds Arabic-Indic digits', () => {
    expect(toLatinDigits('١٢٣٤٥٦٧٨٩٠')).toBe('1234567890')
  })

  it('leaves Latin digits and surrounding text alone', () => {
    expect(toLatinDigits('IR12 ab')).toBe('IR12 ab')
  })
})

describe('digitsOnly', () => {
  it('keeps a number typed in Persian rather than deleting it', () => {
    // The app defaults to Persian and the phone keyboard follows the
    // app, so this is the ordinary case. Stripping non-ASCII digits
    // before folding them blanked the field with no explanation — which
    // is the bug this test exists to keep away.
    expect(digitsOnly('۱۰۰')).toBe('100')
    expect(digitsOnly('۱٬۰۰۰')).toBe('1000')
  })

  it('strips commas', () => {
    expect(digitsOnly('1,000,000')).toBe('1000000')
  })

  it('strips any non-digit character', () => {
    expect(digitsOnly('12a b-3')).toBe('123')
  })

  it('leaves an empty string empty', () => {
    expect(digitsOnly('')).toBe('')
  })
})

describe('formatThousands', () => {
  it('adds comma separators for a large number', () => {
    expect(formatThousands('1000000')).toBe('1,000,000')
  })

  it('leaves a small number (no separator needed) unchanged', () => {
    expect(formatThousands('42')).toBe('42')
  })

  it('is idempotent — formatting an already-formatted value gives the same result', () => {
    expect(formatThousands('1,000,000')).toBe('1,000,000')
  })

  it('returns an empty string for empty input, not "0"', () => {
    expect(formatThousands('')).toBe('')
  })

  it('drops a leading zero the same way Number() does', () => {
    expect(formatThousands('007')).toBe('7')
  })
})

describe('localizeDigits', () => {
  it('writes a number in Persian digits for display', () => {
    expect(localizeDigits('100', 'fa')).toBe('۱۰۰')
  })

  it('leaves English alone', () => {
    expect(localizeDigits('100', 'en')).toBe('100')
  })

  it('round-trips with digitsOnly, which is what keeps display and storage in step', () => {
    expect(digitsOnly(localizeDigits('2500', 'fa'))).toBe('2500')
  })

  it('touches only digits, never the characters around them', () => {
    expect(localizeDigits('IR12 AB', 'fa')).toBe('IR۱۲ AB')
  })
})
