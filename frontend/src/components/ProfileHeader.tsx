import { useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useNavigate } from 'react-router-dom'
import { apiFetch } from '../lib/api'
import { daysUntilNextBirthday, formatJalaliBirthday } from '../lib/jalali'
import { useMe } from '../lib/MeContext'
import type { MyProfile, PublicProfile } from '../lib/types'
import { AvatarGallery } from './AvatarGallery'
import { Sheet } from './ui/Sheet'
import { Button } from './ui/Button'
import {
  IconCake,
  IconCamera,
  IconCheck,
  IconMapPin,
  IconPersonFallback,
} from './icons'

interface ProfileHeaderProps {
  profile: PublicProfile
  isOwn: boolean
  following: boolean
  onFollow: () => void
  onUnfollow: () => void
  /** Called after a new avatar finishes uploading, so the parent can
   *  reload `profile` — this component only ever receives it read-only. */
  onAvatarUploaded: () => void
}

/**
 * The identity block at the top of a profile.
 *
 * Rebuilt on the design system. What changed beyond the palette: the
 * gradient cover, the glass card that floated over it and the ring
 * around the avatar are all gone. They were three separate pieces of
 * chrome saying the same thing — "a person starts here" — which the
 * photo and the name say by themselves.
 *
 * The old action row put three equally-weighted buttons under your own
 * profile (Set photo / Edit / Wallet). Two of those are settings, and
 * they moved to pages/Settings.tsx; the camera stayed, on the avatar
 * itself, where it is about THIS photo rather than a page-level action.
 */
