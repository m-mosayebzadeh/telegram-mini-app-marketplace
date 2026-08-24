import { useEffect, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { Placeholder, Spinner } from '@telegram-apps/telegram-ui'
import { ApiError } from '../lib/api'
import {
  deleteContent,
  fetchContentFileBlobUrl,
  getContent,
  likeContent,
  pinContent,
  purchaseContent,
  unlikeContent,
  unpinContent,
} from '../lib/contentApi'
import { useMe } from '../lib/MeContext'
import type { Content } from '../lib/types'

/**
 * Full view of one content item, reached by tapping a tile in
 * components/ContentGrid.tsx. Handles every state a spoiler-gated item
 * can be in: locked (free tap-to-reveal or paid unlock), unlocked, and
 * (for the owner) pin/unpin + delete.
 *
 * The locked state (see .hp-detail-lock in styles/theme.css) is
 * deliberately styled as a soft, animated gradient blur rather than a
 * flat "denied" overlay — this is the one moment in the app whose whole
 * job is to make paying to unlock feel inviting, not punitive. It's
 * still a generic cover, never the real file: nothing here changes the
 * access rule that an unauthorized viewer is never sent the actual
 * bytes (see app/content/access.py).
 */
export default function ContentDetail() {
  const { t } = useTranslation()
  const { id } = useParams()
  const navigate = useNavigate()
  const { me } = useMe()
  const [content, setContent] = useState<Content | null>(null)
  const [fileUrl, setFileUrl] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [message, setMessage] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  // Whether THIS view has already revealed the file (tapped past the
  // spoiler cover). Kept separate from can_see_original: a free spoiler
  // item is always eligible to view (can_see_original is true — see
  // backend/app/content/access.py), but per TECHNICAL_REQUIREMENTS.md
  // it still shows the cover by default every time, and only fetches
  // the real bytes after an explicit tap — never automatically, even
  // for something already free/purchased.
  const [revealed, setRevealed] = useState(false)

  function load() {
    if (!id) return
    getContent(Number(id))
      .then((loaded) => {
        setContent(loaded)
        if (!loaded.has_spoiler) setRevealed(true)
      })
      .catch((err) => setError(err instanceof ApiError ? JSON.stringify(err.body) : String(err)))
  }

  // A fresh item id means a fresh spoiler state — reset on navigation
  // between two different content items, not on every content update
  // (e.g. liking shouldn't re-hide something already revealed).
  useEffect(() => {
    setRevealed(false)
    load()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id])

  // Loads the real file only once actually revealed in this view.
  useEffect(() => {
    if (!content || !revealed) {
      setFileUrl(null)
      return
    }
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
  }, [content, revealed])

  async function reveal() {
    if (!content) return
    // Only a paid item not yet owned needs an actual purchase — a free
    // spoiler is already eligible (can_see_original is true), tapping
    // it just lifts the cover locally, no charge involved.
    if (content.is_paid && !content.can_see_original) {
      setBusy(true)
      try {
        await purchaseContent(content.id)
        setMessage(t('content.purchaseSuccess'))
        load()
        setRevealed(true)
      } catch (err) {
        if (err instanceof ApiError && err.status === 402) {
          setMessage(t('content.insufficientBalance'))
        } else {
          setError(err instanceof ApiError ? JSON.stringify(err.body) : String(err))
        }
      } finally {
        setBusy(false)
      }
      return
    }
    setRevealed(true)
  }

  async function toggleLike() {
    if (!content) return
    setBusy(true)
    try {
      const updated = content.liked_by_me ? await unlikeContent(content.id) : await likeContent(content.id)
      setContent(updated)
    } catch (err) {
      setError(err instanceof ApiError ? JSON.stringify(err.body) : String(err))
    } finally {
      setBusy(false)
    }
  }

  async function togglePin() {
    if (!content) return
    setBusy(true)
    try {
      const updated = content.is_pinned ? await unpinContent(content.id) : await pinContent(content.id)
      setContent(updated)
    } catch (err) {
      if (err instanceof ApiError && err.status === 400) {
        setMessage(t('content.pinLimitReached', { max: 3 }))
      } else {
        setError(err instanceof ApiError ? JSON.stringify(err.body) : String(err))
      }
    } finally {
      setBusy(false)
    }
  }

  async function remove() {
    if (!content) return
    if (!window.confirm(t('content.deleteConfirm'))) return
    setBusy(true)
    try {
      await deleteContent(content.id)
      navigate(-1)
    } catch (err) {
      setError(err instanceof ApiError ? JSON.stringify(err.body) : String(err))
      setBusy(false)
    }
  }

  if (error) return <Placeholder header={t('common.error')}>{error}</Placeholder>
  if (!content) {
    return (
      <Placeholder>
        <Spinner size="l" />
      </Placeholder>
    )
  }

  const isOwner = !!me && me.id === content.user_id
  const locked = !revealed
  // Only an unpurchased paid item actually needs a real charge — every
  // other locked case (a free spoiler, or a paid one already owned) is
  // just a cover waiting for a tap, not a payment.
  const needsPurchase = content.is_paid && !content.can_see_original

  return (
    <div className="hp-page" style={{ padding: '14px' }}>
      <div className="hp-detail-hero">
        {!locked && fileUrl && content.content_type === 'photo' && (
          <img className="hp-detail-media" src={fileUrl} alt="" />
        )}
        {!locked && fileUrl && content.content_type === 'short_video' && (
          <video className="hp-detail-media" src={fileUrl} controls playsInline />
        )}

        {locked && (
          <div className="hp-detail-lock">
            <span className="hp-detail-lock-icon">🔒</span>
            <p className="hp-detail-lock-copy">{t('content.lockedTeaser')}</p>
            <button className="hp-btn hp-btn-gradient" style={{ flex: 'none', padding: '13px 28px' }} disabled={busy} onClick={reveal}>
              {needsPurchase
                ? t('content.lockedPayToUnlock', { price: content.price_stars })
                : t('content.lockedTapToUnlock')}
            </button>
          </div>
        )}
      </div>

      {message && <p className="hp-hint" style={{ textAlign: 'center', marginTop: 12 }}>{message}</p>}

      <div className="hp-icon-row">
        <button
          className={`hp-icon-btn ${content.liked_by_me ? 'hp-icon-btn-active' : ''}`}
          onClick={toggleLike}
          disabled={busy}
        >
          <span>{content.liked_by_me ? '❤️' : '🤍'}</span>
          <span>{t('content.likeCount', { count: content.like_count })}</span>
        </button>
        {isOwner && (
          <button
            className={`hp-icon-btn ${content.is_pinned ? 'hp-icon-btn-active' : ''}`}
            onClick={togglePin}
            disabled={busy}
          >
            📌 {content.is_pinned ? t('content.unpinButton') : t('content.pinButton')}
          </button>
        )}
      </div>

      {isOwner && (
        <div className="hp-icon-row">
          <button className="hp-icon-btn" onClick={remove} disabled={busy}>
            🗑 {t('content.deleteButton')}
          </button>
        </div>
      )}
    </div>
  )
}
