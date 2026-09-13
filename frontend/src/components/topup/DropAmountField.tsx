import { useTranslation } from 'react-i18next'
import { IconDrop } from '../icons'
import { digitsOnly, localizeDigits } from '../../lib/format'

interface DropAmountFieldProps {
  id: string
  /** Digits only, ASCII — what the caller stores and sends. */
  value: string
  onChange: (digits: string) => void
  /** When given, what this amount costs is shown under the field. */
  rate?: number | null
  label?: string
}

/**
 * "How much?" — the one field every top-up needs.
 *
 * Drop is the only amount stored anywhere (TopUpRequest.requested_drops);
 * the Toman figure is computed and read-only, never a second box to type
 * into. That was a real bug once: a typed Toman amount that did not
 * divide evenly by the rate silently rounded to a Drop count nobody had
 * entered.
 *
 * The digits on screen follow the language; what is stored does not.
 * digitsOnly() folds whatever was typed back to ASCII on the way in and
 * localizeDigits() rewrites it on the way out, so the two cannot drift
 * apart. Persian text with Latin numerals inside it reads as two
 * languages sharing a line, and a form field is not exempt from that.
 */
export function DropAmountField({ id, value, onChange, rate, label }: DropAmountFieldProps) {
  const { t, i18n } = useTranslation()
  const amount = Number(value)
  const toman = rate != null && amount > 0 ? amount * rate : null

  return (
    <div className="ui-field">
      <label className="ui-field-label" htmlFor={id}>
        {label ?? t('topup.amountLabel')}
      </label>

      <div className="ui-input-group">
        <input
          id={id}
          className="ui-input ui-input-numeric tu-amount"
          type="text"
          inputMode="numeric"
          value={localizeDigits(value, i18n.language)}
          // Leading zeros go too: a field reading "۰۰۱۰۰" looks like a
          // different, smaller number than the 100 it parses to.
          onChange={(event) =>
            onChange(digitsOnly(event.target.value).replace(/^0+(?=\d)/, ''))
          }
          placeholder={localizeDigits('0', i18n.language)}
        />
        <span className="ui-input-group-addon">
          <IconDrop size={18} />
          {t('topup.dropUnit')}
        </span>
      </div>

      {/* What to actually transfer. Once there is an amount, this is the
          most useful number on the screen — it is the figure that gets
          typed into a banking app — so it is stated outright instead of
          left as an approximation beside a rate the reader has to apply
          themselves. Before then, the rate IS the useful thing, so the
          two swap rather than stacking. */}
      {toman != null ? (
        <span className="tu-toman">
          <span className="tu-toman-label">{t('topup.transferLabel')}</span>
          <span className="tu-toman-value tabular">
            {t('wallet.tomanAmount', { amount: toman })}
          </span>
        </span>
      ) : (
        rate != null && <span className="ui-field-help">{t('topup.rateHint', { rate })}</span>
      )}
    </div>
  )
}
