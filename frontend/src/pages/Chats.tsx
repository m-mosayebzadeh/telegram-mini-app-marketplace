import { useCallback, useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { Placeholder, Spinner } from '@telegram-apps/telegram-ui'
import { apiFetch, formatApiError } from '../lib/api'
import type { ChatSession } from '../lib/types'

type Segment = 'active' | 'archived'

/**
 * The Chats tab: every chat session the current user is part of, as
 * either buyer or provider — GET /chat-sessions/mine already returns
 * both directions in one call (see backend/app/chat_session/router.py).
 * Archiving (see ChatSession.archived_by_buyer/archived_by_provider) is
 * purely a per-viewer "get it out of my main list" action, the same
 * Post/Archived-Post pattern the Profile and Activity tabs use — it
 * never deletes anything, and never affects the other participant's
 * own view of the same session.
 */
export default function Chats() {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const [segment, setSegment] = useState<Segment>('active')
  const [sessions, setSessions] = useState<ChatSession[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busyId, setBusyId] = useState<number | null>(null)

  const load = useCallback(() => {
    apiFetch<ChatSession[]>('/chat-sessions/mine')
      .then(setSessions)
      .catch((err) => setError(formatApiError(err)))
  }, [])

  useEffect(load, [load])

  async function toggleArchive(session: ChatSession) {
    setBusyId(session.id)
    try {
      const action = session.archived ? 'unarchive' : 'archive'
      await apiFetch(`/chat-sessions/${session.id}/${action}`, { method: 'POST' })
      load()
    } catch (err) {
      setError(formatApiError(err))
    } finally {
      setBusyId(null)
    }
  }

  if (error) return <Placeholder header={t('common.error')}>{error}</Placeholder>
  if (!sessions) {
    return (
      <Placeholder>
        <Spinner size="l" />
      </Placeholder>
    )
  }

  const shown = sessions
    .filter((s) => (segment === 'archived' ? s.archived : !s.archived))
    .sort((a, b) => (a.opened_at < b.opened_at ? 1 : -1))

  return (
    <div className="hp-page">
      <div className="hp-segmented" style={{ margin: '14px 12px 0' }}>
        <button
          className={`hp-segmented-btn ${segment === 'active' ? 'hp-segmented-active' : ''}`}
          onClick={() => setSegment('active')}
        >
          {t('chatsPage.activeTab')}
        </button>
        <button
          className={`hp-segmented-btn ${segment === 'archived' ? 'hp-segmented-active' : ''}`}
          onClick={() => setSegment('archived')}
        >
          {t('chatsPage.archivedTab')}
        </button>
      </div>

      {shown.length === 0 ? (
        <p className="hp-empty">
          {segment === 'active' ? t('chatsPage.activeEmpty') : t('chatsPage.archivedEmpty')}
        </p>
      ) : (
        <div className="hp-list" style={{ marginTop: 14 }}>
          {shown.map((session) => (
            <div key={session.id} className="hp-list-row">
              <div
                className="hp-list-row-main"
                onClick={() => navigate(`/chat-sessions/${session.id}`)}
                style={{ cursor: 'pointer' }}
              >
                <span className="hp-list-title" dir="auto">
                  {session.other_participant.display_name}
                </span>
                <span className="hp-list-subtitle">
                  {session.offer_title} —{' '}
                  {session.my_role === 'buyer' ? t('chatsPage.roleBuyer') : t('chatsPage.roleProvider')} —{' '}
                  {session.status === 'open' ? t('chatSession.statusOpen') : t('chatSession.statusClosed')}
                </span>
              </div>
              <div className="hp-list-row-actions">
                <button className="hp-btn-sm" disabled={busyId === session.id} onClick={() => toggleArchive(session)}>
                  {session.archived ? t('chatsPage.unarchiveButton') : t('chatsPage.archiveButton')}
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
