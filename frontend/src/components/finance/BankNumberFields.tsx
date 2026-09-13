import { useTranslation } from 'react-i18next'
import {
  CARD_LENGTH,
  IBAN_DIGIT_LENGTH,
  bankFromCard,
  formatCard,
  formatIbanDigits,
  onlyDigits,
} from '../../lib/iranBanking'

/**
 * The two number fields on the bank-account form.
 *
 * Both hold a long run of digits that a person checks against a physical
 * card, four at a time. So both are grouped as they are typed, run
 * left-to-right regardless of the page direction, and use tabular
 * figures so the groups line up in a column. A 16-digit run with no
 * spacing cannot be proof-read by eye at all.
 *
 * Each carries a live count. The point is not decoration: the single
 * most common mistake on a form like this is a digit dropped or doubled,
 * and "15 / 16" says so instantly, where a rejection after tapping Save
 * says it late and without saying where.
 */

interface CardNumberFieldProps {
  /** Digits only — the caller stores exactly what the API wants. */
  value: string
  onChange: (digits: string) => void
}

export function CardNumberField({ value, onChange }: CardNumberFieldProps) {
  const { t, i18n } = useTranslation()
  const bank = bankFromCard(value)
  const complete = value.length === CARD_LENGTH
  // Nothing is wrong with a field someone has not finished typing yet.
  const invalid = value.length > 0 && !complete

  return (
    <div className={`ui-field${invalid ? ' ui-field-invalid' : ''}`}>
      <label className="ui-field-label" htmlFor="bank-card">
        {t('finance.card')}
        <span className="ui-field-counter">
          {value.length.toLocaleString(i18n.language)} /{' '}
          {CARD_LENGTH.toLocaleString(i18n.language)}
        </span>
      </label>

      <input
        id="bank-card"
        className="ui-input bk-number"
        type="text"
        inputMode="numeric"
        autoComplete="cc-number"
        // The formatted value is what is shown; the digits are what is
        // kept. Typing, pasting and deleting all go through the same
        // strip-and-regroup, so there is no state where the two disagree.
        value={formatCard(value)}
        onChange={(event) => onChange(onlyDigits(event.target.value).slice(0, CARD_LENGTH))}
        placeholder="—— —— —— ——"
        aria-invalid={invalid || undefined}
      />

      {/* Which bank this card belongs to, read from its first six
          digits. It confirms the right card is being entered before it
          is saved and before money is ever sent to it. Silent when the
          prefix is not one we know — a wrong bank name would give
          someone confidence in a wrong number. */}
      {bank ? (
        <span className="bk-bank">
          <span className="bk-bank-dot" aria-hidden="true" />
          {t('finance.bankName', { name: bank })}
        </span>
      ) : (
        invalid && <span className="ui-field-error">{t('finance.cardIncomplete')}</span>
      )}
    </div>
  )
}

interface IbanFieldProps {
  /** The 24 digits AFTER "IR". The IR itself is never in here. */
  value: string
  onChange: (digits: string) => void
}

export function IbanField({ value, onChange }: IbanFieldProps) {
  const { t, i18n } = useTranslation()
  const complete = value.length === IBAN_DIGIT_LENGTH
  const invalid = value.length > 0 && !complete

  return (
    <div className={`ui-field${invalid ? ' ui-field-invalid' : ''}`}>
      <label className="ui-field-label" htmlFor="bank-iban">
        {t('finance.iban')}
        <span className="ui-field-counter">
          {value.length.toLocaleString(i18n.language)} /{' '}
          {IBAN_DIGIT_LENGTH.toLocaleString(i18n.language)}
        </span>
      </label>

      {/* IR is a fixed part of every Iranian IBAN, so it is part of the
          FIELD rather than part of what gets typed. It used to be a
          starting value in the text box, which meant it could be
          backspaced away — and an IBAN with no IR is not an IBAN. */}
      <div className={`ui-input-group bk-iban-group${invalid ? ' bk-iban-invalid' : ''}`}>
        <span className="bk-iban-prefix" aria-hidden="true">
          IR
        </span>
        <input
          id="bank-iban"
          className="ui-input bk-number"
          type="text"
          inputMode="numeric"
          value={formatIbanDigits(value)}
          onChange={(event) =>
            onChange(onlyDigits(event.target.value).slice(0, IBAN_DIGIT_LENGTH))
          }
          placeholder="—— —— —— —— —— ——"
          // The visible IR is decorative markup, so the field has to say
          // out loud what it is.
          aria-label={t('finance.iban')}
          aria-invalid={invalid || undefined}
        />
      </div>

      {invalid && <span className="ui-field-error">{t('finance.ibanIncomplete')}</span>}
    </div>
  )
}
