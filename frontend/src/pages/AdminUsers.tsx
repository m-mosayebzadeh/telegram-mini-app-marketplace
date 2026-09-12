import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { searchUsers } from '../lib/adminApi'
import { formatApiError } from '../lib/api'
import {
  PageHeader,
  EmptyState,
  ErrorState,
  SearchField,
  SkeletonRows,
} from '../components/ui'
import { IconChevron, IconPersonFallback, IconUsers } from '../components/icons'
import type { AdminUserSummary } from '../lib/types'

const USERS_LIST_LIMIT = 20
/** Long enough that typing a name does not fire a request per keystroke,
 *  short enough that the list still feels like it is keeping up. */
const DEBOUNCE_MS = 300

/**
 * Browse or search every user on the platform. Tapping a row opens their
 * admin detail page.
 */
export default function AdminUsers() {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const [query, setQuery] = useState('')
  const [users, setUsers] = useState<AdminUserSummary[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [attempt, setAttempt] = useState(0)

  useEffect(() => {
    let cancelled = false
    const handle = setTimeout(() => {
      setError(null)
      searchUsers(query.trim(), USERS_LIST_LIMIT)
        .then((rows) => {
          if (!cancelled) setUsers(rows)
        })
        .catch((err) => {
          if (!cancelled) setError(formatApiError(err))
        })
    }, DEBOUNCE_MS)
    return () => {
      cancelled = true
      clearTimeout(handle)
    }
  }, [query, attempt])

  return (
    <div className="ui-page">
      <PageHeader title={t('admin.usersTitle')} onBack={() => navigate('/admin')} />

      <div className="ui-page-body">
        <SearchField
          id="admin-user-search"
          value={query}
          onChange={setQuery}
          placeholder={t('admin.usersSearchPlaceholder')}
        />

        {error ? (
          <ErrorState text={error} onRetry={() => setAttempt((n) => n + 1)} />
        ) : users === null ? (
          <SkeletonRows count={5} />
        ) : users.length === 0 ? (
          <EmptyState
            icon={<IconUsers size={24} />}
            title={t('admin.usersEmpty')}
            /* Says which of the two reasons it is: nobody matches THIS
               search, versus there being nobody at all. */
            text={query ? t('admin.usersEmptyForQuery', { query }) : t('admin.usersEmptyHint')}
          />
        ) : (
          <div className="ui-list">
            {users.map((user) => (
              <button
                type="button"
                className="ui-row ui-row-avatar"
                key={user.user_id}
                onClick={() => navigate(`/admin/users/${user.user_id}`)}
              >
                <span className="ui-row-media fl-avatar">
                  {user.avatar_url ? (
                    <img src={user.avatar_url} alt="" />
                  ) : (
                    <IconPersonFallback size={22} />
                  )}
                </span>
                <span className="ui-row-main">
                  <span className="ui-row-title" dir="auto">
                    {user.display_name}
                  </span>
                  {user.username && <span className="ui-row-subtitle">@{user.username}</span>}
                </span>
                <span className="ui-row-trailing">
                  <IconChevron size={20} className="ui-row-chevron" />
                </span>
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
