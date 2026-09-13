import { useTranslation } from 'react-i18next'
import { IconAlert, IconCheck, IconMic, IconPlay } from '../icons'
import type { ChatMessage } from '../../lib/chatMessageTypes'

interface MessageBubbleProps {
  message: ChatMessage
  /** Whether the sender is the viewer — decides which side it renders on
   *  and whether a delivery state is shown at all. Only your own
   *  messages carry one, the same as any real chat app. */
  isMine: boolean
  onRetry: (message: ChatMessage) => void
}

/**
 * One message: text, photo, video or voice — the product's four types,
 * with no generic file attachment.
 *
 * Rebuilt on the design system. Every glyph here used to be a text
 * character — ▶ 🎤 ⏳ ✓ ⚠ — which takes no stroke width, no size and no
 * alignment from anything around it, and renders differently on every
 * platform. They are icons from the one set now.
 *
 * The delivery state is deliberately quiet. "Sent" is the ordinary
 * outcome and gets a hairline tick; only a FAILURE earns colour, and it
 * earns a tappable retry rather than just a warning sign.
 */
export function MessageBubble({ message, isMine, onRetry }: MessageBubbleProps) {
  const { t } = useTranslation()

  const time = new Date(message.created_at).toLocaleTimeString(undefined, {
    hour: '2-digit',
    minute: '2-digit',
  })

  return (
    <div className={`cm ${isMine ? 'cm-mine' : 'cm-theirs'}`}>
      {message.type === 'text' && <p className="cm-text">{message.text}</p>}

      {message.type === 'photo' && (
        <img className="cm-media" src={message.media_url ?? undefined} alt="" />
      )}

      {message.type === 'video' && (
        <span className="cm-attachment">
          <span className="cm-attachment-icon">
            <IconPlay size={16} />
          </span>
          <span className="tabular">{t('chatSession.seconds', { seconds: message.duration_seconds })}</span>
        </span>
      )}

      {message.type === 'voice' && (
        <span className="cm-attachment">
          <span className="cm-attachment-icon">
            <IconMic size={16} />
          </span>
          {/* A fixed waveform: it stands for "this is audio" and does not
              pretend to be this particular recording's shape. */}
          <span className="cm-wave" aria-hidden="true" />
          <span className="tabular">{t('chatSession.seconds', { seconds: message.duration_seconds })}</span>
        </span>
      )}

      <span className="cm-footer">
        <span className="cm-time tabular">{time}</span>

        {isMine && message.status === 'sent' && (
          <IconCheck size={14} className="cm-tick" />
        )}
        {isMine && message.status === 'sending' && <span className="cm-sending" aria-hidden="true" />}
        {isMine && message.status === 'failed' && (
          <button type="button" className="cm-retry" onClick={() => onRetry(message)}>
            <IconAlert size={14} />
            {t('chatSession.retryButton')}
          </button>
        )}
      </span>
    </div>
  )
}
