import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { Button, Cell, List, Placeholder, Section, Spinner } from '@telegram-apps/telegram-ui'
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
  if (requests.length === 0) return <Placeholder>{t('followRequests.none')}</Placeholder>

  return (
    <List>
      <Section header={t('followRequests.title')}>
        {requests.map((row) => (
          <Cell
            key={row.follow_id}
            subtitle={row.requester.username ?? undefined}
            onClick={() => navigate(`/profiles/${row.requester.user_id}`)}
            after={
              row.status === 'pending' ? (
                <>
                  <Button
                    size="s"
                    mode="filled"
                    loading={busyId === row.requester.user_id}
                    onClick={(e) => {
                      e.stopPropagation()
                      respond(row.requester.user_id, 'accept')
                    }}
                  >
                    {t('requests.acceptButton')}
                  </Button>
                  <Button
                    size="s"
                    mode="outline"
                    loading={busyId === row.requester.user_id}
                    onClick={(e) => {
                      e.stopPropagation()
                      respond(row.requester.user_id, 'reject')
                    }}
                  >
                    {t('requests.rejectButton')}
                  </Button>
                </>
              ) : row.status === 'accepted' && !row.i_follow_them_back ? (
                <Button
                  size="s"
                  mode="outline"
                  loading={busyId === row.requester.user_id}
                  onClick={(e) => {
                    e.stopPropagation()
                    followBack(row.requester.user_id)
                  }}
                >
                  {t('followRequests.followBack')}
                </Button>
              ) : undefined
            }
          >
            {row.requester.display_name} —{' '}
            {row.status === 'pending'
              ? t('requests.statusWaiting')
              : row.status === 'accepted'
                ? t('profilePage.following')
                : t('requests.statusRejected')}
          </Cell>
        ))}
      </Section>
    </List>
  )
}
