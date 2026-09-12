import { useEffect, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { apiFetch, formatApiError } from '../lib/api'
import { PageHeader, EmptyState, ErrorState, SkeletonRows } from '../components/ui'
import { IconChevron, IconPersonFallback, IconUsers } from '../components/icons'
import type { FollowListItem } from '../lib/types'

/**
 * One component for both /profiles/:id/followers and
 * /profiles/:id/following — `kind` picks which of the two
 * nearly-identical endpoints to call and which title to show.
 */
export default function FollowList() {
  const { t } = useTranslation()
  const { id, kind } = useParams<{ id: string; kind: 'followers' | 'following' }>()
  const navigate = useNavigate()
  const [items, setItems] = useState<FollowListItem[] | null>(null)
  const [error, setError] = useState<string | null>(null)

  function load() {
    setItems(null)
    setError(null)
    apiFetch<FollowListItem[]>(`/follow/${id}/${kind}`)
      .then(setItems)
      .catch((err) => setError(formatApiError(err)))
  }

  useEffect(load, [id, kind])

  return (
    <div className="ui-page">
      <PageHeader
        title={kind === 'followers' ? t('profilePage.followersTitle') : t('profilePage.followingTitle')}
        onBack={() => navigate(-1)}
      />

      <div className="ui-page-body">
        {error ? (
          <ErrorState text={error} onRetry={load} />
        ) : items === null ? (
          <SkeletonRows count={5} />
        ) : items.length === 0 ? (
          <EmptyState
            icon={<IconUsers size={24} />}
            title={t('profilePage.followListEmpty')}
            text={
              kind === 'followers'
                ? t('profilePage.followersEmptyHint')
                : t('profilePage.followingEmptyHint')
            }
          />
        ) : (
          <div className="ui-list">
            {items.map((item) => (
              <button
                type="button"
                className="ui-row ui-row-avatar"
                key={item.user_id}
                onClick={() => navigate(`/profiles/${item.user_id}`)}
              >
                <span className="ui-row-media fl-avatar">
                  {item.avatar_url ? (
                    <img src={item.avatar_url} alt="" />
                  ) : (
                    <IconPersonFallback size={22} />
                  )}
                </span>
                <span className="ui-row-main">
                  <span className="ui-row-title" dir="auto">
                    {item.display_name}
                  </span>
                  {item.username && <span className="ui-row-subtitle">@{item.username}</span>}
                </span>
                <span className="ui-row-trailing">
                  <IconChevron size={20} className="ui-row-chevron" />
                </span>
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
