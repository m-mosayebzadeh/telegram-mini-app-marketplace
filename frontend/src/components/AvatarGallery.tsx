import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { apiFetch, formatApiError } from '../lib/api'
import type { ProfilePhoto } from '../lib/types'
import { IconDownload, IconTrash } from './icons'

interface AvatarGalleryProps {
  userId: number
  isOwn: boolean
  onClose: () => void
  // Called after a photo is deleted, so the parent can reload `profile`
  // (its avatar_url is always just the newest remaining photo).
  onChanged: () => void
}

/**
 * The fullscreen photo viewer opened by tapping a profile's avatar ring
 * (see ProfileHeader.tsx) — every photo that user has ever uploaded
 * (GET /profiles/{id}/photos, newest first), swiped through with a
 * finger the way Telegram's own profile photo viewer works. Delete
 * (own profile only) and download live as two icon buttons in the
 * top-end corner, matching the reference screenshots this was built
 * from, instead of Telegram's own ⋯ menu.
 */
export function AvatarGallery({ userId, isOwn, onClose, onChanged }: AvatarGalleryProps) {
  const { t } = useTranslation()
  const [photos, setPhotos] = useState<ProfilePhoto[] | null>(null)
  const [index, setIndex] = useState(0)
  const [confirmDelete, setConfirmDelete] = useState(false)
  const [toast, setToast] = useState<string | null>(null)
  const touchStartX = useRef<number | null>(null)

  useEffect(() => {
    apiFetch<ProfilePhoto[]>(`/profiles/${userId}/photos`).then(setPhotos)
  }, [userId])

  useEffect(() => {
    if (!toast) return
    const timer = setTimeout(() => setToast(null), 2200)
    return () => clearTimeout(timer)
  }, [toast])

  function goTo(nextIndex: number) {
    if (!photos) return
    setIndex(Math.max(0, Math.min(photos.length - 1, nextIndex)))
  }

  function onTouchStart(e: React.TouchEvent) {
    touchStartX.current = e.touches[0].clientX
  }

  function onTouchEnd(e: React.TouchEvent) {
    if (touchStartX.current == null) return
    const delta = e.changedTouches[0].clientX - touchStartX.current
    touchStartX.current = null
    // A short tap shouldn't count as a swipe — only a real, deliberate
    // drag (40px+) changes photos.
    if (Math.abs(delta) < 40) return
    // RTL-safe by construction: this just moves toward whichever finger
    // direction the swipe went, not a hardcoded "left = next".
    goTo(delta < 0 ? index + 1 : index - 1)
  }

  async function download(photo: ProfilePhoto) {
    try {
      const response = await fetch(photo.url)
      const blob = await response.blob()
      const blobUrl = URL.createObjectURL(blob)
      const link = document.createElement('a')
      link.href = blobUrl
      link.download = `photo-${photo.id}.jpg`
      link.click()
      URL.revokeObjectURL(blobUrl)
      setToast(t('profilePage.photoSaved'))
    } catch {
      // Best-effort — a failed download just means no toast, nothing
      // else in this view depends on it succeeding.
    }
  }

  async function confirmAndDelete(photo: ProfilePhoto) {
    try {
      await apiFetch(`/profile/me/photos/${photo.id}`, { method: 'DELETE' })
      setConfirmDelete(false)
      onChanged()
      const remaining = (photos ?? []).filter((p) => p.id !== photo.id)
      if (remaining.length === 0) {
        onClose()
        return
      }
      setPhotos(remaining)
      goTo(Math.min(index, remaining.length - 1))
    } catch (err) {
      setConfirmDelete(false)
      setToast(formatApiError(err))
    }
  }

  if (photos === null) return null
  if (photos.length === 0) {
    onClose()
    return null
  }

  const current = photos[index]

  return (
    <div className="hp-avatar-preview-backdrop" onClick={onClose}>
      <div onClick={(e) => e.stopPropagation()} onTouchStart={onTouchStart} onTouchEnd={onTouchEnd}>
        <button className="hp-avatar-preview-close" aria-label={t('common.close')} onClick={onClose}>
          ✕
        </button>
        <div className="hp-avatar-preview-actions">
          <button
            className="hp-avatar-preview-action-btn"
            aria-label="download"
            onClick={() => download(current)}
          >
            <IconDownload size={19} />
          </button>
          {isOwn && (
            <button
              className="hp-avatar-preview-action-btn"
              aria-label="delete"
              onClick={() => setConfirmDelete(true)}
            >
              <IconTrash size={19} />
            </button>
          )}
        </div>

        <img className="hp-avatar-preview-img" src={current.url} alt="" />

        {photos.length > 1 && (
          <div className="hp-avatar-preview-dots">
            {photos.map((p, i) => (
              <span key={p.id} className={`hp-avatar-preview-dot ${i === index ? 'hp-avatar-preview-dot-active' : ''}`} />
            ))}
          </div>
        )}
      </div>

      {confirmDelete && (
        <div className="hp-confirm-backdrop" onClick={(e) => e.stopPropagation()}>
          <div className="hp-confirm-box">
            <p className="hp-confirm-title">{t('profilePage.deletePhotoTitle')}</p>
            <p className="hp-confirm-message">{t('profilePage.deletePhotoConfirm')}</p>
            <div className="hp-confirm-actions">
              <button className="hp-confirm-btn" onClick={() => setConfirmDelete(false)}>
                {t('common.cancel')}
              </button>
              <button className="hp-confirm-btn hp-confirm-btn-danger" onClick={() => confirmAndDelete(current)}>
                {t('content.deleteButton')}
              </button>
            </div>
          </div>
        </div>
      )}

      {toast && <div className="hp-toast">{toast}</div>}
    </div>
  )
}
