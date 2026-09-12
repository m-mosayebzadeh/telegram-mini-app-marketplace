import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { Input, Placeholder, Spinner } from '@telegram-apps/telegram-ui'
import { ApiError, apiFetch, formatApiError } from '../lib/api'
import {
  daysInJalaliMonth,
  gregorianToJalali,
  jalaliToGregorian,
  jalaliYearFor,
  JALALI_MONTH_NAMES,
  toPersianDigits,
} from '../lib/jalali'
import { Sheet } from '../components/ui/Sheet'
import { IconArrowNarrowLeft, IconCheck } from '../components/icons'
import { useMe } from '../lib/MeContext'
import type { MyProfile, PublicProfile } from '../lib/types'

const MAX_INTERESTS = 10
const MAX_BIO = 1000
const USERNAME_PATTERN = /^[a-zA-Z0-9_]{3,32}$/
const CURRENT_JALALI_YEAR = jalaliYearFor()

/** English birthday display ("17 Sep, 2025" / "17 Sep" with no year) —
 * day-first regardless of locale default, which Intl's own {day,month}
 * formatting doesn't guarantee, so only the month abbreviation comes
 * from Intl; day/year are placed by hand to match the exact format
 * asked for. The year in the dummy Date below is never shown — it only
 * exists because Date needs one — so any non-leap year works for every
 * real month/day combination. */
function formatGregorianBirthday(month: number, day: number, year: number | null): string {
  const monthAbbr = new Date(2001, month - 1, 1).toLocaleDateString('en-US', { month: 'short' })
  return year != null ? `${day} ${monthAbbr}, ${year}` : `${day} ${monthAbbr}`
}

/**
 * A real pushed page (back-arrow header, not a bottom sheet) — the
 * user's explicit reference was Telegram's own "Edit Profile"/Account
 * screen: a full page with inline fields, plus username and birthday
 * broken out into their own sub-sheets (each with its own Save),
 * because both are semantically distinct saves (username is its own
 * backend resource — PUT /me/username; birthday is part of the same
 * PUT /profile/me as bio/location/interests, but gets its own sheet
 * and Save button to match the same "tap in, set it, done" shape).
 */
