import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Input } from '@telegram-apps/telegram-ui'
import { ApiError, formatApiError, apiFetch } from '../lib/api'
import {
  daysInJalaliMonth,
  gregorianMonthDayToJalali,
  jalaliMonthDayToGregorian,
  jalaliYearFor,
  JALALI_MONTH_NAMES,
} from '../lib/jalali'
import type { MyProfile, PublicProfile } from '../lib/types'

// Mirrors backend/app/models/profile.py's MAX_INTERESTS — duplicated
// here the same way MAX_VIDEO_DURATION_SECONDS is in
// ContentUploadForm.tsx, since it's a fixed phase-1 policy constant.
const MAX_INTERESTS = 10

// Mirrors backend/app/main.py's USERNAME_PATTERN — same
// duplicated-constant convention as MAX_INTERESTS above. Checked live
// as the user types, so "invalid characters" shows up immediately
// instead of only after a failed submit.
const USERNAME_PATTERN = /^[a-zA-Z0-9_]{3,32}$/

interface ProfileEditFormProps {
  initial: PublicProfile
  onSaved: (profile: MyProfile) => void
}

/** The edit form behind "Edit profile" on your own profile tab — bio,
 * location, and interests (PUT /profile/me). Avatar upload isn't part
 * of this pass (no upload UI existed for it before this redesign
 * either); avatar_url stays whatever it already was. Lives inside a
 * Sheet (see components/Sheet.tsx), which already provides its own
 * close control, so this form has no cancel button of its own. */
