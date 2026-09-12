import { useEffect, useState } from 'react'
import { useLocation, useNavigate, useParams } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { formatApiError, apiFetch } from '../lib/api'
import { ContentGrid } from '../components/ContentGrid'
import { ContentUploadForm } from '../components/ContentUploadForm'
import { ProfileHeader } from '../components/ProfileHeader'
import { PageHeader, ErrorState, SkeletonRows, useToast } from '../components/ui'
import { Sheet } from '../components/ui/Sheet'
import { IconMore, IconPlus, IconSettings, IconShare } from '../components/icons'
import { useMe } from '../lib/MeContext'
import type { BackNavState } from '../lib/navState'
import type { PublicProfile } from '../lib/types'

/**
 * The profile — one component for both `/profile` (your own, a tab root)
 * and `/profiles/:id` (anyone else's, an inner page), the way a profile
 * tab and a visited profile share one layout in every app that has both.
 *
 * What the redesign moved out: the settings that used to hang off the
 * bottom as a stack of loose sections now live in pages/Settings.tsx,
 * one tap behind this page's own header. They only ever appeared on your
 * own profile, which meant the page had two unrelated halves and a
 * length that depended on whose profile you were looking at.
 */
export default function ProfileTab() {
  const { t } = useTranslation()
  const { id: paramId } = useParams()
  const navigate = useNavigate()
  const location = useLocation()
  const { me } = useMe()
  const toast = useToast()
  const targetId = paramId ? Number(paramId) : me?.id

  const [profile, setProfile] = useState<PublicProfile | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [following, setFollowing] = useState(false)
  const [moreOpen, setMoreOpen] = useState(false)
  const [uploading, setUploading] = useState(false)
  const [contentRefreshKey, setContentRefreshKey] = useState(0)

  // Where "back" should actually go — plain history-back by default, but
  // explicitly to Activity's Requests segment when that is genuinely
  // where this profile was opened from (see lib/navState.ts for why
  // navigate(-1) alone is not reliable enough for that one origin).
  const backState = location.state as BackNavState | null
  function goBack() {
    if (backState?.backTo === 'activity-requests') {
      navigate('/activity', { state: { segment: 'requests' } })
    } else {
      navigate(-1)
    }
  }

  function load() {
    if (targetId == null) return
    setError(null)
    apiFetch<PublicProfile>(`/profiles/${targetId}`)
      .then(setProfile)
      .catch((err) => setError(formatApiError(err)))
  }

  useEffect(load, [targetId])

  async function setFollow(next: 'follow' | 'unfollow') {
    if (targetId == null) return
    setFollowing(true)
    try {
      await apiFetch(`/follow/${targetId}`, {
        method: next === 'follow' ? 'POST' : 'DELETE',
      })
      load()
    } catch (err) {
      toast.error(formatApiError(err))
    } finally {
      setFollowing(false)
    }
  }

  async function share() {
    const url = `${window.location.origin}/profiles/${targetId}`
    try {
      await navigator.clipboard.writeText(url)
      toast.success(t('profilePage.shareCopied'))
    } catch {
      // Clipboard access can be denied (permissions, a non-HTTPS
      // context). Sharing is a convenience, not worth an error state.
    }
  }

  const isOwn = !!profile && !!me && me.id === profile.user_id
  // A visited profile is an inner page and gets a back arrow; your own
  // is a tab root and does not.
  const isRoot = !paramId

  return (
    <div className="ui-page">
      <PageHeader
        title={isRoot ? t('tabs.profile') : (profile?.display_name ?? '')}
        onBack={isRoot ? undefined : goBack}
        action={
          isRoot ? (
            <button
              className="ui-btn ui-btn-icon"
              onClick={() => navigate('/settings')}
              aria-label={t('settings.title')}
            >
              <IconSettings size={22} />
            </button>
          ) : (
            profile && (
              <button
                className="ui-btn ui-btn-icon"
                onClick={() => setMoreOpen(true)}
                aria-label={t('profilePage.moreButton')}
              >
                <IconMore size={22} />
              </button>
            )
          )
        }
      />

      <div className="ui-page-body">
        {error ? (
          <ErrorState text={error} onRetry={load} />
        ) : !profile ? (
          <SkeletonRows count={3} />
        ) : (
          <>
            <ProfileHeader
              profile={profile}
              isOwn={isOwn}
              following={following}
              onFollow={() => setFollow('follow')}
              onUnfollow={() => setFollow('unfollow')}
              onAvatarUploaded={load}
            />

            {/* The Offers tab is not built yet, and a disabled tab
                sitting next to a live one is a promise the product does
                not keep. Until it exists there is simply one section
                heading rather than a segmented control with one option
                the user cannot pick. */}
            <section className="ui-section">
              <h2 className="ui-section-title">{t('profilePage.tabContent')}</h2>
              <ContentGrid userId={profile.user_id} refreshKey={contentRefreshKey} />
            </section>
          </>
        )}
      </div>

      {isOwn && (
        <button className="pf-fab" onClick={() => setUploading(true)} aria-label={t('content.uploadButton')}>
          <IconPlus size={24} />
        </button>
      )}

      {uploading && (
        <Sheet title={t('content.uploadTitle')} onClose={() => setUploading(false)}>
          <ContentUploadForm
            onUploaded={() => {
              setUploading(false)
              toast.success(t('content.uploadSuccess'))
              setContentRefreshKey((k) => k + 1)
            }}
          />
        </Sheet>
      )}

      {moreOpen && profile && (
        <Sheet title={profile.display_name} onClose={() => setMoreOpen(false)}>
          <div className="ui-list">
            <button
              className="ui-row"
              onClick={() => {
                setMoreOpen(false)
                share()
              }}
            >
              <span className="ui-row-media">
                <IconShare size={20} />
              </span>
              <span className="ui-row-main">
                <span className="ui-row-title">{t('profilePage.shareButton')}</span>
              </span>
            </button>
            {/* Report and block are deliberately inert: no report/block
                system exists yet, and a row that silently does nothing
                is worse than one that says so. */}
            <button className="ui-row" onClick={() => toast.error(t('profilePage.moreComingSoon'))}>
              <span className="ui-row-main">
                <span className="ui-row-title">{t('profilePage.moreReport')}</span>
              </span>
            </button>
            <button className="ui-row" onClick={() => toast.error(t('profilePage.moreComingSoon'))}>
              <span className="ui-row-main">
                <span className="ui-row-title">{t('profilePage.moreBlock')}</span>
              </span>
            </button>
          </div>
        </Sheet>
      )}
    </div>
  )
}
