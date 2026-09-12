import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { apiFetch, formatApiError } from '../lib/api'
import {
  PageHeader,
  Button,
  EmptyState,
  ErrorState,
  SkeletonRows,
  useToast,
} from '../components/ui'
import { IconPersonFallback, IconUsers } from '../components/icons'
import type { IncomingFollowRequest } from '../lib/types'

/**
 * Who has asked to follow you.
 *
 * The list keeps its history: a request that was answered stays, because
 * "I already said no to this person" is information, and a rejected
 * follow row is never deleted server-side either (see
 * backend/app/models/follow.py).
 */
export default function FollowRequests() {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const toast = useToast()

  const [requests, setRequests] = useState<IncomingFollowRequest[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busyId, setBusyId] = useState<number | null>(null)

  function load() {
    setError(null)
    apiFetch<IncomingFollowRequest[]>('/follow/incoming-requests')
      .then(setRequests)
      .catch((err) => setError(formatApiError(err)))
  }

  useEffect(load, [])

  async function act(userId: number, path: string) {
    setBusyId(userId)
    try {
      await apiFetch(path, { method: 'POST' })
      load()
    } catch (err) {
      toast.error(formatApiError(err))
    } finally {
      setBusyId(null)
    }
  }

  const pending = requests?.filter((r) => r.status === 'pending') ?? []

  return (
    <div className="ui-page">
      <PageHeader
        title={t('followRequests.title')}
        onBack={() => navigate(-1)}
        action={
          pending.length > 0 ? (
            <span className="ui-badge">{pending.length}</span>
          ) : undefined
        }
      />

      <div className="ui-page-body">
        {error ? (
          <ErrorState text={error} onRetry={load} />
        ) : requests === null ? (
          <SkeletonRows count={4} />
        ) : requests.length === 0 ? (
          <EmptyState
            icon={<IconUsers size={24} />}
            title={t('followRequests.none')}
            text={t('followRequests.noneHint')}
          />
        ) : (
          <div className="ui-list">
            {requests.map((row) => {
              const person = row.requester
              const busy = busyId === person.user_id

              return (
                <div className="fr-row" key={row.follow_id}>
                  <button
                    type="button"
                    className="ui-row ui-row-avatar"
                    onClick={() => navigate(`/profiles/${person.user_id}`)}
                  >
                    <span className="ui-row-media fl-avatar">
                      {person.avatar_url ? (
                        <img src={person.avatar_url} alt="" />
                      ) : (
                        <IconPersonFallback size={22} />
                      )}
                    </span>
                    <span className="ui-row-main">
                      <span className="ui-row-title" dir="auto">
                        {person.display_name}
                      </span>
                      {person.username && (
                        <span className="ui-row-subtitle">@{person.username}</span>
                      )}
                    </span>
                    {/* An answered request keeps its answer visible —
                        that is the whole reason the row stays. */}
                    {row.status !== 'pending' && (
                      <span className="ui-row-trailing">
                        <span
                          className={`ui-status ${
                            row.status === 'accepted' ? 'ui-status-success' : 'ui-status-neutral'
                          }`}
                        >
                          {row.status === 'accepted'
                            ? t('profilePage.following')
                            : t('requests.statusRejected')}
                        </span>
                      </span>
                    )}
                  </button>

                  {row.status === 'pending' && (
                    <div className="ui-btn-row fr-actions">
                      <Button
                        variant="danger"
                        size="sm"
                        disabled={busy}
                        onClick={() => act(person.user_id, `/follow/${person.user_id}/reject`)}
                      >
                        {t('requests.rejectButton')}
                      </Button>
                      <Button
                        variant="primary"
                        size="sm"
                        loading={busy}
                        onClick={() => act(person.user_id, `/follow/${person.user_id}/accept`)}
                      >
                        {t('requests.acceptButton')}
                      </Button>
                    </div>
                  )}

                  {row.status === 'accepted' && !row.i_follow_them_back && (
                    <div className="fr-actions fr-actions-single">
                      <Button
                        variant="secondary"
                        size="sm"
                        loading={busy}
                        onClick={() => act(person.user_id, `/follow/${person.user_id}`)}
                      >
                        {t('followRequests.followBack')}
                      </Button>
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        )}
      </div>
    </div>
  )
}
