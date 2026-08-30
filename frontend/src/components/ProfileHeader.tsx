import { useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useNavigate } from 'react-router-dom'
import { Avatar } from '@telegram-apps/telegram-ui'
import { apiFetch } from '../lib/api'
import { daysUntilNextBirthday, formatJalaliBirthday } from '../lib/jalali'
import type { MyProfile, PublicProfile } from '../lib/types'
import { AvatarGallery } from './AvatarGallery'
import { IconCamera, IconEdit, IconWallet } from './icons'
import { Sheet } from './Sheet'

interface ProfileHeaderProps {
  profile: PublicProfile
  isOwn: boolean
  following: boolean
  onFollow: () => void
  onUnfollow: () => void
  // Called after a new avatar finishes uploading, so the parent can
  // reload `profile` — ProfileHeader only ever receives `profile` as a
  // read-only prop, it has no setter of its own.
  onAvatarUploaded: () => void
  onShare: () => void
  moreMenuOpen: boolean
  onToggleMoreMenu: () => void
  onMoreItemClick: () => void
}

/**
 * The top of the profile tab: a gradient cover, avatar with a gradient
 * ring, name/bio/location, interest chips, follower/following counts,
 * and the action row (Follow, or Edit for your own profile; Share; the
 * "More" menu). The "More" menu's Report/Block entries are deliberately
 * inert placeholders — per the product decision behind this redesign, no
 * real report/block system exists yet (TECHNICAL_REQUIREMENTS.md still
 * lists that as out of scope for this pass).
 */
