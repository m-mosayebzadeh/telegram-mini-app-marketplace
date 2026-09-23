import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { ApiError, apiFetch, formatApiError } from '../lib/api'
import { formatBirthday } from '../lib/jalali'
import { ErrorState, PageHeader, SkeletonRows, useToast } from '../components/ui'
import { IconCheck, IconChevron } from '../components/icons'
import { BirthdaySheet, type BirthdayValue } from '../components/profile/BirthdaySheet'
import { GenderSheet } from '../components/profile/GenderSheet'
import { InterestsSheet } from '../components/profile/InterestsSheet'
import { UsernameSheet } from '../components/profile/UsernameSheet'
import { useMe } from '../lib/MeContext'
import type { MyProfile, PublicProfile } from '../lib/types'

const MAX_INTERESTS = 10
/** A bio is a line or two under a name, not an essay — the same limit
 *  the backend enforces (see app/models/profile.py's MAX_BIO_LENGTH). */
const MAX_BIO = 100

/** Which sheet is open, if any. */
type OpenSheet = 'username' | 'birthday' | 'interests' | 'gender' | null

/**
 * Editing your own profile.
 *
 * Two kinds of thing live here and they are handled differently. Your
 * NAME and BIO are free text that belongs to this page and saves with
 * it. Your username, birthday and interests are each a distinct thing
 * with its own shape, its own rules and — for the username — its own
 * backend resource, so each is a row that opens a sheet and saves on its
 * own. That is also what lets each of them have a real editor instead of
 * a text field pretending to be one.
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
  const [bio, setBio] = useState('')

  const [username, setUsername] = useState('')
  const [birthday, setBirthday] = useState<BirthdayValue>({ month: null, day: null, year: null })
  const [interests, setInterests] = useState<string[]>([])
  // Held in state and written back on every save even when untouched.
  // The profile endpoint replaces the whole object, so a field this
  // screen does not know about is a field this screen deletes — and
  // gender is usually set at Echo's door rather than here.
  const [gender, setGender] = useState<string | null>(null)
  const [hideBirthYear] = useState(false)

  const [sheet, setSheet] = useState<OpenSheet>(null)
  const [usernameError, setUsernameError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    if (!me) return
    setFirstName(me.first_name)
    setLastName(me.last_name ?? '')
  }, [me])

  function load() {
    if (!me) return
    setLoadError(null)
    apiFetch<PublicProfile>(`/profiles/${me.id}`)
      .then((loaded) => {
        setProfile(loaded)
        setUsername(loaded.username ?? '')
        setBio(loaded.bio ?? '')
        setInterests(loaded.interests)
        setBirthday({
          month: loaded.birthday_month,
          day: loaded.birthday_day,
          year: loaded.birthday_year,
        })
        setGender(loaded.gender ?? null)
      })
      .catch((err) => setLoadError(formatApiError(err)))
  }

  useEffect(load, [me])

  const firstNameEmpty = firstName.trim().length === 0

  /**
   * Writes the profile. Takes what changed rather than reading state,
   * because a sheet saves immediately and React state would still be the
   * old value at that point.
   */
  async function saveProfile(next: {
    bio?: string
    interests?: string[]
    birthday?: BirthdayValue
    gender?: string | null
    hideBirthYear?: boolean
  }): Promise<boolean> {
    const nextBirthday = next.birthday ?? birthday
    setBusy(true)
    try {
      await apiFetch<MyProfile>('/profile/me', {
        method: 'PUT',
        body: JSON.stringify({
          bio: (next.bio ?? bio).trim() || null,
          interests: next.interests ?? interests,
          birthday_month: nextBirthday.month,
          birthday_day: nextBirthday.day,
          birthday_year: nextBirthday.year,
          gender: next.gender !== undefined ? next.gender : gender,
          hide_birth_year: next.hideBirthYear ?? hideBirthYear,
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

  async function saveNameAndBio() {
    if (firstNameEmpty || busy) return
    setBusy(true)
    try {
      await apiFetch('/me/name', {
        method: 'PUT',
        body: JSON.stringify({
          first_name: firstName.trim(),
          last_name: lastName.trim() || null,
        }),
      })
    } catch (err) {
      toast.error(formatApiError(err))
      setBusy(false)
      return
    }
    setBusy(false)

    if (await saveProfile({})) {
      refreshMe()
      navigate(-1)
    }
  }

  async function saveUsername(next: string) {
    setBusy(true)
    setUsernameError(null)
    try {
      await apiFetch('/me/username', { method: 'PUT', body: JSON.stringify({ username: next }) })
      setUsername(next)
      setSheet(null)
      refreshMe()
    } catch (err) {
      if (err instanceof ApiError && err.status === 400) {
        const reason = (err.body as { detail?: { reason?: string } } | null)?.detail?.reason
        setUsernameError(
          reason === 'username_taken'
            ? t('profilePage.usernameTaken')
            : t('profilePage.usernameInvalidChars'),
        )
      } else {
        setUsernameError(formatApiError(err))
      }
    } finally {
      setBusy(false)
    }
  }

  if (loadError || !profile) {
    return (
      <div className="ui-page">
        <PageHeader title={t('profilePage.editTitle')} onBack={() => navigate(-1)} />
        <div className="ui-page-body">
          {loadError ? <ErrorState text={loadError} onRetry={load} /> : <SkeletonRows count={4} />}
        </div>
      </div>
    )
  }

  const birthdayLabel =
    birthday.month != null && birthday.day != null
      ? formatBirthday(birthday.month, birthday.day, birthday.year, i18n.language)
      : t('profilePage.addBirthday')

  return (
    <div className="ui-page">
      <PageHeader
        title={t('profilePage.editTitle')}
        onBack={() => navigate(-1)}
        action={
          /* Save lives in the header because this page is a list of
             small edits, not one form with one outcome. It stays
             disabled until the page is saveable rather than erroring
             after the tap. */
          <button
            className="ui-btn ui-btn-icon ep-save"
            disabled={firstNameEmpty || busy}
            onClick={saveNameAndBio}
            aria-label={t('profilePage.saveButton')}
          >
            <IconCheck size={22} />
          </button>
        }
      />

      <div className="ui-page-body">
        {/* Two rows of one block: a first and last name are halves of one
            answer, and two bordered boxes would say they are two
            questions. */}
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
            {/* Fixed height: a box someone can drag is a box that ends up
                the wrong size, and at 100 characters there is nothing to
                drag it for. */}
            <textarea
              id="profile-bio"
              className="ui-textarea ep-bio"
              value={bio}
              maxLength={MAX_BIO}
              onChange={(e) => setBio(e.target.value)}
            />
            <span className="ui-field-help">{t('profilePage.bioHint')}</span>
          </label>
        </div>

        <section className="ui-section">
          <h2 className="ui-section-title">{t('profilePage.yourInfoLabel')}</h2>
          {/* Each of these is its own thing with its own rules, and each
              saves on its own — which is what lets each have a real
              editor rather than a text field pretending to be one. */}
          <div className="ui-list">
            <button className="ui-row" onClick={() => setSheet('username')}>
              <span className="ui-row-main">
                <span className="ui-row-title">{t('profilePage.usernameLabel')}</span>
              </span>
              <span className="ui-row-trailing">
                <span className={username ? 'ep-value-latin' : undefined}>
                  {username ? `@${username}` : t('profilePage.addUsername')}
                </span>
                <IconChevron size={20} className="ui-row-chevron" />
              </span>
            </button>

            <button className="ui-row" onClick={() => setSheet('gender')}>
              <span className="ui-row-main">
                <span className="ui-row-title">{t('profilePage.genderLabel')}</span>
              </span>
              <span className="ui-row-trailing">
                {gender ? t(`echo.gender.${gender}`) : t('profilePage.notSet')}
                <IconChevron size={20} className="ui-row-chevron" />
              </span>
            </button>

            <button className="ui-row" onClick={() => setSheet('birthday')}>
              <span className="ui-row-main">
                <span className="ui-row-title">{t('profilePage.birthdayLabel')}</span>
              </span>
              <span className="ui-row-trailing">
                {birthdayLabel}
                <IconChevron size={20} className="ui-row-chevron" />
              </span>
            </button>

            <button className="ui-row" onClick={() => setSheet('interests')}>
              <span className="ui-row-main">
                <span className="ui-row-title">{t('profilePage.interestsLabel')}</span>
                {/* The chips themselves, so the row says what is set
                    rather than only how many. */}
                {interests.length > 0 && (
                  <span className="ep-row-tags">
                    {interests.map((tag) => (
                      <span className="ui-tag" key={tag}>
                        {tag}
                      </span>
                    ))}
                  </span>
                )}
              </span>
              <span className="ui-row-trailing">
                {interests.length === 0 && t('profilePage.addInterests')}
                <IconChevron size={20} className="ui-row-chevron" />
              </span>
            </button>
          </div>
        </section>
      </div>

      {sheet === 'username' && (
        <UsernameSheet
          value={username}
          saving={busy}
          error={usernameError}
          onErrorCleared={() => setUsernameError(null)}
          onClose={() => {
            setUsernameError(null)
            setSheet(null)
          }}
          onSave={saveUsername}
        />
      )}

      {sheet === 'gender' && (
        <GenderSheet
          value={gender}
          saving={busy}
          onClose={() => setSheet(null)}
          onSave={async (next) => {
            if (await saveProfile({ gender: next })) {
              setGender(next)
              setSheet(null)
              load()
            }
          }}
        />
      )}

      {sheet === 'birthday' && (
        <BirthdaySheet
          value={birthday}
          saving={busy}
          onClose={() => setSheet(null)}
          onSave={async (next) => {
            if (await saveProfile({ birthday: next })) {
              setBirthday(next)
              setSheet(null)
            }
          }}
        />
      )}

      {sheet === 'interests' && (
        <InterestsSheet
          value={interests}
          max={MAX_INTERESTS}
          saving={busy}
          onClose={() => setSheet(null)}
          onSave={async (next) => {
            if (await saveProfile({ interests: next })) {
              setInterests(next)
              setSheet(null)
            }
          }}
        />
      )}
    </div>
  )
}
