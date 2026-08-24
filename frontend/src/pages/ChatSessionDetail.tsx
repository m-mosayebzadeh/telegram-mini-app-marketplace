import { useCallback, useEffect, useState } from 'react'
import { useParams } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { Button, Cell, List, Placeholder, Section, Spinner } from '@telegram-apps/telegram-ui'
import { apiFetch, ApiError } from '../lib/api'
import { useMe } from '../lib/MeContext'
import type { ChatSession } from '../lib/types'

/**
 * A chat session's own lifecycle actions — close, and dispute (only for
 * the participant who did NOT close it, only within the grace window;
 * see backend/app/chat_session/router.py). No messaging UI yet — that's
 * the next backend piece, not built yet.
 */
export default function ChatSessionDetail() {
  const { t } = useTranslation()
  const { id } = useParams()
  const { me } = useMe()
  const [session, setSession] = useState<ChatSession | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [message, setMessage] = useState<string | null>(null)

  const load = useCallback(() => {
    apiFetch<ChatSession>(`/chat-sessions/${id}`)
      .then(setSession)
      .catch((err) => setError(err instanceof ApiError ? JSON.stringify(err.body) : String(err)))
  }, [id])

  useEffect(load, [load])

  async function close() {
    try {
      await apiFetch(`/chat-sessions/${id}/close`, { method: 'POST' })
      load()
    } catch (err) {
      setMessage(err instanceof ApiError ? JSON.stringify(err.body) : String(err))
    }
  }

  async function dispute() {
    try {
      await apiFetch(`/chat-sessions/${id}/dispute`, { method: 'POST' })
      setMessage(t('chatSession.disputeSuccess'))
    } catch (err) {
      setMessage(err instanceof ApiError ? JSON.stringify(err.body) : String(err))
    }
  }

  if (error) return <Placeholder header={t('common.error')}>{error}</Placeholder>
  if (!session || !me) {
    return (
      <Placeholder>
        <Spinner size="l" />
      </Placeholder>
    )
  }

  // Only the participant who did NOT close the session may dispute it
  // (see backend/app/chat_session/router.py's dispute_session) — the
  // button is only worth showing to that one person.
  const canDispute = session.status === 'closed' && session.closed_by_user_id !== me.id

  return (
    <List>
      <Section header={t('chatSession.title')}>
        <Cell subtitle={t('offers.status')}>
          {session.status === 'open' ? t('chatSession.statusOpen') : t('chatSession.statusClosed')}
        </Cell>
        {session.status === 'closed' && (
          <Cell>
            {session.closed_by_user_id === me.id ? t('chatSession.closedByYou') : t('chatSession.closedByOther')}
          </Cell>
        )}
      </Section>
      <Section>
        {session.status === 'open' && (
          <Cell>
            <Button stretched onClick={close}>
              {t('chatSession.closeButton')}
            </Button>
          </Cell>
        )}
        {canDispute && (
          <Cell>
            <Button stretched mode="outline" onClick={dispute}>
              {t('chatSession.disputeButton')}
            </Button>
          </Cell>
        )}
        {message && <Cell>{message}</Cell>}
      </Section>
    </List>
  )
}
