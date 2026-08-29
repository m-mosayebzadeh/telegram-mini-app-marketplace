import { useCallback, useEffect, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { Placeholder, Spinner } from '@telegram-apps/telegram-ui'
import { apiFetch, formatApiError } from '../lib/api'
import { composeMessage, deliverMessage, listMessages } from '../lib/chatMessageApi'
import { mergeMessages } from '../lib/chatMessageMerge'
import { useOnlineStatus } from '../lib/useOnlineStatus'
import { ChatHeader } from '../components/chat/ChatHeader'
import { SessionDetailsPanel } from '../components/chat/SessionDetailsPanel'
import { MessageList } from '../components/chat/MessageList'
import { Composer } from '../components/chat/Composer'
import { ConnectionBanner } from '../components/chat/ConnectionBanner'
import { EndSessionConfirmSheet } from '../components/chat/EndSessionConfirmSheet'
import { ReportModal } from '../components/chat/ReportModal'
import { useMe } from '../lib/MeContext'
import type { ChatMessage, NewMessageContent } from '../lib/chatMessageTypes'
import type { ChatSession } from '../lib/types'

/**
 * The chat session screen (TECHNICAL_REQUIREMENTS.md section 12): a
 * sticky header with a live elapsed-time readout, a collapsible session
 * details panel (offer info + the real close/dispute actions), the
 * message list, and (while the session is still open) the composer for
 * sending new text/photo/video/voice messages.
 *
 * Session/offer/participant data AND message data are both real (see
 * lib/chatMessageApi.ts and backend/app/chat_message/) — messages used
 * to be mocked (TECHNICAL_REQUIREMENTS.md section 12's item 43), but
 * that was only ever meant to hold until a real backend existed; it now
 * does. There's no real-time push, so this screen polls for new
 * messages on an interval while the session is open — the simplest way
 * for two different participants to actually see each other's messages.
 */
export default function ChatSessionDetail() {
  const { t } = useTranslation()
  const { id } = useParams()
  const navigate = useNavigate()
  const { me } = useMe()

  const [session, setSession] = useState<ChatSession | null>(null)
  const [sessionError, setSessionError] = useState<string | null>(null)
  const [actionMessage, setActionMessage] = useState<string | null>(null)
  const [detailsOpen, setDetailsOpen] = useState(false)
  const [moreMenuOpen, setMoreMenuOpen] = useState(false)
  const [confirmCloseOpen, setConfirmCloseOpen] = useState(false)
  const [closingSession, setClosingSession] = useState(false)
  const [reportOpen, setReportOpen] = useState(false)

  const online = useOnlineStatus()

  const [messages, setMessages] = useState<ChatMessage[]>([])
  const [messagesLoading, setMessagesLoading] = useState(true)
  const [messagesError, setMessagesError] = useState<string | null>(null)

  const loadSession = useCallback(() => {
    apiFetch<ChatSession>(`/chat-sessions/${id}`)
      .then(setSession)
      .catch((err) => setSessionError(formatApiError(err)))
  }, [id])

  useEffect(loadSession, [loadSession])

  // Initial load, with a real loading/error state — runs once the
  // session (needed for its id) is available.
  useEffect(() => {
    if (!session || !me) return
    setMessagesLoading(true)
    setMessagesError(null)
    listMessages(session, me.id)
      .then(setMessages)
      .catch((err) => setMessagesError(formatApiError(err)))
      .finally(() => setMessagesLoading(false))
  }, [session, me])

  // Polling: the only way this screen finds out about a message the
  // OTHER participant sent (there's no websocket/push here — see this
  // component's own docstring above). Silent — no loading spinner, no
  // clearing of messagesError — a poll that happens to fail is just
  // tried again next tick rather than replacing the whole screen with
  // an error. Stops once the session is no longer open, since nobody
  // can send anything new past that point anyway.
  useEffect(() => {
    if (!session || !me || session.status !== 'open') return
    const interval = setInterval(() => {
      listMessages(session, me.id)
        .then((serverMessages) => setMessages((prev) => mergeMessages(serverMessages, prev)))
        .catch(() => {
          // Silently skipped — see comment above.
        })
    }, 3000)
    return () => clearInterval(interval)
  }, [session, me])

  async function confirmCloseSession() {
    setClosingSession(true)
    try {
      await apiFetch(`/chat-sessions/${id}/close`, { method: 'POST' })
      setConfirmCloseOpen(false)
      loadSession()
    } catch (err) {
      setActionMessage(formatApiError(err))
    } finally {
      setClosingSession(false)
    }
  }

  async function disputeSession() {
    try {
      await apiFetch(`/chat-sessions/${id}/dispute`, { method: 'POST' })
      setActionMessage(t('chatSession.disputeSuccess'))
      loadSession()
    } catch (err) {
      setActionMessage(formatApiError(err))
    }
  }

  /**
   * Shared by every "send" path (text/photo/video/voice): builds the
   * outgoing message, shows it immediately in the 'sending' state
   * (optimistic UI — the bubble appears before the upload/POST is even
   * confirmed, the same as any real chat app), then swaps it for the
   * real, server-resolved message once lib/chatMessageApi.ts's
   * deliverMessage() succeeds, or just flips its status to 'failed'
   * (keeping the draft, so retryMessage below can reuse it).
   */
  function send(content: NewMessageContent) {
    if (!session || !me) return
    const message = composeMessage(session, me.id, content)
    setMessages((prev) => [...prev, message])
    deliverMessage(session, message).then(({ status, resolved }) => {
      setMessages((prev) => prev.map((m) => (m.id === message.id ? (resolved ?? { ...m, status }) : m)))
    })
  }

  function retryMessage(message: ChatMessage) {
    if (!session) return
    setMessages((prev) => prev.map((m) => (m.id === message.id ? { ...m, status: 'sending' } : m)))
    deliverMessage(session, message).then(({ status, resolved }) => {
      setMessages((prev) => prev.map((m) => (m.id === message.id ? (resolved ?? { ...m, status }) : m)))
    })
  }

  if (sessionError) return <Placeholder header={t('common.error')}>{sessionError}</Placeholder>
  if (!session || !me) {
    return (
      <Placeholder>
        <Spinner size="l" />
      </Placeholder>
    )
  }

  // Only the participant who did NOT close the session may dispute it
  // (see backend/app/chat_session/router.py's dispute_session) — the
  // button is only worth showing to that one person, and only once
  // (already-disputed sessions hide it too).
  const canDispute = session.status === 'closed' && session.closed_by_user_id !== me.id && !session.disputed

  return (
    <div className="hp-page hp-chat-page">
      <ConnectionBanner online={online} />

      <ChatHeader
        session={session}
        onBack={() => navigate(-1)}
        detailsOpen={detailsOpen}
        onToggleDetails={() => setDetailsOpen((open) => !open)}
        moreMenuOpen={moreMenuOpen}
        onToggleMoreMenu={() => setMoreMenuOpen((open) => !open)}
        onReportClick={() => {
          setMoreMenuOpen(false)
          setReportOpen(true)
        }}
        onBlockClick={() => {
          setMoreMenuOpen(false)
          // No real blocking system exists anywhere in this app yet
          // (see ProfileHeader.tsx's identical placeholder) — reusing
          // the same "not available yet" message rather than inventing
          // a second, differently-worded stub.
          setActionMessage(t('profilePage.moreComingSoon'))
        }}
      />

      <SessionDetailsPanel
        session={session}
        viewerId={me.id}
        expanded={detailsOpen}
        onRequestClose={() => setConfirmCloseOpen(true)}
        onDispute={disputeSession}
        canDispute={canDispute}
        actionMessage={actionMessage}
      />

      <MessageList
        messages={messages}
        viewerId={me.id}
        loading={messagesLoading}
        error={messagesError}
        onRetry={retryMessage}
      />

      <Composer
        disabled={session.status !== 'open'}
        onSendText={(text) => send({ type: 'text', text })}
        onSendPhoto={(mediaUrl, file) => send({ type: 'photo', media_url: mediaUrl, file })}
        onSendVideo={(mediaUrl, file, durationSeconds) =>
          send({ type: 'video', media_url: mediaUrl, file, duration_seconds: durationSeconds })
        }
        onSendVoice={(durationSeconds) => send({ type: 'voice', duration_seconds: durationSeconds })}
      />

      {confirmCloseOpen && (
        <EndSessionConfirmSheet
          onCancel={() => setConfirmCloseOpen(false)}
          onConfirm={confirmCloseSession}
          busy={closingSession}
        />
      )}

      {reportOpen && <ReportModal onClose={() => setReportOpen(false)} />}
    </div>
  )
}
