import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Sheet } from '../Sheet'
import { NumberField } from '../NumberField'

interface AttachmentPreviewSheetProps {
  /** 'photo' or 'video', inferred by the caller from the picked file's
   * MIME type — same inference ContentUploadForm.tsx already does for
   * the real content-upload flow. */
  kind: 'photo' | 'video'
  previewUrl: string
  onCancel: () => void
  /** Video needs a reported duration before it can be sent; photo
   * doesn't, so this is only ever called with a number for kind==='video'. */
  onConfirm: (durationSeconds?: number) => void
}

/**
 * The "preview before send" step for a picked photo/video attachment,
 * per the spec's explicit requirement that media isn't sent the instant
 * it's picked. Reuses the existing bottom-sheet modal (components/Sheet.tsx)
 * rather than a new modal primitive.
 *
 * A video's duration is self-reported by the sender (typed in here), the
 * same policy TECHNICAL_REQUIREMENTS.md already documents for real
 * content uploads (duration is a client-reported policy limit, not
 * something measured server-side) — this mock chat attachment follows
 * the identical rule rather than inventing a different one.
 */
export function AttachmentPreviewSheet({ kind, previewUrl, onCancel, onConfirm }: AttachmentPreviewSheetProps) {
  const { t } = useTranslation()
  const [durationSeconds, setDurationSeconds] = useState('')

  const canSend = kind === 'photo' || Number(durationSeconds) > 0

  return (
    <Sheet title={kind === 'photo' ? t('chatSession.attachPhotoTitle') : t('chatSession.attachVideoTitle')} onClose={onCancel}>
      <div className="hp-field">
        {kind === 'photo' ? (
          <img className="hp-dropzone-preview" style={{ position: 'static', borderRadius: 18 }} src={previewUrl} alt="" />
        ) : (
          <video
            className="hp-dropzone-preview"
            style={{ position: 'static', borderRadius: 18 }}
            src={previewUrl}
            controls
            muted
            playsInline
          />
        )}
      </div>

      {kind === 'video' && (
        <div className="hp-field">
          <NumberField header={t('chatSession.videoDurationLabel')} value={durationSeconds} onChange={setDurationSeconds} />
        </div>
      )}

      <div className="hp-actions-row">
        <button className="hp-btn hp-btn-outline hp-btn-wide" onClick={onCancel}>
          {t('chatSession.attachCancelButton')}
        </button>
        <button
          className="hp-btn hp-btn-gradient"
          disabled={!canSend}
          onClick={() => onConfirm(kind === 'video' ? Number(durationSeconds) : undefined)}
        >
          {t('chatSession.attachSendButton')}
        </button>
      </div>
    </Sheet>
  )
}
