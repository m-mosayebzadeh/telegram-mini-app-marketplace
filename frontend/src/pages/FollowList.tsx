import { useEffect, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { Cell, List, Placeholder, Section, Spinner } from '@telegram-apps/telegram-ui'
import { apiFetch, ApiError } from '../lib/api'
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
      .catch((err) => setError(err instanceof ApiError ? JSON.stringify(err.body) : String(err)))
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
    <List>
      <Section header={kind === 'followers' ? t('profilePage.followersTitle') : t('profilePage.followingTitle')}>
        {items.length === 0 && <Cell>{t('profilePage.followListEmpty')}</Cell>}
        {items.map((item) => (
          <Cell
            key={item.user_id}
            subtitle={item.username ?? undefined}
            onClick={() => navigate(`/profiles/${item.user_id}`)}
          >
            {item.display_name}
          </Cell>
        ))}
      </Section>
    </List>
  )
}
