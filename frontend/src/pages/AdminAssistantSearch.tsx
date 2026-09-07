import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { Avatar, Input, Placeholder, Spinner } from '@telegram-apps/telegram-ui'
import { listAssistants, searchUsers } from '../lib/adminApi'
import { formatApiError } from '../lib/api'
import { shouldRunAdminSearch } from '../lib/adminSearch'
import { IconArrowNarrowLeft, IconCheck } from '../components/icons'
import type { AdminUserSummary } from '../lib/types'

const SEARCH_RESULT_LIMIT = 5
// How long to wait after the last keystroke before actually calling the
// backend — the debounce half of the "don't search on every keystroke"
// rule (see lib/adminSearch.ts for the other half, the 3-character
// minimum).
const DEBOUNCE_MS = 300

/**
 * "جستجوی اعضا و دسترسی‌ها" — a search box on top; with nothing (or
 * fewer than ADMIN_SEARCH_MIN_LENGTH real characters) typed, shows the
 * current assistants list below it. Typing enough switches the list
 * over to a capped, debounced search across EVERY user (not just
 * current assistants) instead — this is also how a brand new assistant
 * gets found in the first place, since assigning their first role
 * happens on the per-user roles page this list links to.
 */
export default function AdminAssistantSearch() {
  const { t } = useTranslation()
  const navigate = useNavigate()

  const [query, setQuery] = useState('')
  const [assistants, setAssistants] = useState<AdminUserSummary[] | null>(null)
  const [results, setResults] = useState<AdminUserSummary[] | null>(null)
  const [searching, setSearching] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // The default list — loaded once, and reloaded whenever the search
  // box is cleared (a role assigned/revoked elsewhere could have
  // changed who counts as a current assistant since the last load).
  const isActivelySearching = shouldRunAdminSearch(query)
  useEffect(() => {
    if (!isActivelySearching) {
      listAssistants()
        .then(setAssistants)
        .catch((err) => setError(formatApiError(err)))
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isActivelySearching])

  // Debounced search: only actually calls the backend DEBOUNCE_MS after
  // the user stops typing, and only once there's something worth
  // searching for — never on every keystroke.
  useEffect(() => {
    if (!shouldRunAdminSearch(query)) {
      setResults(null)
      return
    }
    setSearching(true)
    const handle = setTimeout(() => {
      searchUsers(query.trim(), SEARCH_RESULT_LIMIT)
        .then(setResults)
        .catch((err) => setError(formatApiError(err)))
        .finally(() => setSearching(false))
    }, DEBOUNCE_MS)
    return () => clearTimeout(handle)
  }, [query])

  if (error) return <Placeholder header={t('common.error')}>{error}</Placeholder>

  const rows = isActivelySearching ? results : assistants

  return (
    <div className="hp-page">
      <div className="hp-page-back-header">
        <button className="hp-chat-back" onClick={() => navigate(-1)} aria-label={t('common.back')}>
          <IconArrowNarrowLeft size={20} />
        </button>
        <span className="hp-page-back-title">{t('admin.sectionAssistantSearch')}</span>
      </div>

      <div className="hp-field">
        <Input
          placeholder={t('admin.assistantSearchPlaceholder')}
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

      {rows == null ? (
        <Placeholder>
          <Spinner size="m" />
        </Placeholder>
      ) : rows.length === 0 ? (
        <p className="hp-empty">
          {isActivelySearching ? t('admin.assistantSearchEmpty') : t('admin.assistantsEmpty')}
        </p>
      ) : (
        <div className="hp-list">
          {rows.map((user) => (
            <div key={user.user_id} className="hp-list-row">
              <button
                className="hp-list-row-main hp-list-row-identity"
                onClick={() => navigate(`/profiles/${user.user_id}`)}
              >
                <Avatar
                  size={40}
                  src={user.avatar_url ?? undefined}
                  acronym={user.display_name.slice(0, 1).toUpperCase()}
                />
                <span className="hp-list-row-text">
                  <span className="hp-list-title" dir="auto">
                    {user.display_name}
                  </span>
                  {user.username && <span className="hp-list-subtitle">@{user.username}</span>}
                </span>
              </button>
              <div className="hp-list-row-actions">
                {isActivelySearching && user.is_assistant && (
                  <span aria-label={t('admin.sectionAssistants')}>
                    <IconCheck size={18} />
                  </span>
                )}
                <button className="hp-btn-sm" onClick={() => navigate(`/admin/assistants/users/${user.user_id}/roles`)}>
                  {t('admin.viewRolesButton')}
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
      {searching && (
        <p className="hp-hint" style={{ padding: '0 16px' }}>
          {t('common.loading')}
        </p>
      )}
    </div>
  )
}
