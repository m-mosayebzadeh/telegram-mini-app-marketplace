import { Input } from '@telegram-apps/telegram-ui'
import { digitsOnly, formatThousands } from '../lib/format'

interface NumberFieldProps {
  header: string
  value: string
  onChange: (digits: string) => void
}

/**
 * A number input that shows comma thousand-separators while typing
 * (e.g. "1,000,000") — a plain `<input type="number">` can't do this at
 * all (browsers reject comma characters in it), so this uses a text
 * input under the hood and formats it by hand.
 *
 * `value`/`onChange` both work with the plain digit string (e.g.
 * "1000000"), never the formatted display string — callers keep
 * storing and submitting a normal number, this component only changes
 * how it LOOKS while being typed.
 */
export function NumberField({ header, value, onChange }: NumberFieldProps) {
  return (
    <Input
      header={header}
      type="text"
      inputMode="numeric"
      value={formatThousands(value)}
      onChange={(e) => onChange(digitsOnly(e.target.value))}
    />
  )
}
