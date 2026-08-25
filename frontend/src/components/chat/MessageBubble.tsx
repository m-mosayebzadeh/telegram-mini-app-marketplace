import { useTranslation } from 'react-i18next'
import type { ChatMessage } from '../../lib/chatMessageTypes'

interface MessageBubbleProps {
  message: ChatMessage
  /** Whether this message's sender is the current viewer — decides
   * which side of the conversation it renders on, and whether a
   * delivery-status indicator is shown at all (only your own messages
   * show one, the same as any real chat app). */
  isMine: boolean
  onRetry: (message: ChatMessage) => void
}

/**
 * One message bubble — text, photo, video, or voice, per the spec's
 * "only these four message types" rule (no arbitrary file uploads).
 * Renders the delivery-state indicator (sending/sent/failed, with a
 * retry affordance on failure) for the viewer's own messages.
 *
 * The photo/video/voice bodies here are intentionally simple (an image,
 * or an icon + duration) rather than a full lightbox/player — this is
 * the mock-data phase (TECHNICAL_REQUIREMENTS.md section 12); richer
 * media viewing can be layered on once real attachments exist.
 */
export function MessageBubble({ message, isMine, onRetry }: MessageBubbleProps) {
  const { t } = useTranslation()

  const bubbleClass = `hp-bubble ${isMine ? 'hp-bubble-mine' : 'hp-bubble-theirs'}`
  const time = new Date(message.created_at).toLocaleTimeString(undefined, {
    hour: '2-digit',
    minute: '2-digit',
  })

  return (
    <div className={bubbleClass}>
      {message.type === 'text' && <p className="hp-bubble-text">{message.text}</p>}

      {message.type === 'photo' && (
        <img className="hp-bubble-media" src={message.media_url ?? undefined} alt="" />
      )}

      {message.type === 'video' && (
        <div className="hp-bubble-video">
          <span className="hp-bubble-video-icon">▶</span>
          <span>{message.duration_seconds}s</span>
        </div>
      )}

      {message.type === 'voice' && (
        <div className="hp-bubble-voice">
          <span className="hp-bubble-voice-icon">🎤</span>
          <span className="hp-bubble-voice-wave" aria-hidden="true" />
          <span className="hp-bubble-voice-duration">{message.duration_seconds}s</span>
        </div>
      )}

      <div className="hp-bubble-footer">
        <span className="hp-bubble-time">{time}</span>
        {isMine && (
          <span className={`hp-bubble-status hp-bubble-status-${message.status}`}>
            {message.status === 'sending' && '⏳'}
            {message.status === 'sent' && '✓'}
            {message.status === 'failed' && (
              <button className="hp-bubble-retry" onClick={() => onRetry(message)}>
                ⚠ {t('chatSession.retryButton')}
              </button>
            )}
          </span>
        )}
      </div>
    </div>
  )
}
