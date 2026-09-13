import { useTranslation } from 'react-i18next'
import { IconAlert, IconCheck, IconPlay } from '../icons'
import { VoicePlayer } from './VoicePlayer'
import type { ChatMessage } from '../../lib/chatMessageTypes'

interface MessageBubbleProps {
  message: ChatMessage
  /** Whether the sender is the viewer — decides which side it renders on
   *  and whether a delivery state is shown at all. Only your own
   *  messages carry one, the same as any real chat app. */
  isMine: boolean
  onRetry: (message: ChatMessage) => void
  /** Opens a photo or video full screen. Lives on the page rather than
   *  in the bubble so only one viewer can ever be open. */
  onOpenMedia: (url: string, kind?: 'photo' | 'video') => void
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
export function MessageBubble({ message, isMine, onRetry, onOpenMedia }: MessageBubbleProps) {
  const { t } = useTranslation()

  const time = new Date(message.created_at).toLocaleTimeString(undefined, {
    hour: '2-digit',
    minute: '2-digit',
  })

  return (
    <div className={`cm ${isMine ? 'cm-mine' : 'cm-theirs'}`}>
      {message.type === 'text' && <p className="cm-text">{message.text}</p>}

      {message.type === 'photo' && (
        /* Tappable: a photo in a conversation that cannot be opened is a
           thumbnail pretending to be a photo. */
        <button
          type="button"
          className="cm-media-open"
          onClick={() => message.media_url && onOpenMedia(message.media_url)}
          aria-label={t('chatSession.openPhoto')}
        >
          <img className="cm-media" src={message.media_url ?? undefined} alt="" />
        </button>
      )}

      {message.type === 'video' && (
        <button
          type="button"
          className="cm-attachment cm-attachment-open"
          onClick={() => message.media_url && onOpenMedia(message.media_url, 'video')}
          aria-label={t('chatSession.openVideo')}
        >
          <span className="cm-attachment-icon">
            <IconPlay size={16} />
          </span>
          <span className="tabular">
            {t('chatSession.seconds', { seconds: message.duration_seconds })}
          </span>
        </button>
      )}

      {message.type === 'voice' && (
        <VoicePlayer src={message.media_url} durationSeconds={message.duration_seconds} />
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
