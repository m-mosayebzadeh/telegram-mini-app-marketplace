import { useEffect, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { ApiError, formatApiError } from '../lib/api'
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
import {
  PageHeader,
  Button,
  ConfirmDialog,
  ErrorState,
  useToast,
} from '../components/ui'
import { IconDrop, IconHeart, IconLock, IconPin, IconTrash } from '../components/icons'
import type { Content } from '../lib/types'

/**
 * Full view of one content item, reached by tapping a tile in
 * components/ContentGrid.tsx. Handles every state a spoiler-gated item
 * can be in: locked (free tap-to-reveal or paid unlock), unlocked, and
 * (for the owner) pin/unpin + delete.
 *
 * The locked state (see .cd-lock in styles/components/content.css) is
 * the one moment in the app whose job is to make unlocking feel
 * inviting rather than punitive — but it does that with an inviting
 * OFFER, not with decoration: a surface, a mark, a line, and the button.
 * It is still a generic cover, never the real file; nothing here changes
 * the rule that an unauthorized viewer is never sent the actual bytes
 * (see app/content/access.py).
 */
export default function ContentDetail() {
  const { t } = useTranslation()
  const { id } = useParams()
  const navigate = useNavigate()
  const { me } = useMe()
  const toast = useToast()
  const [content, setContent] = useState<Content | null>(null)
  const [fileUrl, setFileUrl] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [deleting, setDeleting] = useState(false)
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
      .catch((err) => setError(formatApiError(err)))
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
        toast.success(t('content.purchaseSuccess'))
        load()
        setRevealed(true)
      } catch (err) {
        if (err instanceof ApiError && err.status === 402) {
          toast.error(t('content.insufficientBalance'))
        } else {
          setError(formatApiError(err))
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
      toast.error(formatApiError(err))
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
        toast.error(t('content.pinLimitReached', { max: 3 }))
      } else {
        toast.error(formatApiError(err))
      }
    } finally {
      setBusy(false)
    }
  }

  async function remove() {
    if (!content) return
    setBusy(true)
    try {
      await deleteContent(content.id)
      navigate(-1)
    } catch (err) {
      toast.error(formatApiError(err))
      setBusy(false)
      setDeleting(false)
    }
  }

  const isOwner = !!me && me.id === content?.user_id
  const locked = !revealed
  // Only an unpurchased paid item needs a real charge. Every other
  // locked case — a free spoiler, or a paid one already owned — is a
  // cover waiting for a tap, not a payment.
  const needsPurchase = !!content?.is_paid && !content?.can_see_original

  if (error || !content) {
    return (
      <div className="ui-page">
        <PageHeader title={t('content.title')} onBack={() => navigate(-1)} />
        <div className="ui-page-body">
          {error ? <ErrorState text={error} onRetry={load} /> : <div className="ui-skeleton cd-skeleton" />}
        </div>
      </div>
    )
  }

  return (
    <div className="ui-page">
      <PageHeader
        title={t('content.title')}
        onBack={() => navigate(-1)}
        action={
          isOwner ? (
            <button
              className="ui-btn ui-btn-icon cd-delete"
              onClick={() => setDeleting(true)}
              disabled={busy}
              aria-label={t('content.deleteButton')}
            >
              <IconTrash size={20} />
            </button>
          ) : undefined
        }
      />

      <div className="ui-page-body">
        <div className="cd-media">
          {!locked && fileUrl && content.content_type === 'photo' && (
            <img src={fileUrl} alt="" />
          )}
          {!locked && fileUrl && content.content_type === 'short_video' && (
            <video src={fileUrl} controls playsInline />
          )}
          {/* Waiting on the file itself, with the frame already at its
              final size so nothing jumps when the bytes land. */}
          {!locked && !fileUrl && <div className="ui-skeleton cd-media-loading" />}

          {locked && (
            <div className="cd-lock">
              <span className="cd-lock-icon">
                <IconLock size={26} />
              </span>
              <p className="cd-lock-copy">{t('content.lockedTeaser')}</p>
              <Button variant="primary" size="md" loading={busy} onClick={reveal}>
                {needsPurchase ? (
                  <>
                    <IconDrop size={18} />
                    {t('content.lockedPayToUnlock', { price: content.price_stars })}
                  </>
                ) : (
                  t('content.lockedTapToUnlock')
                )}
              </Button>
            </div>
          )}
        </div>

        {/* Like and pin are the two things you can do TO this item, so
            they sit together under it. Delete is not among them — it is
            irreversible, and it belongs in the header, away from where
            the thumb naturally lands. */}
        <div className="cd-actions">
          <button
            type="button"
            className={`cd-action${content.liked_by_me ? ' cd-action-on' : ''}`}
            onClick={toggleLike}
            disabled={busy}
            aria-pressed={content.liked_by_me}
          >
            <IconHeart size={20} filled={content.liked_by_me} />
            <span className="tabular">
              {t('content.likeCount', { count: content.like_count })}
            </span>
          </button>

          {isOwner && (
            <button
              type="button"
              className={`cd-action${content.is_pinned ? ' cd-action-on' : ''}`}
              onClick={togglePin}
              disabled={busy}
              aria-pressed={content.is_pinned}
            >
              <IconPin size={20} filled={content.is_pinned} />
              {content.is_pinned ? t('content.unpinButton') : t('content.pinButton')}
            </button>
          )}
        </div>
      </div>

      {/* Deleting a photo cannot be undone, so it asks — and it used to
          ask through window.confirm, the browser's own dialog. */}
      {deleting && (
        <ConfirmDialog
          title={t('content.deleteButton')}
          text={t('content.deleteConfirm')}
          confirmLabel={t('content.deleteButton')}
          destructive
          loading={busy}
          onCancel={() => setDeleting(false)}
          onConfirm={remove}
        />
      )}
    </div>
  )
}
