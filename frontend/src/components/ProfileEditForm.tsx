import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Input } from '@telegram-apps/telegram-ui'
import { ApiError, apiFetch } from '../lib/api'
import type { MyProfile, PublicProfile } from '../lib/types'

// Mirrors backend/app/models/profile.py's MAX_INTERESTS — duplicated
// here the same way MAX_VIDEO_DURATION_SECONDS is in
// ContentUploadForm.tsx, since it's a fixed phase-1 policy constant.
const MAX_INTERESTS = 10

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
  const [bio, setBio] = useState(initial.bio ?? '')
  const [location, setLocation] = useState(initial.location ?? '')
  const [interestsText, setInterestsText] = useState(initial.interests.join(', '))
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const interests = interestsText
    .split(',')
    .map((tag) => tag.trim())
    .filter((tag) => tag.length > 0)
  const tooManyInterests = interests.length > MAX_INTERESTS

  async function submit() {
    if (tooManyInterests) return
    setBusy(true)
    setError(null)
    try {
      const updated = await apiFetch<MyProfile>('/profile/me', {
        method: 'PUT',
        body: JSON.stringify({ bio: bio || null, location: location || null, interests }),
      })
      onSaved(updated)
    } catch (err) {
      setError(err instanceof ApiError ? JSON.stringify(err.body) : String(err))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div>
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

      {error && <p className="hp-error">{error}</p>}

      <div className="hp-field">
        <button
          className="hp-btn hp-btn-gradient"
          style={{ width: '100%' }}
          disabled={tooManyInterests || busy}
          onClick={submit}
        >
          {busy ? t('common.loading') : t('profilePage.saveButton')}
        </button>
      </div>
    </div>
  )
}
