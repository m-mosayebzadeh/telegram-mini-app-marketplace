import { useTranslation } from 'react-i18next'
import { CosSheet } from '../cosmos/CosSheet'
import { GENDER_OPTIONS } from '../cosmos/GateSheets'

/**
 * Picking a gender, from editing your profile.
 *
 * The same question is asked at Echo's door. What the two share is the
 * list of options, which lives in one place so the two can never come to
 * disagree about what the choices are.
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
    <CosSheet title={t('profilePage.genderLabel')} onClose={onClose}>
      <div className="cos-q-choice">
        {GENDER_OPTIONS.map((option) => (
          <button key={option} type="button" onClick={() => onSave(option)} disabled={saving} aria-pressed={value === option}>
            {t(`echo.gender.${option}`)}
          </button>
        ))}
      </div>
      <p className="cos-q-help is-under">{t('profilePage.genderHint')}</p>
    </CosSheet>
  )
}
