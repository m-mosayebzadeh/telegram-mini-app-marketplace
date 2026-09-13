import { describe, it, expect } from 'vitest'
import {
  CARD_LENGTH,
  IBAN_DIGIT_LENGTH,
  bankFromCard,
  formatCard,
  formatIbanDigits,
  onlyDigits,
  toLatinDigits,
} from './iranBanking'

describe('onlyDigits', () => {
  it('folds Persian and Arabic-Indic digits to ASCII', () => {
    // A Persian keyboard is the normal case here, so the same number has
    // to store identically however it was typed.
    expect(toLatinDigits('۱۲۳۴')).toBe('1234')
    expect(toLatinDigits('١٢٣٤')).toBe('1234')
  })

  it('strips the separators it puts in itself, so re-typing is idempotent', () => {
    expect(onlyDigits('1234 5678 9012 3456')).toBe('1234567890123456')
  })

  it('drops a pasted IR rather than counting it as digits', () => {
    expect(onlyDigits('IR12 3456')).toBe('123456')
  })
})

describe('formatCard', () => {
  it('groups in fours, the way the number is printed on the card', () => {
    expect(formatCard('1234123412341234')).toBe('1234 1234 1234 1234')
  })

  it('adds no trailing separator while the number is still being typed', () => {
    // A space after the last complete group would put the caret past a
    // character the user has not reached yet.
    expect(formatCard('1234')).toBe('1234')
    expect(formatCard('12345')).toBe('1234 5')
  })

  it('leaves an empty field empty', () => {
    expect(formatCard('')).toBe('')
  })
})

describe('formatIbanDigits', () => {
  it('groups the 24 digits after IR in fours', () => {
    expect(formatIbanDigits('123456789012345678901234')).toBe(
      '1234 5678 9012 3456 7890 1234',
    )
  })
})

describe('bankFromCard', () => {
  it('names the bank from the first six digits', () => {
    expect(bankFromCard('6037991234567890')).toBe('ملی')
    expect(bankFromCard('6104331234567890')).toBe('ملت')
  })

  it('answers as soon as six digits exist, not only on a complete card', () => {
    // The whole point is confirming the right card BEFORE it is saved.
    expect(bankFromCard('603799')).toBe('ملی')
  })

  it('says nothing before six digits', () => {
    expect(bankFromCard('60379')).toBeNull()
  })

  it('stays silent on a prefix it does not know rather than guessing', () => {
    // A wrong bank name would give someone confidence in a wrong number.
    expect(bankFromCard('0000001234567890')).toBeNull()
  })
})

describe('lengths', () => {
  it('matches what the backend validates', () => {
    // backend/app/wallet/schemas.py: card_number is 16 digits and iban is
    // IR + 24. If either changes, this test is the thing that notices.
    expect(CARD_LENGTH).toBe(16)
    expect(IBAN_DIGIT_LENGTH).toBe(24)
  })
})
