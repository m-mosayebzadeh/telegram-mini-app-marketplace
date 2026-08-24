import { useEffect, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { Button, Cell, List, Placeholder, Section, Spinner } from '@telegram-apps/telegram-ui'
import { apiFetch, ApiError } from '../lib/api'
import { useMe } from '../lib/MeContext'
import type { PublicProfile as PublicProfileType } from '../lib/types'

/** Anyone's public profile (GET /profiles/{user_id}) — never includes
 * telegram_id (backend/app/profile/schemas.py's PublicProfileOut is
 * explicit about that, per TECHNICAL_REQUIREMENTS.md section 5). Reached
 * from an offer's "view profile" action (see OfferDetail.tsx), or from
 * the logged-in user's own Profile tab. */
export default function PublicProfile() {
  const { t } = useTranslation()
  const { id } = useParams()
  const navigate = useNavigate()
  const { me } = useMe()
  const [profile, setProfile] = useState<PublicProfileType | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [following, setFollowing] = useState(false)

  function load() {
    apiFetch<PublicProfileType>(`/profiles/${id}`)
      .then(setProfile)
      .catch((err) => setError(err instanceof ApiError ? JSON.stringify(err.body) : String(err)))
  }

  useEffect(load, [id])

  async function follow() {
    setFollowing(true)
    try {
      await apiFetch(`/follow/${id}`, { method: 'POST' })
      load()
    } catch (err) {
      setError(err instanceof ApiError ? JSON.stringify(err.body) : String(err))
    } finally {
      setFollowing(false)
    }
  }

  async function unfollow() {
    setFollowing(true)
    try {
      await apiFetch(`/follow/${id}`, { method: 'DELETE' })
      load()
    } catch (err) {
      setError(err instanceof ApiError ? JSON.stringify(err.body) : String(err))
    } finally {
      setFollowing(false)
    }
  }

  if (error) return <Placeholder header={t('common.error')}>{error}</Placeholder>
  if (!profile) {
    return (
      <Placeholder>
        <Spinner size="l" />
      </Placeholder>
    )
  }

  // No follow button on your own profile — you can't follow yourself
  // (the backend rejects it too, see app/follow/router.py).
  const isOwnProfile = !!me && String(me.id) === id

  return (
    <List>
      <Section header={profile.display_name}>
        <Cell subtitle={t('account.username')}>{profile.username ?? '—'}</Cell>
        <Cell subtitle={t('profilePage.bio')}>{profile.bio ?? '—'}</Cell>
      </Section>
      <Section>
        <Cell onClick={() => navigate(`/profiles/${id}/followers`)}>
          {t('profilePage.followersCount', { count: profile.followers_count })}
        </Cell>
        <Cell onClick={() => navigate(`/profiles/${id}/following`)}>
          {t('profilePage.followingCount', { count: profile.following_count })}
        </Cell>
      </Section>
      {!isOwnProfile && (
        <Section>
          <Cell>
            {profile.follow_status === 'accepted' ? (
              <Button stretched mode="outline" loading={following} onClick={unfollow}>
                {t('profilePage.following')}
              </Button>
            ) : profile.follow_status === 'pending' ? (
              <Button stretched mode="outline" disabled>
                {t('profilePage.requested')}
              </Button>
            ) : (
              <Button stretched loading={following} onClick={follow}>
                {t('profilePage.follow')}
              </Button>
            )}
          </Cell>
        </Section>
      )}
    </List>
  )
}
