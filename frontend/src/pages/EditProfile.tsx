import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
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
import { Button, ErrorState, PageHeader, SkeletonRows, useToast } from '../components/ui'
import { IconCheck, IconChevron } from '../components/icons'
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
  const toast = useToast()

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
      toast.error(formatApiError(err))
      return false
    }
  }

  async function saveProfile(nextJy: number | null, nextJm: number | null, nextJd: number | null): Promise<boolean> {
    setBusy(true)
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
      toast.error(formatApiError(err))
      return false
    } finally {
      setBusy(false)
    }
  }

  async function submitMain() {
    if (firstNameEmpty || tooManyInterests || busy) return
    setBusy(true)
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

  if (loadError || !profile) {
    return (
      <div className="ui-page">
        <PageHeader title={t('profilePage.editTitle')} onBack={() => navigate(-1)} />
        <div className="ui-page-body">
          {loadError ? <ErrorState text={loadError} /> : <SkeletonRows count={4} />}
        </div>
      </div>
    )
  }

  const hasBirthday = jm != null && jd != null
  const birthdayValueLabel = hasBirthday
    ? i18n.language === 'en'
      ? formatGregorianBirthday(profile.birthday_month!, profile.birthday_day!, profile.birthday_year)
      : `${toPersianDigits(jd)} ${JALALI_MONTH_NAMES[jm - 1]}${jy != null ? ' ' + toPersianDigits(jy) : ''}`
    : t('profilePage.addBirthday')

  return (
    <div className="ui-page">
      <PageHeader
        title={t('profilePage.editTitle')}
        onBack={() => navigate(-1)}
        action={
          /* Save lives in the header rather than at the bottom because
             this page is a list of small edits, not one form with one
             outcome — the shape Telegram's own Account screen uses. It
             stays disabled until the page is actually saveable, instead
             of erroring after the tap. */
          <button
            className="ui-btn ui-btn-icon ep-save"
            disabled={firstNameEmpty || tooManyInterests || busy}
            onClick={submitMain}
            aria-label={t('profilePage.saveButton')}
          >
            <IconCheck size={22} />
          </button>
        }
      />

      <div className="ui-page-body">
        {/* Name is two rows of one block, not two boxed fields — they
            are halves of one answer. First name is required, which is
            why the header's save stays disabled while it is empty. */}
        <div className="ep-group">
          <input
            className="ep-group-input"
            placeholder={t('profilePage.firstNamePlaceholder')}
            value={firstName}
            onChange={(e) => setFirstName(e.target.value)}
            aria-label={t('profilePage.firstNamePlaceholder')}
          />
          <input
            className="ep-group-input"
            placeholder={t('profilePage.lastNamePlaceholder')}
            value={lastName}
            onChange={(e) => setLastName(e.target.value)}
            aria-label={t('profilePage.lastNamePlaceholder')}
          />
        </div>

        <div className="co-form">
          <label className="ui-field" htmlFor="profile-bio">
            <span className="ui-field-label">
              {t('profilePage.bioLabel')}
              <span className="ui-field-counter">
                {bio.length.toLocaleString(i18n.language)} / {MAX_BIO.toLocaleString(i18n.language)}
              </span>
            </span>
            <textarea
              id="profile-bio"
              className="ui-textarea"
              value={bio}
              maxLength={MAX_BIO}
              onChange={(e) => setBio(e.target.value)}
            />
            <span className="ui-field-help">{t('profilePage.bioHint')}</span>
          </label>

          <label className="ui-field" htmlFor="profile-location">
            <span className="ui-field-label">{t('profilePage.locationLabel')}</span>
            <input
              id="profile-location"
              className="ui-input"
              value={location}
              onChange={(e) => setLocation(e.target.value)}
            />
          </label>

          <div className={`ui-field${tooManyInterests ? ' ui-field-invalid' : ''}`}>
            <label className="ui-field-label" htmlFor="profile-interests">
              {t('profilePage.interestsLabel')}
              <span className="ui-field-counter">
                {interests.length.toLocaleString(i18n.language)} /{' '}
                {MAX_INTERESTS.toLocaleString(i18n.language)}
              </span>
            </label>
            <input
              id="profile-interests"
              className="ui-input"
              placeholder={t('profilePage.interestsPlaceholder', { max: MAX_INTERESTS })}
              value={interestsText}
              onChange={(e) => setInterestsText(e.target.value)}
              aria-invalid={tooManyInterests || undefined}
            />
            {tooManyInterests ? (
              <span className="ui-field-error">
                {t('profilePage.interestsTooMany', { max: MAX_INTERESTS })}
              </span>
            ) : (
              interests.length > 0 && (
                /* The tags as they will actually appear, so a comma in
                   the wrong place is visible before saving, not after. */
                <span className="ep-interest-preview">
                  {interests.map((tag) => (
                    <span className="ui-tag" key={tag}>
                      {tag}
                    </span>
                  ))}
                </span>
              )
            )}
          </div>
        </div>

        <section className="ui-section">
          <h2 className="ui-section-title">{t('profilePage.yourInfoLabel')}</h2>
          {/* Both of these are their own backend save, so both are a row
              that opens a sheet rather than a field on this page. */}
          <div className="ui-list">
            <button className="ui-row" onClick={openUsernameSheet}>
              <span className="ui-row-main">
                <span className="ui-row-title">{t('profilePage.usernameLabel')}</span>
              </span>
              <span className="ui-row-trailing">
                {username ? `@${username}` : t('profilePage.addUsername')}
                <IconChevron size={20} className="ui-row-chevron" />
              </span>
            </button>
            <button className="ui-row" onClick={openBirthdaySheet}>
              <span className="ui-row-main">
                <span className="ui-row-title">{t('profilePage.birthdayLabel')}</span>
              </span>
              <span className="ui-row-trailing">
                {hasBirthday ? birthdayValueLabel : t('profilePage.addBirthday')}
                <IconChevron size={20} className="ui-row-chevron" />
              </span>
            </button>
          </div>
        </section>
      </div>

      {usernameSheetOpen && (
        <Sheet
          title={t('profilePage.usernameLabel')}
          onClose={() => setUsernameSheetOpen(false)}
          footer={
            <Button
              variant="primary"
              size="lg"
              block
              disabled={usernameInvalid || !usernameDraft}
              loading={usernameBusy}
              onClick={submitUsername}
            >
              {t('profilePage.saveButton')}
            </Button>
          }
        >
          <div className={`ui-field${usernameInvalid || usernameError ? ' ui-field-invalid' : ''}`}>
            <label className="ui-field-label" htmlFor="profile-username">
              {t('profilePage.usernameLabel')}
            </label>
            <div className="ui-input-group">
              <span className="ui-input-group-addon">@</span>
              <input
                id="profile-username"
                className="ui-input"
                value={usernameDraft}
                onChange={(e) => {
                  setUsernameDraft(e.target.value)
                  setUsernameError(null)
                }}
                aria-invalid={usernameInvalid || undefined}
                autoFocus
              />
            </div>
            {usernameInvalid ? (
              <span className="ui-field-error">{t('profilePage.usernameInvalidChars')}</span>
            ) : usernameError ? (
              <span className="ui-field-error">{usernameError}</span>
            ) : (
              <span className="ui-field-help">{t('profilePage.usernameHint')}</span>
            )}
          </div>
        </Sheet>
      )}

      {birthdaySheetOpen && (
        <Sheet
          title={t('profilePage.birthdayLabel')}
          onClose={() => setBirthdaySheetOpen(false)}
          footer={
            <Button variant="primary" size="lg" block loading={busy} onClick={submitBirthday}>
              {t('profilePage.saveButton')}
            </Button>
          }
        >
          {/* Year, month, day — Jalali, because that is the calendar the
              people using this app have their birthday in. The year is
              optional and comes first, so leaving it blank is a visible
              choice rather than a field nobody noticed. */}
          <div className="ep-birthday">
            <select
              className="ui-input ep-birthday-select"
              aria-label={t('profilePage.birthdayLabel')}
              value={jy ?? ''}
              onChange={(e) => setJy(e.target.value ? Number(e.target.value) : null)}
            >
              <option value="">-</option>
              {Array.from({ length: 100 }, (_, i) => CURRENT_JALALI_YEAR - i).map((y) => (
                <option key={y} value={y}>
                  {toPersianDigits(y)}
                </option>
              ))}
            </select>
            <select
              className="ui-input ep-birthday-select"
              value={jm ?? ''}
              onChange={(e) => {
                const nextMonth = e.target.value ? Number(e.target.value) : null
                setJm(nextMonth)
                // A day that does not exist in the newly chosen month
                // would otherwise silently become an invalid date.
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
            <select
              className="ui-input ep-birthday-select"
              value={jd ?? ''}
              onChange={(e) => setJd(e.target.value ? Number(e.target.value) : null)}
            >
              {Array.from(
                { length: jm != null ? daysInJalaliMonth(jy ?? CURRENT_JALALI_YEAR, jm) : 31 },
                (_, i) => i + 1,
              ).map((day) => (
                <option key={day} value={day}>
                  {toPersianDigits(day)}
                </option>
              ))}
            </select>
          </div>
          <p className="ui-field-help ep-birthday-hint">{t('profilePage.birthdayHint')}</p>
        </Sheet>
      )}
    </div>
  )
}
