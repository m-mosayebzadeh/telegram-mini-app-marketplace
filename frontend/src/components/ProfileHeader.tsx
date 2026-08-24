import { useTranslation } from 'react-i18next'
import { useNavigate } from 'react-router-dom'
import { Avatar } from '@telegram-apps/telegram-ui'
import type { PublicProfile } from '../lib/types'

interface ProfileHeaderProps {
  profile: PublicProfile
  isOwn: boolean
  following: boolean
  onFollow: () => void
  onUnfollow: () => void
  onEdit: () => void
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
  onEdit,
  onShare,
  moreMenuOpen,
  onToggleMoreMenu,
  onMoreItemClick,
}: ProfileHeaderProps) {
  const { t } = useTranslation()
  const navigate = useNavigate()

  return (
    <div>
      <div className="hp-cover" />
      <div className="hp-glass-card hp-header-card">
        <div className="hp-avatar-wrap">
          <div className="hp-avatar-ring">
            <Avatar
              size={96}
              src={profile.avatar_url ?? undefined}
              acronym={profile.display_name.slice(0, 1).toUpperCase()}
            />
          </div>
        </div>

        <h1 className="hp-name">{profile.display_name}</h1>
        {profile.username && <p className="hp-username">@{profile.username}</p>}

        {profile.bio && <p className="hp-bio">{profile.bio}</p>}
        {profile.location && (
          <div className="hp-meta-row">
            <span>📍</span>
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

        <div className="hp-actions-row">
          {isOwn ? (
            <button className="hp-btn hp-btn-gradient" onClick={onEdit}>
              {t('profilePage.editButton')}
            </button>
          ) : profile.follow_status === 'accepted' ? (
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

        {moreMenuOpen && (
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
    </div>
  )
}
