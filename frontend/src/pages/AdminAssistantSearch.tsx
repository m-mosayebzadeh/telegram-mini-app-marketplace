import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { listAssistants, searchUsers } from '../lib/adminApi'
import { formatApiError } from '../lib/api'
import { shouldRunAdminSearch } from '../lib/adminSearch'
import {
  PageHeader,
  EmptyState,
  ErrorState,
  SearchField,
  SkeletonRows,
} from '../components/ui'
import { IconChevron, IconPersonFallback, IconShieldLock } from '../components/icons'
import type { AdminUserSummary } from '../lib/types'

const SEARCH_RESULT_LIMIT = 5
/** How long after the last keystroke before the backend is called — the
 *  debounce half of "do not search on every keystroke"; the other half
 *  is the minimum length in lib/adminSearch.ts. */
const DEBOUNCE_MS = 300

/**
 * Who has admin access, and how to give it to someone who does not.
 *
 * With the box empty the list shows the CURRENT assistants — the answer
 * to "who can get in?". Typing switches it to a search across every
 * user, which is how a brand new assistant is found in the first place:
 * their first role is assigned on the per-user page each row leads to.
 */
export default function AdminAssistantSearch() {
  const { t } = useTranslation()
  const navigate = useNavigate()

  const [query, setQuery] = useState('')
  const [assistants, setAssistants] = useState<AdminUserSummary[] | null>(null)
  const [results, setResults] = useState<AdminUserSummary[] | null>(null)
  const [searching, setSearching] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const isSearching = shouldRunAdminSearch(query)

  // The default list, reloaded whenever the box is cleared: a role
  // assigned or revoked elsewhere can have changed who counts as an
  // assistant since it was last fetched.
  useEffect(() => {
    if (isSearching) return
    setError(null)
    listAssistants()
      .then(setAssistants)
      .catch((err) => setError(formatApiError(err)))
  }, [isSearching])

  useEffect(() => {
    if (!shouldRunAdminSearch(query)) {
      setResults(null)
      return
    }
    let cancelled = false
    setSearching(true)
    const handle = setTimeout(() => {
      searchUsers(query.trim(), SEARCH_RESULT_LIMIT)
        .then((rows) => {
          if (!cancelled) setResults(rows)
        })
        .catch((err) => {
          if (!cancelled) setError(formatApiError(err))
        })
        .finally(() => {
          if (!cancelled) setSearching(false)
        })
    }, DEBOUNCE_MS)
    return () => {
      cancelled = true
      clearTimeout(handle)
    }
  }, [query])

  const rows = isSearching ? results : assistants
  const loading = rows === null || (isSearching && searching)

  return (
    <div className="ui-page">
      <PageHeader
        title={t('admin.sectionAssistantSearch')}
        onBack={() => navigate('/admin/assistants')}
      />

      <div className="ui-page-body">
        <SearchField
          id="assistant-search"
          value={query}
          onChange={setQuery}
          placeholder={t('admin.assistantSearchPlaceholder')}
        />

        {/* Says which list is on screen. Without it, an empty search box
            showing five people is indistinguishable from a search that
            found five. */}
        <h2 className="ui-section-title as-heading">
          {isSearching ? t('admin.searchResultsLabel') : t('admin.currentAssistantsLabel')}
        </h2>

        {error ? (
          <ErrorState text={error} onRetry={() => setQuery(query)} />
        ) : loading ? (
          <SkeletonRows count={3} />
        ) : rows.length === 0 ? (
          <EmptyState
            icon={<IconShieldLock size={24} />}
            title={isSearching ? t('admin.assistantSearchEmpty') : t('admin.assistantsEmpty')}
            text={isSearching ? t('admin.assistantSearchEmptyHint') : t('admin.assistantsEmptyHint')}
          />
        ) : (
          <div className="ui-list">
            {rows.map((user) => (
              <button
                type="button"
                className="ui-row ui-row-avatar"
                key={user.user_id}
                onClick={() => navigate(`/admin/assistants/users/${user.user_id}/roles`)}
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
                  {/* Only in search results: in the assistants list every
                      row would carry it, which makes it say nothing. */}
                  {isSearching && user.is_assistant && (
                    <span className="ui-status ui-status-success">
                      {t('admin.isAssistantLabel')}
                    </span>
                  )}
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
