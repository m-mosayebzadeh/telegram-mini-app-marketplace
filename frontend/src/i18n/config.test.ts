import { describe, expect, it } from 'vitest'
import i18n from './config'

/** Turns { a: { b: 'x', c: 'y' } } into ['a.b', 'a.c'] — flat, so
 * comparing two locale files catches a missing LEAF key (e.g.
 * "wallet.pending" present in one file but not the other), not just a
 * missing top-level section. */
function flattenKeys(obj: object, prefix = ''): string[] {
  return Object.entries(obj).flatMap(([key, value]) => {
    const path = prefix ? `${prefix}.${key}` : key
    return typeof value === 'object' && value !== null ? flattenKeys(value, path) : [path]
  })
}

describe('i18n config', () => {
  it('defaults to Persian (TECHNICAL_REQUIREMENTS.md section 11)', () => {
    expect(i18n.language).toBe('fa')
  })

  it('has the exact same translation keys in both languages', () => {
    // The real risk with two separate JSON files is them drifting apart
    // (a key added to one and forgotten in the other) — this catches
    // that automatically instead of relying on someone noticing a
    // missing string by eye.
    const faKeys = flattenKeys(i18n.getResourceBundle('fa', 'translation'))
    const enKeys = flattenKeys(i18n.getResourceBundle('en', 'translation'))
    expect(faKeys.sort()).toEqual(enKeys.sort())
  })

  it('translates a known key correctly in both languages', async () => {
    await i18n.changeLanguage('fa')
    expect(i18n.t('wallet.title')).toBe('کیف پول')

    await i18n.changeLanguage('en')
    expect(i18n.t('wallet.title')).toBe('Wallet')

    // Reset back to the default for any test that runs after this one.
    await i18n.changeLanguage('fa')
  })

  it('interpolates values into a templated string', () => {
    const result = i18n.t('wallet.pendingValue', { toman: '1,000' })
    expect(result).toContain('1,000')
  })
})
