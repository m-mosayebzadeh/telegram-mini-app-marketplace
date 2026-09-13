import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { formatElapsedTime } from '../../lib/chatTime'
import { AttachmentPreviewSheet } from './AttachmentPreviewSheet'
import { IconCheck, IconMic, IconPaperclip, IconSend, IconTrash } from '../icons'

interface ComposerProps {
  /** True once the session is closed — a closed session's conversation
   * is read-only (spec: closing leads to a read-only, not deleted,
   * conversation), so the whole composer is replaced with a notice. */
  disabled: boolean
  onSendText: (text: string) => void
  onSendPhoto: (mediaUrl: string, file: File) => void
  onSendVideo: (mediaUrl: string, file: File, durationSeconds: number) => void
  onSendVoice: (durationSeconds: number) => void
}

type PendingAttachment = { kind: 'photo' | 'video'; file: File; previewUrl: string }

/**
 * The message-composer row: a text field that swaps its trailing button
 * between attach/mic (empty) and send (non-empty text), plus a
 * simulated voice-recording mode. Only text/photo/video/voice can ever
 * be produced here — there is deliberately no generic "attach any file"
 * control (spec: message types are limited to these four).
 *
 * Voice recording is SIMULATED (no real microphone access) — pressing
 * the mic button starts a visible timer, per TECHNICAL_REQUIREMENTS.md
 * section 12's note that real audio capture is out of scope for this
 * pass; what gets "sent" is just that elapsed duration.
 */
export function Composer({ disabled, onSendText, onSendPhoto, onSendVideo, onSendVoice }: ComposerProps) {
  const { t } = useTranslation()
  const [text, setText] = useState('')
  const [pendingAttachment, setPendingAttachment] = useState<PendingAttachment | null>(null)
  const [recordingStartedAt, setRecordingStartedAt] = useState<string | null>(null)
  const [now, setNow] = useState(() => new Date())
  const fileInputRef = useRef<HTMLInputElement>(null)

  // Ticks the recording timer once a second, exactly like ChatHeader's
  // own elapsed-time clock — only running while actually recording.
  useEffect(() => {
    if (!recordingStartedAt) return
    const interval = setInterval(() => setNow(new Date()), 1000)
    return () => clearInterval(interval)
  }, [recordingStartedAt])

  // The previously-picked attachment's object URL must be revoked once
  // it's no longer needed for a live preview — but ONLY if the
  // attachment was cancelled, not sent (a sent message still needs its
  // media_url to keep working in the message list). See handleCancelAttachment.
  useEffect(() => {
    return () => {
      if (pendingAttachment) URL.revokeObjectURL(pendingAttachment.previewUrl)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- cleanup-only, must not re-run on every pendingAttachment change
  }, [])

  if (disabled) {
    return <div className="cp cp-readonly">{t('chatSession.readOnlyNotice')}</div>
  }

  function submitText() {
    const trimmed = text.trim()
    if (!trimmed) return
    onSendText(trimmed)
    setText('')
  }

  function pickFile(picked: File | null) {
    if (!picked) return
    const kind: 'photo' | 'video' = picked.type.startsWith('video/') ? 'video' : 'photo'
    setPendingAttachment({ kind, file: picked, previewUrl: URL.createObjectURL(picked) })
    if (fileInputRef.current) fileInputRef.current.value = ''
  }

  function cancelAttachment() {
    if (pendingAttachment) URL.revokeObjectURL(pendingAttachment.previewUrl)
    setPendingAttachment(null)
  }

  function confirmAttachment(durationSeconds?: number) {
    if (!pendingAttachment) return
    if (pendingAttachment.kind === 'photo') {
      onSendPhoto(pendingAttachment.previewUrl, pendingAttachment.file)
    } else {
      onSendVideo(pendingAttachment.previewUrl, pendingAttachment.file, durationSeconds ?? 0)
    }
    // Deliberately NOT revoking previewUrl here — it's now the sent
    // message's media_url and still needs to render in the message list.
    setPendingAttachment(null)
  }

  function startRecording() {
    setRecordingStartedAt(new Date().toISOString())
    setNow(new Date())
  }

  function cancelRecording() {
    setRecordingStartedAt(null)
  }

  function stopAndSendRecording() {
    if (!recordingStartedAt) return
    const elapsedSeconds = Math.max(1, Math.round((Date.now() - new Date(recordingStartedAt).getTime()) / 1000))
    setRecordingStartedAt(null)
    onSendVoice(elapsedSeconds)
  }

  if (recordingStartedAt) {
    return (
      <div className="cp">
        {/* Recording takes over the whole row: while it is running there
            is nothing else to do here, and leaving the text field in
            place would suggest otherwise. */}
        <button
          type="button"
          className="cp-btn cp-btn-danger"
          onClick={cancelRecording}
          aria-label={t('chatSession.recordingCancelLabel')}
        >
          <IconTrash size={20} />
        </button>

        <span className="cp-recording">
          <span className="cp-recording-dot" aria-hidden="true" />
          <span className="cp-recording-time tabular">
            {formatElapsedTime(recordingStartedAt, now)}
          </span>
        </span>

        <button
          type="button"
          className="cp-btn cp-btn-primary"
          onClick={stopAndSendRecording}
          aria-label={t('chatSession.recordingSendLabel')}
        >
          <IconCheck size={20} />
        </button>
      </div>
    )
  }

  return (
    <div className="cp">
      {/* Only photo and video: the product has exactly four message
          types and there is deliberately no generic file attachment. */}
      <label className="cp-btn" aria-label={t('chatSession.attachButtonLabel')}>
        <IconPaperclip size={20} />
        <input
          ref={fileInputRef}
          type="file"
          accept="image/*,video/*"
          hidden
          onChange={(e) => pickFile(e.target.files?.[0] ?? null)}
        />
      </label>

      <input
        className="cp-input"
        type="text"
        value={text}
        placeholder={t('chatSession.composerPlaceholder')}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') submitText()
        }}
      />

      {/* One trailing button that changes what it is: send when there is
          something to send, record when there is not. Two buttons would
          mean one of them is always the wrong one. */}
      {text.trim() ? (
        <button
          type="button"
          className="cp-btn cp-btn-primary"
          onClick={submitText}
          aria-label={t('chatSession.sendButtonLabel')}
        >
          <IconSend size={20} />
        </button>
      ) : (
        <button
          type="button"
          className="cp-btn"
          onClick={startRecording}
          aria-label={t('chatSession.micButtonLabel')}
        >
          <IconMic size={20} />
        </button>
      )}

      {pendingAttachment && (
        <AttachmentPreviewSheet
          kind={pendingAttachment.kind}
          previewUrl={pendingAttachment.previewUrl}
          onCancel={cancelAttachment}
          onConfirm={confirmAttachment}
        />
      )}
    </div>
  )
}
