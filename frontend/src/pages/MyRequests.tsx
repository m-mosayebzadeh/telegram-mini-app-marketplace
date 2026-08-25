import { useCallback, useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { Placeholder, Spinner } from '@telegram-apps/telegram-ui'
import { apiFetch, ApiError } from '../lib/api'
import { getRequestAction } from '../lib/requestActions'
import type { ChatSession, Request } from '../lib/types'

/** Everything the logged-in user has requested as a buyer, with the
 * one relevant action per request (see getRequestAction — the branching
 * itself is tested separately, this component just renders whatever
 * it decides). */
export default function MyRequests() {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const [requests, setRequests] = useState<Request[] | null>(null)
  const [sessions, setSessions] = useState<ChatSession[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [payingId, setPayingId] = useState<number | null>(null)
  const [message, setMessage] = useState<string | null>(null)

  const load = useCallback(() => {
    Promise.all([apiFetch<Request[]>('/requests/mine'), apiFetch<ChatSession[]>('/chat-sessions/mine')])
      .then(([r, s]) => {
        setRequests(r)
        setSessions(s)
      })
      .catch((err) => setError(err instanceof ApiError ? JSON.stringify(err.body) : String(err)))
  }, [])

  useEffect(load, [load])

  async function pay(requestId: number) {
    setMessage(null)
    setPayingId(requestId)
    try {
      await apiFetch(`/requests/${requestId}/pay`, { method: 'POST' })
      setMessage(t('requests.paySuccess'))
      load()
    } catch (err) {
      if (err instanceof ApiError && err.status === 402) {
        setMessage(t('requests.insufficientBalance'))
      } else {
        setMessage(err instanceof ApiError ? JSON.stringify(err.body) : String(err))
      }
    } finally {
      setPayingId(null)
    }
  }

  if (error) return <Placeholder header={t('common.error')}>{error}</Placeholder>
  if (!requests || !sessions) {
    return (
      <Placeholder>
        <Spinner size="l" />
      </Placeholder>
    )
  }

  return (
    <div className="hp-page">
      <div className="hp-page-header">{t('requests.mineTitle')}</div>

      {requests.length === 0 ? (
        <p className="hp-empty">{t('requests.none')}</p>
      ) : (
        <div className="hp-list">
          {requests.map((request) => {
            const action = getRequestAction(request, sessions)
            return (
              <div key={request.id} className="hp-list-row">
                <div className="hp-list-row-main">
                  <span className="hp-list-title">
                    {action.type === 'waiting' && t('requests.statusWaiting')}
                    {action.type === 'rejected' && `${t('requests.statusRejected')}: ${action.reason ?? ''}`}
                    {action.type === 'cancelled' && `${t('requests.statusCancelled')}: ${action.reason ?? ''}`}
                    {action.type === 'pay' && t('requests.payButton')}
                    {action.type === 'session' &&
                      (action.session.status === 'open' ? t('chatSession.statusOpen') : t('chatSession.statusClosed'))}
                  </span>
                  <span className="hp-list-subtitle">#{request.offer_id}</span>
                </div>
                {action.type === 'pay' && (
                  <button className="hp-btn-sm hp-btn-sm-filled" disabled={payingId === request.id} onClick={() => pay(request.id)}>
                    {payingId === request.id ? t('common.loading') : t('requests.payButton')}
                  </button>
                )}
                {action.type === 'session' && (
                  <button className="hp-btn-sm" onClick={() => navigate(`/chat-sessions/${action.session.id}`)}>
                    {t('requests.openSession')}
                  </button>
                )}
              </div>
            )
          })}
        </div>
      )}

      {message && <p className="hp-hint" style={{ padding: '0 16px' }}>{message}</p>}
    </div>
  )
}