export default function EditProfile() {
  const { t, i18n } = useTranslation()
  const navigate = useNavigate()
  const { me, refreshMe } = useMe()

  const [profile, setProfile] = useState<PublicProfile | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)

  const [firstName, setFirstName] = useState('')
  const [lastName, setLastName] = useState('')

  const [username, setUsername] = useState('')
  const [usernameSheetOpen, setUsernameSheetOpen] = useState(false)
  const [usernameDraft, setUsernameDraft] = useState('')
  const [usernameError, setUsernameError] = useState<string | null>(null)
  const [usernameBusy, setUsernameBusy] = useState(false)

  const [bio, setBio] = useState('')
  const [location, setLocation] = useState('')
  const [interestsText, setInterestsText] = useState('')

  const [birthdaySheetOpen, setBirthdaySheetOpen] = useState(false)
  const [jy, setJy] = useState<number | null>(null)
  const [jm, setJm] = useState<number | null>(null)
  const [jd, setJd] = useState<number | null>(null)

  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    if (!me) return
    setFirstName(me.first_name)
    setLastName(me.last_name ?? '')
  }, [me])

  useEffect(() => {
    if (!me) return
    apiFetch<PublicProfile>(`/profiles/${me.id}`)
      .then((p) => {
        setProfile(p)
        setUsername(p.username ?? '')
        setBio(p.bio ?? '')
        setLocation(p.location ?? '')
        setInterestsText(p.interests.join(', '))
        if (p.birthday_month != null && p.birthday_day != null) {
          const anchorYear = p.birthday_year ?? new Date().getFullYear()
          const converted = gregorianToJalali(anchorYear, p.birthday_month, p.birthday_day)
          setJy(p.birthday_year != null ? converted.jy : null)
          setJm(converted.jm)
          setJd(converted.jd)
        }
      })
      .catch((err) => setLoadError(formatApiError(err)))
  }, [me])

  const interests = interestsText
    .split(',')
    .map((tag) => tag.trim())
    .filter((tag) => tag.length > 0)
  const tooManyInterests = interests.length > MAX_INTERESTS
  const usernameInvalid = usernameDraft.length > 0 && !USERNAME_PATTERN.test(usernameDraft)
  const firstNameEmpty = firstName.trim().length === 0

  async function saveName(): Promise<boolean> {
    try {
      await apiFetch('/me/name', {
        method: 'PUT',
        body: JSON.stringify({ first_name: firstName.trim(), last_name: lastName.trim() || null }),
      })
      return true
    } catch (err) {
      setError(formatApiError(err))
      return false
    }
  }

  async function saveProfile(nextJy: number | null, nextJm: number | null, nextJd: number | null): Promise<boolean> {
    setBusy(true)
    setError(null)
    try {
      const gregorian = nextJm != null && nextJd != null ? jalaliToGregorian(nextJy ?? CURRENT_JALALI_YEAR, nextJm, nextJd) : null
      await apiFetch<MyProfile>('/profile/me', {
        method: 'PUT',
        body: JSON.stringify({
          bio: bio || null,
          location: location || null,
          interests,
          birthday_month: gregorian?.gm ?? null,
          birthday_day: gregorian?.gd ?? null,
          birthday_year: gregorian && nextJy != null ? gregorian.gy : null,
        }),
      })
      return true
    } catch (err) {
      setError(formatApiError(err))
      return false
    } finally {
      setBusy(false)
    }
  }

  async function submitMain() {
    if (firstNameEmpty || tooManyInterests || busy) return
    setBusy(true)
    setError(null)
    // Name is its own backend resource (PUT /me/name), saved alongside
    // the rest here since the header checkmark is one combined "save
    // everything on this page" action — only proceed to the bio/
    // location/interests/birthday save if the name save succeeded.
    if (!(await saveName())) {
      setBusy(false)
      return
    }
    if (await saveProfile(jy, jm, jd)) {
      refreshMe()
      navigate(-1)
    }
  }

  async function submitBirthday() {
    if (await saveProfile(jy, jm, jd)) setBirthdaySheetOpen(false)
  }

  function openUsernameSheet() {
    setUsernameDraft(username)
    setUsernameError(null)
    setUsernameSheetOpen(true)
  }

  async function submitUsername() {
    if (usernameInvalid || !usernameDraft) return
    setUsernameBusy(true)
    setUsernameError(null)
    try {
      await apiFetch('/me/username', { method: 'PUT', body: JSON.stringify({ username: usernameDraft }) })
      setUsername(usernameDraft)
      setUsernameSheetOpen(false)
    } catch (err) {
      if (err instanceof ApiError && err.status === 400) {
        const reason = (err.body as { detail?: { reason?: string } } | null)?.detail?.reason
        setUsernameError(reason === 'username_taken' ? t('profilePage.usernameTaken') : t('profilePage.usernameInvalidChars'))
      } else {
        setUsernameError(formatApiError(err))
      }
    } finally {
      setUsernameBusy(false)
    }
  }

  function openBirthdaySheet() {
    if (jm == null) {
      setJy(null)
      setJm(1)
      setJd(1)
    }
    setBirthdaySheetOpen(true)
  }

  if (loadError) return <Placeholder header={t('common.error')}>{loadError}</Placeholder>
  if (!profile) {
    return (
      <Placeholder>
        <Spinner size="l" />
      </Placeholder>
    )
  }

  const hasBirthday = jm != null && jd != null
  const birthdayValueLabel = hasBirthday
    ? i18n.language === 'en'
      ? formatGregorianBirthday(profile.birthday_month!, profile.birthday_day!, profile.birthday_year)
      : `${toPersianDigits(jd)} ${JALALI_MONTH_NAMES[jm - 1]}${jy != null ? ' ' + toPersianDigits(jy) : ''}`
    : t('profilePage.addBirthday')

  return (
    <div className="hp-page">
      <div className="hp-page-back-header">
        <button className="hp-chat-back" onClick={() => navigate(-1)} aria-label={t('common.back')}>
          <IconArrowNarrowLeft size={20} />
        </button>
        <span className="hp-page-back-title">{t('profilePage.editTitle')}</span>
        <button
          className="hp-page-confirm-btn"
          disabled={firstNameEmpty || tooManyInterests || busy}
          onClick={submitMain}
          aria-label={t('profilePage.saveButton')}
        >
          <IconCheck size={22} />
        </button>
      </div>

      <div className="hp-tab-body">
        {/* "Your name" — one grouped card, two rows, no separate boxed
            fields (matches Telegram's own Account screen). First name
            is required; the checkmark above stays disabled while it's
            empty instead of erroring only after a tap. */}
        <div className="hp-grouped-card">
          <div className="hp-grouped-row">
            <input
              className="hp-grouped-input"
              placeholder={t('profilePage.firstNamePlaceholder')}
              value={firstName}
              onChange={(e) => setFirstName(e.target.value)}
            />
          </div>
          <div className="hp-grouped-row">
            <input
              className="hp-grouped-input"
              placeholder={t('profilePage.lastNamePlaceholder')}
              value={lastName}
              onChange={(e) => setLastName(e.target.value)}
            />
          </div>
        </div>

        <div className="hp-field">
          <Input
            header={t('profilePage.bioLabel')}
            value={bio}
            maxLength={MAX_BIO}
            onChange={(e) => setBio(e.target.value)}
            after={<span className="hp-char-count">{bio.length}/{MAX_BIO}</span>}
          />
          <p className="hp-hint">{t('profilePage.bioHint')}</p>
        </div>
        <div className="hp-field">
          <Input header={t('profilePage.locationLabel')} value={location} onChange={(e) => setLocation(e.target.value)} />
        </div>
        <div className="hp-field">
          <Input
            header={t('profilePage.interestsLabel')}
            placeholder={t('profilePage.interestsPlaceholder', { max: MAX_INTERESTS })}
            value={interestsText}
            onChange={(e) => setInterestsText(e.target.value)}
            status={tooManyInterests ? 'error' : undefined}
          />
          {tooManyInterests && <p className="hp-error">{t('profilePage.interestsTooMany', { max: MAX_INTERESTS })}</p>}
        </div>

        <p className="hp-field-label" style={{ margin: '18px 12px 0' }}>
          {t('profilePage.yourInfoLabel')}
        </p>
        <div className="hp-list">
          <button className="hp-list-row" onClick={openUsernameSheet}>
            <span className="hp-list-title">{username ? `@${username}` : t('profilePage.addUsername')}</span>
          </button>
          <button className="hp-list-row" onClick={openBirthdaySheet}>
            <span className="hp-list-title">{hasBirthday ? birthdayValueLabel : t('profilePage.addBirthday')}</span>
          </button>
        </div>

        {error && <p className="hp-error" style={{ margin: '12px 12px 0' }}>{error}</p>}
      </div>

      {usernameSheetOpen && (
        <Sheet title={t('profilePage.usernameLabel')} onClose={() => setUsernameSheetOpen(false)}>
          <div className="hp-field">
            <Input
              value={usernameDraft}
              onChange={(e) => {
                setUsernameDraft(e.target.value)
                setUsernameError(null)
              }}
              status={usernameInvalid ? 'error' : undefined}
            />
            <p className="hp-hint">{t('profilePage.usernameHint')}</p>
            {usernameInvalid && <p className="hp-error">{t('profilePage.usernameInvalidChars')}</p>}
            {usernameError && <p className="hp-error">{usernameError}</p>}
          </div>
          <div className="hp-field">
            <button
              className="hp-btn hp-btn-gradient"
              style={{ width: '100%' }}
              disabled={usernameInvalid || !usernameDraft || usernameBusy}
              onClick={submitUsername}
            >
              {usernameBusy ? t('common.loading') : t('profilePage.saveButton')}
            </button>
          </div>
        </Sheet>
      )}

      {birthdaySheetOpen && (
        <Sheet title={t('profilePage.birthdayLabel')} onClose={() => setBirthdaySheetOpen(false)}>
          <div className="hp-birthday-edit-row">
            <select className="hp-birthday-select" value={jy ?? ''} onChange={(e) => setJy(e.target.value ? Number(e.target.value) : null)}>
              <option value="">—</option>
              {Array.from({ length: 100 }, (_, i) => CURRENT_JALALI_YEAR - i).map((y) => (
                <option key={y} value={y}>
                  {toPersianDigits(y)}
                </option>
              ))}
            </select>
            <select
              className="hp-birthday-select"
              value={jm ?? ''}
              onChange={(e) => {
                const nextMonth = e.target.value ? Number(e.target.value) : null
                setJm(nextMonth)
                if (nextMonth != null && jd != null) {
                  const maxDay = daysInJalaliMonth(jy ?? CURRENT_JALALI_YEAR, nextMonth)
                  if (jd > maxDay) setJd(maxDay)
                }
              }}
            >
              {JALALI_MONTH_NAMES.map((name, i) => (
                <option key={name} value={i + 1}>
                  {name}
                </option>
              ))}
            </select>
            <select className="hp-birthday-select hp-birthday-select-day" value={jd ?? ''} onChange={(e) => setJd(e.target.value ? Number(e.target.value) : null)}>
              {Array.from({ length: jm != null ? daysInJalaliMonth(jy ?? CURRENT_JALALI_YEAR, jm) : 31 }, (_, i) => i + 1).map((day) => (
                <option key={day} value={day}>
                  {toPersianDigits(day)}
                </option>
              ))}
            </select>
          </div>
          <p className="hp-hint">{t('profilePage.birthdayHint')}</p>
          {error && <p className="hp-error">{error}</p>}
          <div className="hp-field">
            <button className="hp-btn hp-btn-gradient" style={{ width: '100%' }} disabled={busy} onClick={submitBirthday}>
              {busy ? t('common.loading') : t('profilePage.saveButton')}
            </button>
          </div>
        </Sheet>
      )}
    </div>
  )
}
