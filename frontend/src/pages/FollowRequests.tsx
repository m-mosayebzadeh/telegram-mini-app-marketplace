import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { Placeholder, Spinner } from '@telegram-apps/telegram-ui'
import { apiFetch, ApiError } from '../lib/api'
import type { IncomingFollowRequest } from '../lib/types'

/**
 * The Instagram-style "who's requested to follow you" inbox — GET
 * /follow/incoming-requests returns pending requests (needing
 * Accept/Reject) AND the accepted/rejected history in one list, newest
 * first, since a rejected request is kept, not deleted (see
 * backend/app/models/follow.py's FollowStatus.REJECTED).
 */
export default function FollowRequests() {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const [requests, setRequests] = useState<IncomingFollowRequest[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busyId, setBusyId] = useState<number | null>(null)

  function load() {
    apiFetch<IncomingFollowRequest[]>('/follow/incoming-requests')
      .then(setRequests)
      .catch((err) => setError(err instanceof ApiError ? JSON.stringify(err.body) : String(err)))
  }

  useEffect(load, [])

  async function respond(followerUserId: number, action: 'accept' | 'reject') {
    setBusyId(followerUserId)
    try {
      await apiFetch(`/follow/${followerUserId}/${action}`, { method: 'POST' })
      load()
    } catch (err) {
      setError(err instanceof ApiError ? JSON.stringify(err.body) : String(err))
    } finally {
      setBusyId(null)
    }
  }

  async function followBack(followerUserId: number) {
    setBusyId(followerUserId)
    try {
      await apiFetch(`/follow/${followerUserId}`, { method: 'POST' })
      load()
    } catch (err) {
      setError(err instanceof ApiError ? JSON.stringify(err.body) : String(err))
    } finally {
      setBusyId(null)
    }
  }

  if (error) return <Placeholder header={t('common.error')}>{error}</Placeholder>
  if (!requests) {
    return (
      <Placeholder>
        <Spinner size="l" />
      </Placeholder>
    )
  }

  return (
    <div className="hp-page">
      <div className="hp-page-header">{t('followRequests.title')}</div>

      {requests.length === 0 ? (
        <p className="hp-empty">{t('followRequests.none')}</p>
      ) : (
        <div className="hp-list">
          {requests.map((row) => (
            <div key={row.follow_id} className="hp-list-row">
              <div
                className="hp-list-row-main"
                onClick={() => navigate(`/profiles/${row.requester.user_id}`)}
                style={{ cursor: 'pointer' }}
              >
                <span className="hp-list-title">{row.requester.display_name}</span>
                <span className="hp-list-subtitle">
                  {row.requester.username ? `@${row.requester.username} — ` : ''}
                  {row.status === 'pending'
                    ? t('requests.statusWaiting')
                    : row.status === 'accepted'
                      ? t('profilePage.following')
                      : t('requests.statusRejected')}
                </span>
              </div>
              {row.status === 'pending' && (
                <div className="hp-list-row-actions">
                  <button
                    className="hp-btn-sm hp-btn-sm-filled"
                    disabled={busyId === row.requester.user_id}
                    onClick={() => respond(row.requester.user_id, 'accept')}
                  >
                    {t('requests.acceptButton')}
                  </button>
                  <button
                    className="hp-btn-sm"
                    disabled={busyId === row.requester.user_id}
                    onClick={() => respond(row.requester.user_id, 'reject')}
                  >
                    {t('requests.rejectButton')}
                  </button>
                </div>
              )}
              {row.status === 'accepted' && !row.i_follow_them_back && (
                <button
                  className="hp-btn-sm"
                  disabled={busyId === row.requester.user_id}
                  onClick={() => followBack(row.requester.user_id)}
                >
                  {t('followRequests.followBack')}
                </button>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
