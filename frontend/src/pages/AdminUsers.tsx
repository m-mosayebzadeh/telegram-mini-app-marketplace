import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { Input, Placeholder, Spinner } from '@telegram-apps/telegram-ui'
import { searchUsers } from '../lib/adminApi'
import { formatApiError } from '../lib/api'
import { IconArrowNarrowLeft } from '../components/icons'
import { IdentityAvatar } from '../components/IdentityAvatar'
import type { AdminUserSummary } from '../lib/types'

const USERS_LIST_LIMIT = 20
const DEBOUNCE_MS = 300

/** "کاربران" — browse or search every user on the platform; tapping a
 * row opens their admin detail page (profile, offers, content,
 * requests, chat sessions, transactions, block/unblock). */
export default function AdminUsers() {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const [query, setQuery] = useState('')
  const [users, setUsers] = useState<AdminUserSummary[] | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    const handle = setTimeout(() => {
      searchUsers(query.trim(), USERS_LIST_LIMIT)
        .then(setUsers)
        .catch((err) => setError(formatApiError(err)))
    }, DEBOUNCE_MS)
    return () => clearTimeout(handle)
  }, [query])

  if (error) return <Placeholder header={t('common.error')}>{error}</Placeholder>

  return (
    <div className="hp-page">
      <div className="hp-page-back-header">
        <button className="hp-chat-back" onClick={() => navigate(-1)} aria-label={t('common.back')}>
          <IconArrowNarrowLeft size={20} />
        </button>
        <span className="hp-page-back-title">{t('admin.usersTitle')}</span>
      </div>

      <div className="hp-field">
        <Input
          placeholder={t('admin.usersSearchPlaceholder')}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          after={
            query && (
              <button className="hp-sheet-close" onClick={() => setQuery('')} aria-label={t('common.close')}>
                ✕
              </button>
            )
          }
        />
      </div>

      {users == null ? (
        <Placeholder>
          <Spinner size="m" />
        </Placeholder>
      ) : users.length === 0 ? (
        <p className="hp-empty">{t('admin.usersEmpty')}</p>
      ) : (
        <div className="hp-list">
          {users.map((user) => (
            <button
              key={user.user_id}
              className="hp-list-row hp-list-row-identity"
              onClick={() => navigate(`/admin/users/${user.user_id}`)}
            >
              <IdentityAvatar avatarUrl={user.avatar_url} displayName={user.display_name} username={user.username} />
              <span className="hp-list-row-text">
                <span className="hp-list-title" dir="auto">
                  {user.display_name}
                </span>
              </span>
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
