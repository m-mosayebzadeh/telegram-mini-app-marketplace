import { useCallback, useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { EmptyState, ErrorState, PageHeader, SkeletonRows } from '../components/ui'
import { IconShieldLock } from '../components/icons'
import { formatApiError } from '../lib/api'
import { fetchFeedback, type FeedbackRow } from '../lib/accountApi'
import { useMe } from '../lib/MeContext'

/**
 * "Management → problems people reported" (section 32, step 4): what came
 * in through "report a problem", newest first. Read-only; it is for
 * reading.
 */
export default function AdminFeedback() {
  const { t, i18n } = useTranslation()
  const navigate = useNavigate()
  const { adminAccess } = useMe()
  const hasAccess = !!adminAccess && (adminAccess.is_owner || adminAccess.scopes.includes('moderation.reports'))
  const [rows, setRows] = useState<FeedbackRow[] | null>(null)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(() => {
    if (!hasAccess) return
    fetchFeedback()
      .then((value) => {
        // Cleared on the answer, not before asking (a synchronous clear in the effect rendered twice).
        setError(null)
        setRows(value)
      })
      .catch((err) => setError(formatApiError(err)))
  }, [hasAccess])
  useEffect(load, [load])

  return (
    <div className="ui-page">
      <PageHeader title={t('adminFeedback.title')} onBack={() => navigate('/admin')} />
      <div className="ui-page-body">
        {!hasAccess ? (
          adminAccess ? (
            <EmptyState icon={<IconShieldLock size={24} />} title={t('admin.noAccess')} text={t('admin.noAccessHint')} />
          ) : (
            <SkeletonRows count={3} />
          )
        ) : error ? (
          <ErrorState text={error} onRetry={load} />
        ) : rows === null ? (
          <SkeletonRows count={3} />
        ) : rows.length === 0 ? (
          <EmptyState icon={<IconShieldLock size={24} />} title={t('adminFeedback.empty')} text="" />
        ) : (
          <div className="ui-list">
            {rows.map((row) => (
              <div key={row.id} className="ui-row is-wrap">
                <span className="ui-row-main">
                  <span className="ui-row-title" dir="auto">{row.text}</span>
                  <span className="ui-row-subtitle">
                    {row.display_name}
                    {row.where ? ` · ${row.where}` : ''}
                    {' · '}
                    {new Date(row.created_at).toLocaleString(i18n.language)}
                  </span>
                </span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
