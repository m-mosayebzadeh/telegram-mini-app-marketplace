import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { Placeholder, Spinner } from '@telegram-apps/telegram-ui'
import { listContent } from '../lib/contentApi'
import { ContentTile } from './ContentTile'
import type { Content } from '../lib/types'

interface ContentGridProps {
  userId: number
  // Bumped by the parent (e.g. after an upload or a pin/unpin) to force
  // a reload — simpler than each mutation reaching back into this
  // component's own state.
  refreshKey?: number
}

/**
 * The 3-column content grid on a profile's Content tab. Ordering
 * (pinned items first, then newest) is entirely the backend's job — see
 * list_content() in backend/app/content/router.py — this component just
 * renders whatever order it gets back.
 */
export function ContentGrid({ userId, refreshKey }: ContentGridProps) {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const [items, setItems] = useState<Content[] | null>(null)

  useEffect(() => {
    setItems(null)
    listContent(userId).then(setItems)
  }, [userId, refreshKey])

  if (items === null) {
    return (
      <Placeholder>
        <Spinner size="m" />
      </Placeholder>
    )
  }

  if (items.length === 0) {
    return <div className="hp-empty">{t('profilePage.contentEmpty')}</div>
  }

  return (
    <div className="hp-grid">
      {items.map((item) => (
        <ContentTile key={item.id} content={item} onClick={() => navigate(`/content/${item.id}`)} />
      ))}
    </div>
  )
}
