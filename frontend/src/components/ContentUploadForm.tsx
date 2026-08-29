import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { formatApiError } from '../lib/api'
import { uploadContent } from '../lib/contentApi'
import { NumberField } from './NumberField'
import type { Content } from '../lib/types'

// Mirrors backend/app/models/content.py's MAX_VIDEO_DURATION_SECONDS —
// duplicated here (not fetched) since it's a fixed policy constant, the
// same way other phase-1 constants are duplicated on the frontend (see
// lib/priceBreakdown.ts's comment on split_commission()).
const MAX_VIDEO_DURATION_SECONDS = 60

interface ContentUploadFormProps {
  onUploaded: (content: Content) => void
}

/**
 * The upload form for a new content item — file, type, optional
 * duration (video only), paid/price, spoiler, and audience
 * (public/followers only here; a user- or group-targeted item is still
 * fully supported by the backend, just not exposed in this first cut of
 * the UI — see backend/app/content/router.py for the full set).
 *
 * The file picker is a <label htmlFor> wrapping a visually-hidden
 * <input type="file"> rather than a bare styled input — a browser's own
 * file input chrome renders with the OS's default (often
 * near-invisible against a dark theme) look that no CSS here can fully
 * override, which is what made the previous version of this form look
 * broken. A <label> click always forwards to its input even though the
 * input itself is invisible, so the visible custom dropzone below is
 * the real, reliably clickable control.
 */
export function ContentUploadForm({ onUploaded }: ContentUploadFormProps) {
  const { t } = useTranslation()
  const [file, setFile] = useState<File | null>(null)
  const [previewUrl, setPreviewUrl] = useState<string | null>(null)
  const [contentType, setContentType] = useState<'photo' | 'short_video'>('photo')
  const [durationSeconds, setDurationSeconds] = useState('')
  const [isPaid, setIsPaid] = useState(false)
  const [priceStars, setPriceStars] = useState('')
  const [hasSpoiler, setHasSpoiler] = useState(false)
  const [audienceType, setAudienceType] = useState<'public' | 'followers'>('public')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)

  // Revoke the previous object URL whenever it's replaced or this form
  // unmounts, so picking several files in a row (or closing the sheet)
  // never leaks memory.
  useEffect(() => {
    return () => {
      if (previewUrl) URL.revokeObjectURL(previewUrl)
    }
  }, [previewUrl])

  function pickFile(picked: File | null) {
    if (previewUrl) URL.revokeObjectURL(previewUrl)
    setFile(picked)
    setPreviewUrl(picked ? URL.createObjectURL(picked) : null)
    if (picked) {
      const inferredType = picked.type.startsWith('video/') ? 'short_video' : 'photo'
      setContentType(inferredType)
    }
  }

  async function submit() {
    if (!file) return
    setBusy(true)
    setError(null)
    try {
      const content = await uploadContent({
        file,
        contentType,
        durationSeconds: contentType === 'short_video' ? Number(durationSeconds) : undefined,
        isPaid,
        priceStars: isPaid ? Number(priceStars) : undefined,
        // Paid always implies a spoiler on the backend too (see
        // ck_paid_implies_spoiler) — reflecting that here just avoids a
        // pointless round trip when the checkbox was left unchecked.
        hasSpoiler: isPaid || hasSpoiler,
        audienceType,
      })
      onUploaded(content)
    } catch (err) {
      setError(formatApiError(err))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div>
      <div className="hp-field">
        <label
          className="hp-dropzone"
          onClick={() => fileInputRef.current?.click()}
          style={previewUrl ? { padding: 0 } : undefined}
        >
          {previewUrl ? (
            <>
              {contentType === 'photo' ? (
                <img className="hp-dropzone-preview" src={previewUrl} alt="" />
              ) : (
                <video className="hp-dropzone-preview" src={previewUrl} muted playsInline />
              )}
              <span className="hp-dropzone-preview-overlay">{t('content.changeFile')}</span>
            </>
          ) : (
            <>
              <span style={{ fontSize: 26 }}>📷</span>
              <span>{t('content.chooseFile')}</span>
            </>
          )}
          <input
            ref={fileInputRef}
            type="file"
            accept="image/*,video/*"
            onChange={(e) => pickFile(e.target.files?.[0] ?? null)}
            style={{ position: 'absolute', width: 1, height: 1, opacity: 0, pointerEvents: 'none' }}
          />
        </label>
      </div>

      <div className="hp-field">
        <span className="hp-field-label">{t('content.typeLabel')}</span>
        <div className="hp-segmented">
          <button
            type="button"
            className={`hp-segmented-btn ${contentType === 'photo' ? 'hp-segmented-active' : ''}`}
            onClick={() => setContentType('photo')}
          >
            {t('content.typePhoto')}
          </button>
          <button
            type="button"
            className={`hp-segmented-btn ${contentType === 'short_video' ? 'hp-segmented-active' : ''}`}
            onClick={() => setContentType('short_video')}
          >
            {t('content.typeShortVideo')}
          </button>
        </div>
      </div>

      {contentType === 'short_video' && (
        <div className="hp-field">
          <NumberField
            header={t('content.durationLabel', { max: MAX_VIDEO_DURATION_SECONDS })}
            value={durationSeconds}
            onChange={setDurationSeconds}
          />
        </div>
      )}

      <div className="hp-switch-row">
        <span>{t('content.isPaidLabel')}</span>
        <input type="checkbox" checked={isPaid} onChange={(e) => setIsPaid(e.target.checked)} />
      </div>
      {isPaid && (
        <div className="hp-field">
          <NumberField header={t('content.priceLabel')} value={priceStars} onChange={setPriceStars} />
        </div>
      )}
      {!isPaid && (
        <div className="hp-switch-row">
          <span>{t('content.hasSpoilerLabel')}</span>
          <input type="checkbox" checked={hasSpoiler} onChange={(e) => setHasSpoiler(e.target.checked)} />
        </div>
      )}

      <div className="hp-field">
        <span className="hp-field-label">{t('content.audienceLabel')}</span>
        <div className="hp-segmented">
          <button
            type="button"
            className={`hp-segmented-btn ${audienceType === 'public' ? 'hp-segmented-active' : ''}`}
            onClick={() => setAudienceType('public')}
          >
            {t('content.audiencePublic')}
          </button>
          <button
            type="button"
            className={`hp-segmented-btn ${audienceType === 'followers' ? 'hp-segmented-active' : ''}`}
            onClick={() => setAudienceType('followers')}
          >
            {t('content.audienceFollowers')}
          </button>
        </div>
      </div>

      {error && <p className="hp-error">{error}</p>}

      <div className="hp-field">
        <button className="hp-btn hp-btn-gradient" style={{ width: '100%' }} disabled={!file || busy} onClick={submit}>
          {busy ? t('common.loading') : t('content.uploadSubmit')}
        </button>
        {!file && <p className="hp-hint">{t('content.chooseFile')}</p>}
      </div>
    </div>
  )
}
