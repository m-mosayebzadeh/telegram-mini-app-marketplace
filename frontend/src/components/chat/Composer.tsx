import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { formatElapsedTime } from '../../lib/chatTime'
import { AttachmentPreviewSheet } from './AttachmentPreviewSheet'

interface ComposerProps {
  /** True once the session is closed — a closed session's conversation
   * is read-only (spec: closing leads to a read-only, not deleted,
   * conversation), so the whole composer is replaced with a notice. */
  disabled: boolean
  onSendText: (text: string) => void
  onSendPhoto: (mediaUrl: string) => void
  onSendVideo: (mediaUrl: string, durationSeconds: number) => void
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
    return <div className="hp-chat-composer hp-chat-composer-readonly">{t('chatSession.readOnlyNotice')}</div>
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
      onSendPhoto(pendingAttachment.previewUrl)
    } else {
      onSendVideo(pendingAttachment.previewUrl, durationSeconds ?? 0)
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
      <div className="hp-chat-composer">
        <div className="hp-chat-recording-row">
          <button className="hp-chat-recording-cancel" onClick={cancelRecording} aria-label={t('chatSession.recordingCancelLabel')}>
            🗑
          </button>
          <span className="hp-chat-recording-dot" aria-hidden="true" />
          <span className="hp-chat-recording-time">{formatElapsedTime(recordingStartedAt, now)}</span>
          <button className="hp-chat-recording-send" onClick={stopAndSendRecording} aria-label={t('chatSession.recordingSendLabel')}>
            ✓
          </button>
        </div>
      </div>
    )
  }

  return (
    <div className="hp-chat-composer">
      <label className="hp-chat-attach-btn" aria-label={t('chatSession.attachButtonLabel')}>
        📎
        <input
          ref={fileInputRef}
          type="file"
          accept="image/*,video/*"
          onChange={(e) => pickFile(e.target.files?.[0] ?? null)}
          style={{ position: 'absolute', width: 1, height: 1, opacity: 0, pointerEvents: 'none' }}
        />
      </label>

      <input
        className="hp-chat-text-input"
        type="text"
        value={text}
        placeholder={t('chatSession.composerPlaceholder')}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') submitText()
        }}
      />

      {text.trim() ? (
        <button className="hp-chat-send-btn" onClick={submitText} aria-label={t('chatSession.sendButtonLabel')}>
          ➤
        </button>
      ) : (
        <button className="hp-chat-mic-btn" onClick={startRecording} aria-label={t('chatSession.micButtonLabel')}>
          🎤
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
