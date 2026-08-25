import { useCallback, useEffect, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { Placeholder, Spinner } from '@telegram-apps/telegram-ui'
import { apiFetch, ApiError } from '../lib/api'
import { composeMessage, deliverMessage, listMessages } from '../lib/chatMessageApi'
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
 * Session/offer/participant data is REAL, fetched from the existing
 * (now-enriched) GET /chat-sessions/{id}. Message data — both the seeded
 * conversation and anything sent from this composer — is MOCK (see
 * lib/chatMessageApi.ts): there is no real message backend yet, per
 * TECHNICAL_REQUIREMENTS.md section 12's item 43.
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
      .catch((err) => setSessionError(err instanceof ApiError ? JSON.stringify(err.body) : String(err)))
  }, [id])

  useEffect(loadSession, [loadSession])

  // Messages load once the real session (and therefore the other
  // participant's identity, which the mock generator needs) is
  // available — see lib/mockChatData.ts's generateMockConversation().
  useEffect(() => {
    if (!session || !me) return
    setMessagesLoading(true)
    setMessagesError(null)
    listMessages(session, me.id)
      .then(setMessages)
      .catch((err) => setMessagesError(err instanceof ApiError ? JSON.stringify(err.body) : String(err)))
      .finally(() => setMessagesLoading(false))
  }, [session, me])

  async function confirmCloseSession() {
    setClosingSession(true)
    try {
      await apiFetch(`/chat-sessions/${id}/close`, { method: 'POST' })
      setConfirmCloseOpen(false)
      loadSession()
    } catch (err) {
      setActionMessage(err instanceof ApiError ? JSON.stringify(err.body) : String(err))
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
      setActionMessage(err instanceof ApiError ? JSON.stringify(err.body) : String(err))
    }
  }

  /**
   * Shared by every "send" path (text/photo/video/voice) and by retry:
   * builds the outgoing message, shows it immediately in the 'sending'
   * state (optimistic UI — the bubble appears before delivery is
   * confirmed, the same as any real chat app), then updates it in place
   * once lib/chatMessageApi.ts's simulated delivery resolves to 'sent'
   * or 'failed'.
   */
  function send(content: NewMessageContent) {
    if (!session || !me) return
    const message = composeMessage(session, me.id, content)
    setMessages((prev) => [...prev, message])
    deliverMessage(message).then((status) => {
      setMessages((prev) => prev.map((m) => (m.id === message.id ? { ...m, status } : m)))
    })
  }

  function retryMessage(message: ChatMessage) {
    setMessages((prev) => prev.map((m) => (m.id === message.id ? { ...m, status: 'sending' } : m)))
    deliverMessage({ ...message, status: 'sending' }).then((status) => {
      setMessages((prev) => prev.map((m) => (m.id === message.id ? { ...m, status } : m)))
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
        onSendPhoto={(mediaUrl) => send({ type: 'photo', media_url: mediaUrl })}
        onSendVideo={(mediaUrl, durationSeconds) => send({ type: 'video', media_url: mediaUrl, duration_seconds: durationSeconds })}
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
