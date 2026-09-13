import { useEffect } from 'react'
import { useTranslation } from 'react-i18next'
import { IconClose } from '../icons'

interface MediaViewerProps {
  url: string
  kind: 'photo' | 'video'
  onClose: () => void
}

/**
 * A photo or video, full screen.
 *
 * Sending a photo into a conversation and then only ever seeing it as a
 * 240px thumbnail is the kind of gap nobody reports as a bug — it just
 * makes the app feel unfinished. Tapping it opens it here.
 *
 * Deliberately plain: a dark ground, the media at its own aspect ratio,
 * and one way out. No zoom, no swipe between messages, no share — each
 * of those is a real feature with its own decisions, and a half-built
 * version of them would be worse than their absence.
 */
export function MediaViewer({ url, kind, onClose }: MediaViewerProps) {
  const { t } = useTranslation()

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKeyDown)
    // The conversation behind must not scroll under the viewer.
    const previous = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      window.removeEventListener('keydown', onKeyDown)
      document.body.style.overflow = previous
    }
  }, [onClose])

  return (
    <div className="mv" onClick={onClose} role="presentation">
      <button type="button" className="mv-close" aria-label={t('common.close')}>
        <IconClose size={22} />
      </button>

      {kind === 'video' ? (
        <video
          className="mv-media"
          src={url}
          controls
          autoPlay
          playsInline
          // A tap on the player is a tap on the player, not a dismissal.
          onClick={(event) => event.stopPropagation()}
        />
      ) : (
        <img className="mv-media" src={url} alt="" onClick={(event) => event.stopPropagation()} />
      )}
    </div>
  )
}
