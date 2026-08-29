import { useEffect, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { Placeholder, Spinner } from '@telegram-apps/telegram-ui'
import { apiFetch, formatApiError } from '../lib/api'
import type { FollowListItem } from '../lib/types'

/**
 * One component for both /profiles/:id/followers and
 * /profiles/:id/following — `kind` (from the route, see App.tsx) picks
 * which of the two nearly-identical backend endpoints to call
 * (GET /follow/{id}/followers or /following) and which title to show.
 */
export default function FollowList() {
  const { t } = useTranslation()
  const { id, kind } = useParams<{ id: string; kind: 'followers' | 'following' }>()
  const navigate = useNavigate()
  const [items, setItems] = useState<FollowListItem[] | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    setItems(null)
    apiFetch<FollowListItem[]>(`/follow/${id}/${kind}`)
      .then(setItems)
      .catch((err) => setError(formatApiError(err)))
  }, [id, kind])

  if (error) return <Placeholder header={t('common.error')}>{error}</Placeholder>
  if (!items) {
    return (
      <Placeholder>
        <Spinner size="l" />
      </Placeholder>
    )
  }

  return (
    <div className="hp-page">
      <div className="hp-page-header">
        {kind === 'followers' ? t('profilePage.followersTitle') : t('profilePage.followingTitle')}
      </div>

      {items.length === 0 ? (
        <p className="hp-empty">{t('profilePage.followListEmpty')}</p>
      ) : (
        <div className="hp-list">
          {items.map((item) => (
            <button key={item.user_id} className="hp-list-row" onClick={() => navigate(`/profiles/${item.user_id}`)}>
              <div className="hp-list-row-main">
                <span className="hp-list-title" dir="auto">
                  {item.display_name}
                </span>
                {item.username && <span className="hp-list-subtitle">@{item.username}</span>}
              </div>
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
