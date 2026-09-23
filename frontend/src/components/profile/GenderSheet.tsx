import { useTranslation } from 'react-i18next'
import { Sheet } from '../ui/Sheet'
import { GENDER_OPTIONS } from '../cosmos/GateSheets'

/**
 * Picking a gender, in the app's older language.
 *
 * The same question is asked at Echo's door, in the world's language, and
 * that one cannot appear here — a screen reads one visual language or the
 * other and never both. What the two share is the list of options, which
 * lives in one place so the two can never come to disagree about what the
 * choices are.
 *
 * Saving happens on tap rather than behind a confirm button: there is one
 * value, choosing it IS the decision, and a second tap would only be
 * ceremony.
 */
export function GenderSheet({
  value,
  onClose,
  onSave,
  saving,
}: {
  value: string | null
  onClose: () => void
  onSave: (value: string) => void
  saving: boolean
}) {
  const { t } = useTranslation()

  return (
    <Sheet title={t('profilePage.genderLabel')} onClose={onClose}>
      <div className="ui-list">
        {GENDER_OPTIONS.map((option) => (
          <button
            key={option}
            type="button"
            className="ui-row"
            onClick={() => onSave(option)}
            disabled={saving}
            aria-pressed={value === option}
          >
            <span className="ui-row-main">
              <span className="ui-row-title">{t(`echo.gender.${option}`)}</span>
            </span>
            {value === option && <span className="ui-row-trailing">✓</span>}
          </button>
        ))}
      </div>
    </Sheet>
  )
}
