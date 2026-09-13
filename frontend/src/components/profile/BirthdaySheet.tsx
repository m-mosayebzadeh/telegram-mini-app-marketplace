import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Sheet } from '../ui/Sheet'
import { Button } from '../ui/Button'
import {
  JALALI_MONTH_NAMES,
  daysInJalaliMonth,
  gregorianToJalali,
  jalaliToGregorian,
  jalaliYearFor,
} from '../../lib/jalali'

export interface BirthdayValue {
  /** Gregorian, because that is what the backend stores. The calendar a
   *  person picks in is a display decision, not a storage one. */
  month: number | null
  day: number | null
  year: number | null
}

interface BirthdaySheetProps {
  value: BirthdayValue
  onClose: () => void
  onSave: (value: BirthdayValue) => void
  saving: boolean
}

/**
 * Picking a birthday, in the calendar of the language being read.
 *
 * The same date, not two dates: someone who set 1 فروردین 1405 and then
 * switches to English sees that exact day as 21 March 2026. Only the
 * Gregorian value is ever stored, and the Jalali one is derived on the
 * way in and out — which is what stops the two from drifting apart.
 *
 * The year is optional and stays first, so leaving it blank is a visible
 * choice rather than a field nobody noticed.
 */
export function BirthdaySheet({ value, onClose, onSave, saving }: BirthdaySheetProps) {
  const { t, i18n } = useTranslation()
  const jalali = i18n.language.startsWith('fa')

  const initial = toDraft(value, jalali)
  const [year, setYear] = useState<number | null>(initial.year)
  const [month, setMonth] = useState<number>(initial.month)
  const [day, setDay] = useState<number>(initial.day)

  const currentYear = jalali ? jalaliYearFor() : new Date().getFullYear()
  const maxDay = jalali
    ? daysInJalaliMonth(year ?? currentYear, month)
    : daysInGregorianMonth(year ?? 2000, month)

  const monthNames = jalali
    ? JALALI_MONTH_NAMES
    : Array.from({ length: 12 }, (_, index) =>
        new Date(2001, index, 1).toLocaleDateString(i18n.language, { month: 'long' }),
      )

  function changeMonth(next: number) {
    setMonth(next)
    // A day that does not exist in the newly chosen month would
    // otherwise silently become an invalid date.
    const limit = jalali
      ? daysInJalaliMonth(year ?? currentYear, next)
      : daysInGregorianMonth(year ?? 2000, next)
    if (day > limit) setDay(limit)
  }

  function save() {
    if (jalali) {
      const g = jalaliToGregorian(year ?? jalaliYearFor(), month, day)
      onSave({ month: g.gm, day: g.gd, year: year == null ? null : g.gy })
    } else {
      onSave({ month, day, year })
    }
  }

  return (
    <Sheet
      title={t('profilePage.birthdayLabel')}
      onClose={onClose}
      footer={
        <Button variant="primary" size="lg" block loading={saving} onClick={save}>
          {t('profilePage.saveButton')}
        </Button>
      }
    >
      <div className="ep-birthday">
        <select
          className="ui-input ep-birthday-select"
          aria-label={t('profilePage.birthdayYear')}
          value={year ?? ''}
          onChange={(event) => setYear(event.target.value ? Number(event.target.value) : null)}
        >
          <option value="">—</option>
          {Array.from({ length: 100 }, (_, index) => currentYear - index).map((option) => (
            <option key={option} value={option}>
              {option.toLocaleString(i18n.language, { useGrouping: false })}
            </option>
          ))}
        </select>

        <select
          className="ui-input ep-birthday-select"
          aria-label={t('profilePage.birthdayMonth')}
          value={month}
          onChange={(event) => changeMonth(Number(event.target.value))}
        >
          {monthNames.map((name, index) => (
            <option key={name} value={index + 1}>
              {name}
            </option>
          ))}
        </select>

        <select
          className="ui-input ep-birthday-select"
          aria-label={t('profilePage.birthdayDay')}
          value={day}
          onChange={(event) => setDay(Number(event.target.value))}
        >
          {Array.from({ length: maxDay }, (_, index) => index + 1).map((option) => (
            <option key={option} value={option}>
              {option.toLocaleString(i18n.language)}
            </option>
          ))}
        </select>
      </div>

      {value.month != null && (
        <button type="button" className="ep-clear" onClick={() => onSave({ month: null, day: null, year: null })}>
          {t('profilePage.birthdayRemove')}
        </button>
      )}
    </Sheet>
  )
}

/** The stored Gregorian date, expressed in the calendar being shown. */
function toDraft(value: BirthdayValue, jalali: boolean) {
  const today = new Date()
  if (value.month == null || value.day == null) {
    return jalali
      ? { year: null, month: 1, day: 1 }
      : { year: null, month: today.getMonth() + 1, day: 1 }
  }
  if (!jalali) return { year: value.year, month: value.month, day: value.day }

  // A year-less birthday still has to be converted through SOME year;
  // the current one is the only honest choice, and the year is then
  // dropped again on the way out.
  const anchor = value.year ?? today.getFullYear()
  const converted = gregorianToJalali(anchor, value.month, value.day)
  return {
    year: value.year == null ? null : converted.jy,
    month: converted.jm,
    day: converted.jd,
  }
}

function daysInGregorianMonth(year: number, month: number): number {
  // Day 0 of the next month is the last day of this one.
  return new Date(year, month, 0).getDate()
}
