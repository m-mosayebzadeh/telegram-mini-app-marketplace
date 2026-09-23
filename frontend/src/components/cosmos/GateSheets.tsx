import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { CosSheet } from './CosSheet'
import {
  JALALI_MONTH_NAMES,
  daysInJalaliMonth,
  gregorianToJalali,
  jalaliToGregorian,
  jalaliYearFor,
} from '../../lib/jalali'

/**
 * The two questions the door into Echo asks, answered where they are
 * asked.
 *
 * Sending somebody to their profile to fill in one field and then back
 * again is three screens for one answer, and most people do not come
 * back. The profile is still there and still owns these fields — the way
 * out is kept — but the common path finishes here.
 *
 * Both sheets speak the world's language rather than the app's older one,
 * because a pale card rising out of a night sky is two products in one
 * screenshot.
 */

/* ------------------------------------------------------------- gender */

export const GENDER_MALE = 'male'
export const GENDER_FEMALE = 'female'
/** Not an identity — a refusal. Kept apart from "we have not asked yet",
 *  which is what an empty value means. */
export const GENDER_UNSAID = 'unsaid'

/** The order they are offered in, everywhere they are offered. */
export const GENDER_OPTIONS = [GENDER_FEMALE, GENDER_MALE, GENDER_UNSAID] as const

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
    <CosSheet title={t('echo.genderTitle')} onClose={onClose}>
      <div className="cos-sheet-rows">
        {GENDER_OPTIONS.map((option) => (
          <button
            key={option}
            type="button"
            className={`cos-sheet-row${value === option ? ' is-on' : ''}`}
            onClick={() => onSave(option)}
            disabled={saving}
            aria-pressed={value === option}
          >
            {t(`echo.gender.${option}`)}
          </button>
        ))}
      </div>
      <p className="cos-sheet-note">{t('echo.genderWhy')}</p>
    </CosSheet>
  )
}

/* ----------------------------------------------------------- birthday */

export interface BirthdayValue {
  /** Gregorian, because that is what the backend stores. Which calendar
   *  somebody picks in is a display decision, not a storage one. */
  month: number | null
  day: number | null
  year: number | null
}

function daysInGregorianMonth(year: number, month: number): number {
  return new Date(year, month, 0).getDate()
}

export function BirthdayCosSheet({
  value,
  onClose,
  onSave,
  saving,
}: {
  value: BirthdayValue
  onClose: () => void
  onSave: (value: BirthdayValue) => void
  saving: boolean
}) {
  const { t, i18n } = useTranslation()
  const jalali = i18n.language.startsWith('fa')

  // Somebody arriving here has usually set nothing, so the draft starts
  // at a plausible adult birthday rather than at today — which would
  // otherwise need three separate corrections to become a real date.
  const fallbackYear = jalali ? jalaliYearFor() - 25 : new Date().getFullYear() - 25
  const start = toDraft(value, jalali, fallbackYear)

  const [year, setYear] = useState<number>(start.year)
  const [month, setMonth] = useState<number>(start.month)
  const [day, setDay] = useState<number>(start.day)

  const thisYear = jalali ? jalaliYearFor() : new Date().getFullYear()
  const limit = jalali
    ? daysInJalaliMonth(year, month)
    : daysInGregorianMonth(year, month)

  const monthNames = jalali
    ? JALALI_MONTH_NAMES
    : Array.from({ length: 12 }, (_, index) =>
        new Date(2001, index, 1).toLocaleDateString(i18n.language, { month: 'long' }),
      )

  function changeMonth(next: number) {
    setMonth(next)
    // A day that does not exist in the newly chosen month would
    // otherwise silently become an invalid date.
    const max = jalali ? daysInJalaliMonth(year, next) : daysInGregorianMonth(year, next)
    if (day > max) setDay(max)
  }

  function save() {
    if (jalali) {
      const g = jalaliToGregorian(year, month, day)
      onSave({ month: g.gm, day: g.gd, year: g.gy })
    } else {
      onSave({ month, day, year })
    }
  }

  return (
    <CosSheet title={t('echo.birthdayTitle')} onClose={onClose}>
      <div className="cos-sheet-date">
        <select
          className="cos-select"
          value={day}
          aria-label={t('echo.dayLabel')}
          onChange={(event) => setDay(Number(event.target.value))}
        >
          {Array.from({ length: limit }, (_, index) => index + 1).map((one) => (
            <option key={one} value={one}>
              {one}
            </option>
          ))}
        </select>

        <select
          className="cos-select"
          value={month}
          aria-label={t('echo.monthLabel')}
          onChange={(event) => changeMonth(Number(event.target.value))}
        >
          {monthNames.map((name, index) => (
            <option key={name} value={index + 1}>
              {name}
            </option>
          ))}
        </select>

        <select
          className="cos-select"
          value={year}
          aria-label={t('echo.yearLabel')}
          onChange={(event) => setYear(Number(event.target.value))}
        >
          {Array.from({ length: 90 }, (_, index) => thisYear - 18 - index).map((one) => (
            <option key={one} value={one}>
              {one}
            </option>
          ))}
        </select>
      </div>

      <p className="cos-sheet-note">{t('echo.birthdayWhy')}</p>

      <button
        type="button"
        className="cos-action cos-action-primary cos-sheet-save"
        onClick={save}
        disabled={saving}
      >
        {saving ? t('common.loading') : t('echo.save')}
      </button>
    </CosSheet>
  )
}

/** Whatever is stored, expressed in the calendar being read. */
function toDraft(
  value: BirthdayValue,
  jalali: boolean,
  fallbackYear: number,
): { year: number; month: number; day: number } {
  if (value.month == null || value.day == null) {
    return { year: fallbackYear, month: 1, day: 1 }
  }
  if (!jalali) {
    return { year: value.year ?? fallbackYear, month: value.month, day: value.day }
  }
  const j = gregorianToJalali(value.year ?? new Date().getFullYear(), value.month, value.day)
  return { year: value.year == null ? fallbackYear : j.jy, month: j.jm, day: j.jd }
}