export function ProfileHeader({
  profile,
  isOwn,
  following,
  onFollow,
  onUnfollow,
  onAvatarUploaded,
}: ProfileHeaderProps) {
  const { t, i18n } = useTranslation()
  const navigate = useNavigate()
  const { refreshMe } = useMe()
  const [birthdayOpen, setBirthdayOpen] = useState(false)
  const [previewOpen, setPreviewOpen] = useState(false)
  const [avatarBusy, setAvatarBusy] = useState(false)
  const avatarInputRef = useRef<HTMLInputElement>(null)

  const hasBirthday = profile.birthday_month != null && profile.birthday_day != null

  // Every place the CURRENT avatar can change needs to do two things:
  // reload this page's own `profile` prop, AND refresh the bottom nav's
  // thumbnail, which reads off `me.avatar_url`. One function so neither
  // call site can forget the second half.
  function notifyAvatarChanged() {
    onAvatarUploaded()
    refreshMe()
  }

  async function handleAvatarPicked(file: File | null) {
    if (!file) return
    setAvatarBusy(true)
    try {
      const form = new FormData()
      form.append('file', file)
      await apiFetch<MyProfile>('/profile/me/avatar', { method: 'POST', body: form })
      notifyAvatarChanged()
    } catch {
      // A failed upload leaves the old photo in place — the existing
      // photo (or the fallback initial) is always a valid state.
    } finally {
      setAvatarBusy(false)
    }
  }

  return (
    <header className="pf-identity">
      <div className="pf-avatar-wrap">
        <button
          type="button"
          className="pf-avatar"
          // Nothing to preview for the fallback initial.
          onClick={() => profile.avatar_url && setPreviewOpen(true)}
          disabled={!profile.avatar_url}
          aria-label={profile.display_name}
        >
          {profile.avatar_url ? (
            <img src={profile.avatar_url} alt="" />
          ) : (
            <span className="pf-avatar-fallback">
              <IconPersonFallback size={40} />
            </span>
          )}
        </button>

        {isOwn && (
          <>
            {/* On the avatar, not in a row of page actions: this button
                is about THIS photo, and putting it here means it never
                has to compete with Edit or Wallet for a reader's
                attention. */}
            <button
              type="button"
              className="pf-avatar-camera"
              onClick={() => avatarInputRef.current?.click()}
              disabled={avatarBusy}
              aria-label={t('profilePage.setPhotoButton')}
            >
              <IconCamera size={16} />
            </button>
            <input
              ref={avatarInputRef}
              type="file"
              accept="image/*"
              hidden
              onChange={(e) => handleAvatarPicked(e.target.files?.[0] ?? null)}
            />
          </>
        )}
      </div>

      {/* dir="auto", not the UI language: the browser picks the run
          direction from the NAME's own first strong character, so
          "سهیل mz" reads right-to-left and "soheil mz" left-to-right
          whichever language the app itself is in. */}
      <h1 className="pf-name" dir="auto">
        {profile.display_name}
        {profile.is_trusted && (
          <span className="pf-trusted" title={t('profilePage.trustedBadge')}>
            <IconCheck size={13} />
          </span>
        )}
      </h1>

      {profile.username && <p className="pf-username">@{profile.username}</p>}

      {profile.bio && (
        <p className="pf-bio" dir="auto">
          {profile.bio}
        </p>
      )}

      {(profile.location || hasBirthday) && (
        <div className="pf-meta">
          {profile.location && (
            <span className="pf-meta-item">
              <IconMapPin size={16} />
              {profile.location}
            </span>
          )}
          {hasBirthday && (
            <button type="button" className="pf-meta-item pf-meta-button" onClick={() => setBirthdayOpen(true)}>
              <IconCake size={16} />
              {formatJalaliBirthday(profile.birthday_month!, profile.birthday_day!)}
            </button>
          )}
        </div>
      )}

      {profile.interests.length > 0 && (
        <div className="pf-tags">
          {profile.interests.map((tag) => (
            <span key={tag} className="ui-tag">
              {tag}
            </span>
          ))}
        </div>
      )}

      <div className="pf-stats">
        <button
          type="button"
          className="pf-stat"
          onClick={() => navigate(`/profiles/${profile.user_id}/followers`)}
        >
          <span className="pf-stat-value tabular">
            {profile.followers_count.toLocaleString(i18n.language)}
          </span>
          <span className="pf-stat-label">{t('profilePage.followersTitle')}</span>
        </button>
        <button
          type="button"
          className="pf-stat"
          onClick={() => navigate(`/profiles/${profile.user_id}/following`)}
        >
          <span className="pf-stat-value tabular">
            {profile.following_count.toLocaleString(i18n.language)}
          </span>
          <span className="pf-stat-label">{t('profilePage.followingTitle')}</span>
        </button>
      </div>

      {/* Your own profile carries no action here at all — editing is a
          setting and lives behind the header's gear. A visitor gets one
          decision, and it is the only primary button on the screen. */}
      {!isOwn && (
        <div className="pf-actions">
          {profile.follow_status === 'accepted' ? (
            <Button variant="secondary" size="md" block loading={following} onClick={onUnfollow}>
              {t('profilePage.following')}
            </Button>
          ) : profile.follow_status === 'pending' ? (
            <Button variant="secondary" size="md" block disabled>
              {t('profilePage.requested')}
            </Button>
          ) : (
            <Button variant="primary" size="md" block loading={following} onClick={onFollow}>
              {t('profilePage.follow')}
            </Button>
          )}
        </div>
      )}

      {previewOpen && profile.avatar_url && (
        <AvatarGallery
          userId={profile.user_id}
          isOwn={isOwn}
          onClose={() => setPreviewOpen(false)}
          onChanged={notifyAvatarChanged}
        />
      )}

      {birthdayOpen && hasBirthday && (
        <Sheet title={t('profilePage.birthdaySheetTitle')} onClose={() => setBirthdayOpen(false)}>
          <div className="pf-birthday">
            <span className="pf-birthday-icon">
              <IconCake size={28} />
            </span>
            <p className="pf-birthday-date">
              {formatJalaliBirthday(profile.birthday_month!, profile.birthday_day!)}
            </p>
            <span className="pf-birthday-countdown">
              {daysUntilNextBirthday(profile.birthday_month!, profile.birthday_day!) === 0
                ? t('profilePage.birthdayToday')
                : t('profilePage.birthdayCountdown', {
                    count: daysUntilNextBirthday(profile.birthday_month!, profile.birthday_day!),
                  })}
            </span>
          </div>
        </Sheet>
      )}
    </header>
  )
}