export function ProfileEditForm({ initial, onSaved }: ProfileEditFormProps) {
  const { t } = useTranslation()
  const [username, setUsername] = useState(initial.username ?? '')
  const [usernameError, setUsernameError] = useState<string | null>(null)
  const [bio, setBio] = useState(initial.bio ?? '')
  const [location, setLocation] = useState(initial.location ?? '')
  const [interestsText, setInterestsText] = useState(initial.interests.join(', '))
  // The Jalali year "now" — the correct anchor for jalaliMonthDayToGregorian
  // (a Jalali function needs a Jalali year, not new Date().getFullYear()'s
  // Gregorian one — see jalaliYearFor's docstring for why that distinction
  // matters right at the Esfand/Farvardin boundary).
  const jalaliYear = jalaliYearFor()
  const initialJalaliBirthday =
    initial.birthday_month != null && initial.birthday_day != null
      ? gregorianMonthDayToJalali(new Date().getFullYear(), initial.birthday_month, initial.birthday_day)
      : null
  const [birthdayMonth, setBirthdayMonth] = useState(initialJalaliBirthday?.jm ?? null)
  const [birthdayDay, setBirthdayDay] = useState(initialJalaliBirthday?.jd ?? null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const interests = interestsText
    .split(',')
    .map((tag) => tag.trim())
    .filter((tag) => tag.length > 0)
  const tooManyInterests = interests.length > MAX_INTERESTS

  const usernameChanged = username !== (initial.username ?? '')
  // Only flagged once there's something to judge — an untouched, empty
  // field isn't "invalid," it's just not set yet.
  const usernameInvalid = username.length > 0 && !USERNAME_PATTERN.test(username)

  async function submit() {
    if (tooManyInterests || usernameInvalid) return
    setBusy(true)
    setError(null)
    setUsernameError(null)
    try {
      // Username lives on User, not Profile (see backend/app/main.py's
      // PUT /me/username) — a separate request, with its own two
      // distinct failure reasons (invalid_characters / username_taken)
      // that need their own hint text, not lumped into the generic
      // profile-save error below.
      if (usernameChanged && username.length > 0) {
        try {
          await apiFetch('/me/username', { method: 'PUT', body: JSON.stringify({ username }) })
        } catch (err) {
          if (err instanceof ApiError && err.status === 400) {
            const reason = (err.body as { detail?: { reason?: string } } | null)?.detail?.reason
            setUsernameError(
              reason === 'username_taken' ? t('profilePage.usernameTaken') : t('profilePage.usernameInvalidChars'),
            )
          } else {
            setUsernameError(formatApiError(err))
          }
          setBusy(false)
          return
        }
      }

      const gregorianBirthday =
        birthdayMonth != null && birthdayDay != null
          ? jalaliMonthDayToGregorian(jalaliYear, birthdayMonth, birthdayDay)
          : null
      const updated = await apiFetch<MyProfile>('/profile/me', {
        method: 'PUT',
        body: JSON.stringify({
          bio: bio || null,
          location: location || null,
          interests,
          birthday_month: gregorianBirthday?.gm ?? null,
          birthday_day: gregorianBirthday?.gd ?? null,
        }),
      })
      onSaved(updated)
    } catch (err) {
      setError(formatApiError(err))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div>
      <div className="hp-field">
        <Input
          header={t('profilePage.usernameLabel')}
          value={username}
          onChange={(e) => {
            setUsername(e.target.value)
            setUsernameError(null)
          }}
          status={usernameInvalid ? 'error' : undefined}
        />
        <p className="hp-hint">{t('profilePage.usernameHint')}</p>
        {usernameInvalid && <p className="hp-error">{t('profilePage.usernameInvalidChars')}</p>}
        {usernameError && <p className="hp-error">{usernameError}</p>}
      </div>
      <div className="hp-field">
        <Input header={t('profilePage.bioLabel')} value={bio} onChange={(e) => setBio(e.target.value)} />
      </div>
      <div className="hp-field">
        <Input
          header={t('profilePage.locationLabel')}
          value={location}
          onChange={(e) => setLocation(e.target.value)}
        />
      </div>
      <div className="hp-field">
        <Input
          header={t('profilePage.interestsLabel')}
          placeholder={t('profilePage.interestsPlaceholder', { max: MAX_INTERESTS })}
          value={interestsText}
          onChange={(e) => setInterestsText(e.target.value)}
          status={tooManyInterests ? 'error' : undefined}
        />
        {tooManyInterests && (
          <p className="hp-error">{t('profilePage.interestsTooMany', { max: MAX_INTERESTS })}</p>
        )}
      </div>

      <div className="hp-field">
        <label className="hp-field-label">{t('profilePage.birthdayLabel')}</label>
        <div className="hp-birthday-edit-row">
          <select
            className="hp-birthday-select"
            value={birthdayMonth ?? ''}
            onChange={(e) => {
              const nextMonth = e.target.value ? Number(e.target.value) : null
              setBirthdayMonth(nextMonth)
              // A day picked under a longer month (e.g. 31 under
              // Farvardin) can outlive a switch to a shorter one (e.g.
              // Mehr, 30 days) — clamp instead of silently sending an
              // out-of-range day to jalaliMonthDayToGregorian.
              if (nextMonth != null && birthdayDay != null) {
                const maxDay = daysInJalaliMonth(jalaliYear, nextMonth)
                if (birthdayDay > maxDay) setBirthdayDay(maxDay)
              }
            }}
          >
            <option value="">—</option>
            {JALALI_MONTH_NAMES.map((name, i) => (
              <option key={name} value={i + 1}>
                {name}
              </option>
            ))}
          </select>
          <select
            className="hp-birthday-select hp-birthday-select-day"
            value={birthdayDay ?? ''}
            onChange={(e) => setBirthdayDay(e.target.value ? Number(e.target.value) : null)}
            disabled={birthdayMonth == null}
          >
            <option value="">—</option>
            {Array.from(
              { length: birthdayMonth != null ? daysInJalaliMonth(jalaliYear, birthdayMonth) : 31 },
              (_, i) => i + 1,
            ).map((day) => (
              <option key={day} value={day}>
                {day}
              </option>
            ))}
          </select>
        </div>
        <p className="hp-hint">{t('profilePage.birthdayHint')}</p>
      </div>

      {error && <p className="hp-error">{error}</p>}

      <div className="hp-field">
        <button
          className="hp-btn hp-btn-gradient"
          style={{ width: '100%' }}
          disabled={tooManyInterests || usernameInvalid || busy}
          onClick={submit}
        >
          {busy ? t('common.loading') : t('profilePage.saveButton')}
        </button>
      </div>
    </div>
  )
}
