import { expect, it } from 'vitest'
import { digits } from './withdrawalApi'
import fa from '../i18n/locales/fa.json'
import en from '../i18n/locales/en.json'
it('normalizes Persian and Arabic bank digits without removing invalid characters', () => {
  expect(digits('۶۰۳۷-١٢٣٤')).toBe('6037-1234')
})
it('keeps all finance translations complete and readable', () => {
  function keys(value: object, prefix = ''): string[] {
    return Object.entries(value).flatMap(([k, v]) =>
      typeof v === 'object' ? keys(v, `${prefix}${k}.`) : [`${prefix}${k}`],
    )
  }
  expect(keys(fa.finance).sort()).toEqual(keys(en.finance).sort())
  expect(JSON.stringify(fa.finance)).not.toContain('???')
  expect(fa.finance.banks).toBe('حساب‌های بانکی من')
})
