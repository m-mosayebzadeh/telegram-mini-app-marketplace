import { useTranslation } from 'react-i18next'
import { IconDrop } from '../icons'

interface DropAmountFieldProps {
  id: string
  value: string
  onChange: (digits: string) => void
  /** When given, the Toman equivalent is shown under the field. */
  rate?: number | null
  label?: string
  help?: string
}

/**
 * "How much Drop?" — the one field every top-up method needs.
 *
 * Drop is the only amount stored anywhere (TopUpRequest.requested_stars);
 * the Toman line is computed and read-only, never a second box to type
 * into. That was a real bug once: a typed Toman amount that did not
 * divide evenly by the rate silently rounded to a Drop count that was
 * not what the user thought they had entered.
 */
export function DropAmountField({
  id,
  value,
  onChange,
  rate,
  label,
  help,
}: DropAmountFieldProps) {
  const { t, i18n } = useTranslation()
  const amount = Number(value)

  return (
    <label className="ui-field" htmlFor={id}>
      <span className="ui-field-label">{label ?? t('topup.converterStarsLabel')}</span>

      <div className="ui-input-group">
        <input
          id={id}
          className="ui-input ui-input-numeric tu-amount"
          type="text"
          inputMode="numeric"
          value={value}
          // Non-digits go, and so do leading zeros: a field reading
          // "00100" looks like a different, smaller number than the 100
          // it actually parses to.
          onChange={(event) =>
            onChange(event.target.value.replace(/[^\d]/g, '').replace(/^0+(?=\d)/, ''))
          }
          placeholder="0"
        />
        <span className="ui-input-group-addon">
          <IconDrop size={18} />
          {t('topup.dropUnit')}
        </span>
      </div>

      {rate != null && amount > 0 && (
        <span className="ui-field-help tabular">
          ≈ {(amount * rate).toLocaleString(i18n.language)} {t('topup.converterTomanLabel')}
        </span>
      )}
      {help && <span className="ui-field-help">{help}</span>}
    </label>
  )
}
