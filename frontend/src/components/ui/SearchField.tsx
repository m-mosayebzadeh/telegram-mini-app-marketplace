import { useTranslation } from 'react-i18next'
import { IconClose, IconSearch } from '../icons'

interface SearchFieldProps {
  id: string
  value: string
  onChange: (value: string) => void
  placeholder: string
}

/**
 * A search box. The one input in the product that legitimately has no
 * label above it: the magnifier says what it is, and the field is never
 * one of several in a form where a placeholder could be mistaken for a
 * value.
 */
export function SearchField({ id, value, onChange, placeholder }: SearchFieldProps) {
  const { t } = useTranslation()

  return (
    <div className="ui-input-group sf-field">
      <span className="ui-input-group-addon sf-icon">
        <IconSearch size={18} />
      </span>
      <input
        id={id}
        className="ui-input"
        type="search"
        value={value}
        onChange={(event) => onChange(event.target.value)}
        placeholder={placeholder}
        aria-label={placeholder}
      />
      {/* Clearing a search is a frequent action and a fiddly one to do
          by backspacing, so it gets a real 44px target — shown only when
          there is something to clear. */}
      {value && (
        <button
          type="button"
          className="sf-clear"
          onClick={() => onChange('')}
          aria-label={t('common.close')}
        >
          <IconClose size={18} />
        </button>
      )}
    </div>
  )
}
