import { useTranslation } from 'react-i18next'
import { groupMessagesByDate } from '../../lib/chatTime'
import { MessageBubble } from './MessageBubble'
import type { ChatMessage } from '../../lib/chatMessageTypes'

interface MessageListProps {
  messages: ChatMessage[]
  viewerId: number
  loading: boolean
  error: string | null
  onRetry: (message: ChatMessage) => void
}

/**
 * The scrollable message area: loading/error/empty states, then every
 * message grouped under a date separator (see lib/chatTime.ts's
 * groupMessagesByDate). Pagination isn't implemented yet (the mock
 * conversation is always small enough to render in one page), but this
 * component takes a plain array rather than reaching into the service
 * layer itself, so adding "load older messages" later only means the
 * parent page passing a longer array — no change needed here.
 */
export function MessageList({ messages, viewerId, loading, error, onRetry }: MessageListProps) {
  const { t } = useTranslation()

  if (loading) {
    // Skeleton bubbles rather than a spinner, on both sides, so the
    // shape of a conversation is there before the conversation is.
    return (
      <div className="cs-messages">
        <div className="cm cm-theirs ui-skeleton cm-skeleton" />
        <div className="cm cm-mine ui-skeleton cm-skeleton cm-skeleton-short" />
        <div className="cm cm-theirs ui-skeleton cm-skeleton" />
      </div>
    )
  }

  if (error) {
    return (
      <div className="cs-messages cs-messages-centered">
        <p className="cs-notice cs-notice-error">{error}</p>
      </div>
    )
  }

  if (messages.length === 0) {
    return (
      <div className="cs-messages cs-messages-centered">
        <p className="cs-notice">{t('chatSession.messagesEmpty')}</p>
      </div>
    )
  }

  const groups = groupMessagesByDate(messages)

  return (
    <div className="cs-messages">
      {groups.map((group) => (
        <div key={group.dateKey}>
          <div className="cs-date">
            <span>{formatDateLabel(group.dateKey, t)}</span>
          </div>
          {group.messages.map((message) => (
            <MessageBubble
              key={message.id}
              message={message}
              isMine={message.sender_id === viewerId}
              onRetry={onRetry}
            />
          ))}
        </div>
      ))}
    </div>
  )
}

/** Formats a "YYYY-MM-DD" group key as "Today" / "Yesterday" / a full
 * localized date — plain formatting logic, kept inline here rather than
 * extracted since (unlike groupMessagesByDate) it has no real branching
 * worth unit-testing on its own beyond what a human glance confirms. */
function formatDateLabel(dateKey: string, t: (key: string) => string): string {
  const today = new Date().toISOString().slice(0, 10)
  const yesterday = new Date(Date.now() - 86_400_000).toISOString().slice(0, 10)

  if (dateKey === today) return t('chatSession.dateToday')
  if (dateKey === yesterday) return t('chatSession.dateYesterday')
  return new Date(dateKey).toLocaleDateString(undefined, {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  })
}
