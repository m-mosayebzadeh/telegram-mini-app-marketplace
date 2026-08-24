import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { fetchContentFileBlobUrl } from '../lib/contentApi'
import type { Content } from '../lib/types'

interface ContentTileProps {
  content: Content
  onClick: () => void
}

/**
 * One square cell in the profile's content grid (see
 * components/ContentGrid.tsx). Shows the real file only for an item
 * with NO spoiler at all — a spoilered item (free or paid) always shows
 * the generic cover here, even for its own owner or someone who already
 * paid, and only actually loads the real bytes in the full detail view
 * (pages/ContentDetail.tsx) after an explicit tap. This matches
 * TECHNICAL_REQUIREMENTS.md's rule that a spoiler's default display is
 * always the cover, never lifted automatically or from a past view —
 * and it also means a grid full of spoilered items never fetches N
 * files just to render N locked thumbnails.
 */
export function ContentTile({ content, onClick }: ContentTileProps) {
  const { t } = useTranslation()
  const [fileUrl, setFileUrl] = useState<string | null>(null)

  useEffect(() => {
    if (content.has_spoiler) return
    let cancelled = false
    let objectUrl: string | null = null
    fetchContentFileBlobUrl(content.id).then((url) => {
      if (cancelled) {
        URL.revokeObjectURL(url)
        return
      }
      objectUrl = url
      setFileUrl(url)
    })
    return () => {
      cancelled = true
      if (objectUrl) URL.revokeObjectURL(objectUrl)
    }
  }, [content.id, content.has_spoiler])

  const locked = content.has_spoiler

  return (
    <button className="hp-tile" onClick={onClick}>
      {!locked && fileUrl && content.content_type === 'photo' && (
        <img className="hp-tile-media" src={fileUrl} alt="" />
      )}
      {!locked && fileUrl && content.content_type === 'short_video' && (
        <video className="hp-tile-media" src={fileUrl} muted playsInline preload="metadata" />
      )}

      {locked && (
        <div className="hp-tile-lock">
          <span className="hp-tile-lock-icon">🔒</span>
        </div>
      )}

      {content.content_type === 'short_video' && (
        <span className="hp-tile-badge hp-tile-badge-end" aria-label={t('content.videoBadge')}>
          ▶
        </span>
      )}

      {content.is_pinned && <span className="hp-tile-badge hp-tile-badge-start">📌</span>}

      {content.like_count > 0 && (
        <span className="hp-tile-likes">
          <span>♥</span>
          <span>{content.like_count}</span>
        </span>
      )}

      {locked && content.is_paid && content.price_stars != null && (
        <span className="hp-tile-price">⭐ {content.price_stars}</span>
      )}
    </button>
  )
}
