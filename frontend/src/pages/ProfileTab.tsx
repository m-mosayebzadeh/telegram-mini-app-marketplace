import { useEffect, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { Cell, Placeholder, Section, Spinner } from '@telegram-apps/telegram-ui'
import { formatApiError, apiFetch } from '../lib/api'
import { ContentGrid } from '../components/ContentGrid'
import { ContentUploadForm } from '../components/ContentUploadForm'
import { ProfileEditForm } from '../components/ProfileEditForm'
import { ProfileHeader } from '../components/ProfileHeader'
import { Sheet } from '../components/Sheet'
import { ThemeSwitcher } from '../components/ThemeSwitcher'
import { useMe } from '../lib/MeContext'
import { clearDevUserChoice, isRealTelegramLaunch } from '../lib/session'
import type { PublicProfile } from '../lib/types'

/**
 * The unified profile tab — replaces the old split between Profile.tsx
 * (your own account) and PublicProfile.tsx (anyone else's): both routes
 * (`/profile` and `/profiles/:id`) render this component, the only
 * difference being which user id it resolves to. This mirrors how
 * Instagram's own profile tab and a visited profile share one layout,
 * just with different actions available (Edit vs. Follow).
 *
 * Content/Offers tabs: Offers is a disabled placeholder for now — see
 * the product discussion in TECHNICAL_REQUIREMENTS.md's changelog for
 * why (an offer-mix view here was explicitly out of scope for this pass).
 *
 * Uploading is deliberately NOT a row inside the page's own content —
 * it opens as a floating-action-button-triggered bottom sheet (see
 * components/Sheet.tsx) instead, so the profile itself stays a clean
 * read surface and "add content" doesn't compete for space with the
 * things a visitor actually came here to look at.
 */
export default function ProfileTab() {
  const { t, i18n } = useTranslation()
  const { id: paramId } = useParams()
  const navigate = useNavigate()
  const { me } = useMe()
  const targetId = paramId ? Number(paramId) : me?.id

  const [profile, setProfile] = useState<PublicProfile | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [message, setMessage] = useState<string | null>(null)
  const [following, setFollowing] = useState(false)
  const [moreMenuOpen, setMoreMenuOpen] = useState(false)
  const [editing, setEditing] = useState(false)
  const [uploading, setUploading] = useState(false)
  const [activeTab, setActiveTab] = useState<'content' | 'offers'>('content')
  const [contentRefreshKey, setContentRefreshKey] = useState(0)

  function load() {
    if (targetId == null) return
    apiFetch<PublicProfile>(`/profiles/${targetId}`)
      .then(setProfile)
      .catch((err) => setError(formatApiError(err)))
  }

  useEffect(load, [targetId])

  async function follow() {
    if (targetId == null) return
    setFollowing(true)
    try {
      await apiFetch(`/follow/${targetId}`, { method: 'POST' })
      load()
    } catch (err) {
      setError(formatApiError(err))
    } finally {
      setFollowing(false)
    }
  }

  async function unfollow() {
    if (targetId == null) return
    setFollowing(true)
    try {
      await apiFetch(`/follow/${targetId}`, { method: 'DELETE' })
      load()
    } catch (err) {
      setError(formatApiError(err))
    } finally {
      setFollowing(false)
    }
  }

  async function share() {
    const url = `${window.location.origin}/profiles/${targetId}`
    try {
      await navigator.clipboard.writeText(url)
      setMessage(t('profilePage.shareCopied'))
    } catch {
      // Clipboard access can be denied (permissions, non-HTTPS context)
      // — not worth surfacing as an error, sharing is a convenience.
    }
  }

  function toggleLanguage() {
    i18n.changeLanguage(i18n.language === 'fa' ? 'en' : 'fa')
  }

  if (error) return <Placeholder header={t('common.error')}>{error}</Placeholder>
  if (!profile || !me) {
    return (
      <Placeholder>
        <Spinner size="l" />
      </Placeholder>
    )
  }

  const isOwn = me.id === profile.user_id

  return (
    <div className="hp-page">
      <ProfileHeader
        profile={profile}
        isOwn={isOwn}
        following={following}
        onFollow={follow}
        onUnfollow={unfollow}
        onEdit={() => setEditing(true)}
        onAvatarUploaded={load}
        onShare={share}
        moreMenuOpen={moreMenuOpen}
        onToggleMoreMenu={() => setMoreMenuOpen(!moreMenuOpen)}
        onMoreItemClick={() => setMessage(t('profilePage.moreComingSoon'))}
      />

      {message && <Section>{message}</Section>}

      <div className="hp-tabs">
        <button
          className={`hp-tab ${activeTab === 'content' ? 'hp-tab-active' : ''}`}
          onClick={() => setActiveTab('content')}
        >
          {t('profilePage.tabContent')}
        </button>
        <button className="hp-tab" disabled>
          {t('profilePage.tabOffers')}
        </button>
      </div>

      {activeTab === 'content' && <ContentGrid userId={profile.user_id} refreshKey={contentRefreshKey} />}
      {activeTab === 'offers' && <div className="hp-empty">{t('profilePage.offersComingSoon')}</div>}

      {isOwn && activeTab === 'content' && (
        <button className="hp-fab" onClick={() => setUploading(true)} aria-label={t('content.uploadButton')}>
          +
        </button>
      )}

      {editing && (
        <Sheet title={t('profilePage.editTitle')} onClose={() => setEditing(false)}>
          <ProfileEditForm
            initial={profile}
            onSaved={() => {
              setEditing(false)
              setMessage(t('profilePage.saveSuccess'))
              load()
            }}
          />
        </Sheet>
      )}

      {uploading && (
        <Sheet title={t('content.uploadTitle')} onClose={() => setUploading(false)}>
          <ContentUploadForm
            onUploaded={() => {
              setUploading(false)
              setMessage(t('content.uploadSuccess'))
              setContentRefreshKey((k) => k + 1)
            }}
          />
        </Sheet>
      )}

      {isOwn && (
        <>
          <Section>
            {/* The badge is the only "notification" for a new follow
                request right now — checked on every /me call (see
                backend/app/main.py), since there's no push-notification
                system yet (TECHNICAL_REQUIREMENTS.md section 9). */}
            <Cell onClick={() => navigate('/follow-requests')}>
              {me.pending_follow_requests_count > 0
                ? t('followRequests.linkWithCount', { count: me.pending_follow_requests_count })
                : t('followRequests.link')}
            </Cell>
          </Section>
          <Section>
            <Cell subtitle={t('common.language')} onClick={toggleLanguage}>
              {i18n.language === 'fa' ? 'فارسی' : 'English'}
            </Cell>
          </Section>
          <Section>
            <div style={{ padding: '10px 16px' }}>
              <ThemeSwitcher />
            </div>
          </Section>
          {!isRealTelegramLaunch() && (
            <Section>
              <Cell
                onClick={() => {
                  clearDevUserChoice()
                  window.location.reload()
                }}
              >
                {t('login.switchUser')}
              </Cell>
            </Section>
          )}
        </>
      )}
    </div>
  )
}
