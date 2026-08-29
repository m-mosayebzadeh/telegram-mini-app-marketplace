import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { fetchContentFileBlobUrl } from '../lib/contentApi'
import { IconPin } from './icons'
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
  // Paid content is always spoilered too (CHECK constraint on the
  // backend — see Content.has_spoiler's docstring), so "locked" alone
  // can't tell a free teaser apart from a priced unlock. This mirrors
  // the three grid states from the design pass exactly: free, spoiler
  // (mystery veil, no price), premium (mystery veil + gold badge).
  const premium = locked && content.is_paid && content.price_stars != null

  return (
    <button className="hp-tile" onClick={onClick}>
      {!locked && fileUrl && content.content_type === 'photo' && (
        <img className="hp-tile-media" src={fileUrl} alt="" />
      )}
      {!locked && fileUrl && content.content_type === 'short_video' && (
        <video className="hp-tile-media" src={fileUrl} muted playsInline preload="metadata" />
      )}
      {!locked && content.content_type === 'short_video' && (
        <div className="hp-tile-play-icon">
          <svg width="10" height="10" viewBox="0 0 24 24" fill="currentColor" stroke="none">
            <path d="M8 5l11 7-11 7V5z" />
          </svg>
        </div>
      )}

      {locked && (
        <div className={`hp-tile-veil ${premium ? 'hp-tile-veil-premium' : 'hp-tile-veil-spoiler'}`}>
          {premium ? (
            <div className="hp-tile-price-pill">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="var(--hp-gold)" stroke="none">
                <path d="M12 3.5l2.4 4.9 5.4.8-3.9 3.8.9 5.4-4.8-2.5-4.8 2.5.9-5.4-3.9-3.8 5.4-.8L12 3.5z" />
              </svg>
              <span>{content.price_stars}</span>
            </div>
          ) : (
            <svg width="16" height="16" viewBox="0 0 24 24" fill="rgba(255,255,255,0.85)" stroke="none">
              <path d="M12 3l1.7 6.8L20 11l-6.3 1.2L12 19l-1.7-6.8L4 11l6.3-1.2L12 3z" />
            </svg>
          )}
        </div>
      )}

      {/* Only shown for a LOCKED video — an unlocked one already gets its
          own play icon (hp-tile-play-icon above), so this would just be
          a duplicate. */}
      {locked && content.content_type === 'short_video' && (
        <span className="hp-tile-badge hp-tile-badge-end" aria-label={t('content.videoBadge')}>
          <svg width="12" height="12" viewBox="0 0 24 24" fill="#fff" stroke="none">
            <path d="M8 5l11 7-11 7V5z" />
          </svg>
        </span>
      )}

      {content.is_pinned && (
        <span className="hp-tile-badge hp-tile-badge-start" aria-label={t('content.pinnedBadge')}>
          <IconPin size={11} filled />
        </span>
      )}

      {content.like_count > 0 && (
        <span className="hp-tile-likes">
          <svg width="11" height="11" viewBox="0 0 24 24" fill="currentColor" stroke="none">
            <path d="M12 21s-7.5-4.6-10-9C.3 8.4 2 4 6.2 4c2 0 3.5 1.1 4.3 2.4C11.3 5.1 12.8 4 14.8 4 19 4 20.7 8.4 19 12c-2.5 4.4-10 9-10 9z" />
          </svg>
          <span>{content.like_count}</span>
        </span>
      )}
    </button>
  )
}
