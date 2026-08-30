import { describe, expect, it } from 'vitest'
import { digitsOnly, formatThousands } from './format'

describe('digitsOnly', () => {
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