export function ProfileHeader({
  profile,
  isOwn,
  following,
  onFollow,
  onUnfollow,
  onAvatarUploaded,
  onShare,
  moreMenuOpen,
  onToggleMoreMenu,
  onMoreItemClick,
}: ProfileHeaderProps) {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const [birthdayOpen, setBirthdayOpen] = useState(false)
  const [previewOpen, setPreviewOpen] = useState(false)
  const [avatarBusy, setAvatarBusy] = useState(false)
  const avatarInputRef = useRef<HTMLInputElement>(null)

  const hasBirthday = profile.birthday_month != null && profile.birthday_day != null

  async function handleAvatarPicked(file: File | null) {
    if (!file) return
    setAvatarBusy(true)
    try {
      const form = new FormData()
      form.append('file', file)
      await apiFetch<MyProfile>('/profile/me/avatar', { method: 'POST', body: form })
      onAvatarUploaded()
    } catch {
      // A failed avatar upload just leaves the old photo in place — no
      // separate error UI here; the existing photo (or the fallback
      // initial) is always a valid state to stay on.
    } finally {
      setAvatarBusy(false)
    }
  }

  return (
    <div>
      <div className="hp-cover">
        <div className="hp-cover-glow hp-cover-glow-a" />
        <div className="hp-cover-glow hp-cover-glow-b" />
      </div>
      <div className="hp-glass-card hp-header-card">
        <div className="hp-avatar-wrap">
          {/* Tapping opens a simple fullscreen preview (see .hp-avatar-preview-*
              below) — not the drag-to-zoom gesture Telegram's own app
              has; a plain tap-to-view is the deliberately simpler
              version agreed on for this pass. Only wired when there's
              an actual photo — nothing to preview for the fallback
              initial-letter circle. */}
          <div
            className="hp-avatar-ring"
            onClick={() => profile.avatar_url && setPreviewOpen(true)}
            style={{ cursor: profile.avatar_url ? 'pointer' : 'default' }}
          >
            <Avatar
              size={96}
              src={profile.avatar_url ?? undefined}
              acronym={profile.display_name.slice(0, 1).toUpperCase()}
            />
          </div>
        </div>

        {/* dir="auto" — not the app's current UI language — decides
            which way this renders: the browser picks RTL/LTR from the
            name's OWN first strong character (see backend/app/models/user.py's
            display_name property), so "سهیل mz" reads right-to-left
            starting with سهیل, and "soheil mz" reads left-to-right,
            regardless of whether the app itself is in Persian or English. */}
        <h1 className="hp-name" dir="auto">
          {profile.display_name}
        </h1>
        {profile.username && <p className="hp-username">@{profile.username}</p>}

        {/* Nothing renders here at all when is_trusted is false — never
            an empty placeholder badge (see PublicProfile.is_trusted's
            docstring). */}
        {profile.is_trusted && (
          <div className="hp-trust-badge">
            <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor" stroke="none">
              <path d="M12 3l1.7 6.8L20 11l-6.3 1.2L12 19l-1.7-6.8L4 11l6.3-1.2L12 3z" />
            </svg>
            <span>{t('profilePage.trustedBadge')}</span>
          </div>
        )}

        {hasBirthday && (
          <button className="hp-birthday-chip" onClick={() => setBirthdayOpen(true)}>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
              <path d="M12 3v3" />
              <circle cx="12" cy="5.6" r="1" fill="currentColor" stroke="none" />
              <rect x="4.5" y="11" width="15" height="7.5" rx="2.4" />
              <path d="M4.5 14.2c1.6-1.3 3.1-1.3 4.7 0s3.1 1.3 4.7 0s3.1-1.3 4.6 0" />
            </svg>
          </button>
        )}

        {profile.bio && <p className="hp-bio">{profile.bio}</p>}
        {profile.location && (
          <div className="hp-meta-row">
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
              <path d="M12 21s7-6.5 7-12a7 7 0 0 0-14 0c0 5.5 7 12 7 12z" />
              <circle cx="12" cy="9" r="2.4" />
            </svg>
            <span>{profile.location}</span>
          </div>
        )}

        {profile.interests.length > 0 && (
          <div className="hp-chip-row">
            {profile.interests.map((tag) => (
              <span key={tag} className="hp-chip">
                {tag}
              </span>
            ))}
          </div>
        )}

        <div className="hp-stats-row">
          <button className="hp-stat" onClick={() => navigate(`/profiles/${profile.user_id}/followers`)}>
            <span className="hp-stat-value">{profile.followers_count}</span>
            <span className="hp-stat-label">{t('profilePage.followersTitle')}</span>
          </button>
          <button className="hp-stat" onClick={() => navigate(`/profiles/${profile.user_id}/following`)}>
            <span className="hp-stat-value">{profile.following_count}</span>
            <span className="hp-stat-label">{t('profilePage.followingTitle')}</span>
          </button>
        </div>

        {isOwn ? (
          // DOM order = visual order for a plain flex row, and it
          // already mirrors on its own under dir="rtl" vs dir="ltr" —
          // the exact same mechanism App.tsx's bottom nav relies on
          // (see its own comment) — so this one order is both "Set
          // Photo | Edit Profile | Wallet" in English and, mirrored,
          // "Wallet | Edit Profile | Set Photo" in Persian.
          <div className="hp-actions-row">
            <button
              className="hp-header-action"
              onClick={() => avatarInputRef.current?.click()}
              disabled={avatarBusy}
            >
              <IconCamera size={22} />
              {t('profilePage.setPhotoButton')}
            </button>
            <input
              ref={avatarInputRef}
              type="file"
              accept="image/*"
              style={{ display: 'none' }}
              onChange={(e) => handleAvatarPicked(e.target.files?.[0] ?? null)}
            />
            <button className="hp-header-action" onClick={() => navigate('/profile/edit')}>
              <IconEdit size={22} />
              {t('profilePage.editButton')}
            </button>
            <button className="hp-header-action" onClick={() => navigate('/wallet')}>
              <IconWallet size={22} />
              {t('wallet.title')}
            </button>
          </div>
        ) : (
          <div className="hp-actions-row">
            {profile.follow_status === 'accepted' ? (
              <button className="hp-btn hp-btn-outline hp-btn-wide" disabled={following} onClick={onUnfollow}>
                {t('profilePage.following')}
              </button>
            ) : profile.follow_status === 'pending' ? (
              <button className="hp-btn hp-btn-outline hp-btn-wide" disabled>
                {t('profilePage.requested')}
              </button>
            ) : (
              <button className="hp-btn hp-btn-gradient" disabled={following} onClick={onFollow}>
                {t('profilePage.follow')}
              </button>
            )}
            <button className="hp-btn hp-btn-outline" onClick={onShare} aria-label={t('profilePage.shareButton')}>
              ↗
            </button>
            <button
              className="hp-btn hp-btn-outline"
              onClick={onToggleMoreMenu}
              aria-label={t('profilePage.moreButton')}
            >
              ⋯
            </button>
          </div>
        )}

        {!isOwn && moreMenuOpen && (
          <div className="hp-menu">
            <button className="hp-menu-item" onClick={onMoreItemClick}>
              {t('profilePage.moreReport')}
            </button>
            <button className="hp-menu-item" onClick={onMoreItemClick}>
              {t('profilePage.moreBlock')}
            </button>
          </div>
        )}
      </div>

      {previewOpen && profile.avatar_url && (
        <AvatarGallery
          userId={profile.user_id}
          isOwn={isOwn}
          onClose={() => setPreviewOpen(false)}
          onChanged={onAvatarUploaded}
        />
      )}

      {birthdayOpen && hasBirthday && (
        <Sheet title={t('profilePage.birthdaySheetTitle')} onClose={() => setBirthdayOpen(false)}>
          <div className="hp-birthday-sheet-body">
            <div className="hp-birthday-sheet-icon">
              <svg width="30" height="30" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round">
                <path d="M12 3v3" />
                <circle cx="12" cy="5.6" r="1" fill="currentColor" stroke="none" />
                <rect x="4.5" y="11" width="15" height="7.5" rx="2.4" />
                <path d="M4.5 14.2c1.6-1.3 3.1-1.3 4.7 0s3.1 1.3 4.7 0s3.1-1.3 4.6 0" />
              </svg>
            </div>
            <p className="hp-birthday-sheet-date">
              {formatJalaliBirthday(profile.birthday_month!, profile.birthday_day!)}
            </p>
            <span className="hp-birthday-sheet-countdown">
              {daysUntilNextBirthday(profile.birthday_month!, profile.birthday_day!) === 0
                ? t('profilePage.birthdayToday')
                : t('profilePage.birthdayCountdown', {
                    count: daysUntilNextBirthday(profile.birthday_month!, profile.birthday_day!),
                  })}
            </span>
          </div>
        </Sheet>
      )}
    </div>
  )
}
