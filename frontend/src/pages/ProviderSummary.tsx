import { useEffect, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { apiFetch, formatApiError } from '../lib/api'
import { PageHeader, ErrorState, SkeletonRows, StatList } from '../components/ui'
import type { ProviderSummary as ProviderSummaryType } from '../lib/types'

/**
 * What a buyer can find out about a provider before asking for their
 * time. Reached from the offer page.
 *
 * There is no average rating here on purpose: the Rating entity does not
 * exist yet, and a rating figure that is really "we have no data" is
 * worse than no figure at all.
 */
export default function ProviderSummary() {
  const { t, i18n } = useTranslation()
  const { id } = useParams()
  const navigate = useNavigate()
  const [summary, setSummary] = useState<ProviderSummaryType | null>(null)
  const [error, setError] = useState<string | null>(null)

  function load() {
    setError(null)
    apiFetch<ProviderSummaryType>(`/profiles/${id}/provider-summary`)
      .then(setSummary)
      .catch((err) => setError(formatApiError(err)))
  }

  useEffect(load, [id])

  // An em dash, not "0%": a provider who has never been asked has no
  // response rate, and showing zero would read as "never responds".
  const percent = (value: number | null) =>
    value === null ? '—' : `${Math.round(value * 100).toLocaleString(i18n.language)}%`

  return (
    <div className="ui-page">
      <PageHeader title={t('providerSummary.title')} onBack={() => navigate(-1)} />

      <div className="ui-page-body">
        {error ? (
          <ErrorState text={error} onRetry={load} />
        ) : !summary ? (
          <SkeletonRows count={5} />
        ) : (
          <StatList
            stats={[
              {
                label: t('providerSummary.status'),
                value:
                  summary.status === 'established'
                    ? t('providerSummary.established')
                    : t('providerSummary.new'),
              },
              {
                label: t('providerSummary.joinedAt'),
                value: new Date(summary.joined_at).toLocaleDateString(i18n.language),
              },
              {
                label: t('providerSummary.completedServices'),
                value: summary.completed_services_count.toLocaleString(i18n.language),
              },
              {
                label: t('providerSummary.responseRate'),
                value: percent(summary.response_rate),
              },
              {
                label: t('providerSummary.rejectionRate'),
                value: percent(summary.rejection_rate),
              },
              {
                label: t('providerSummary.disputedTransactions'),
                value: summary.disputed_transactions_count.toLocaleString(i18n.language),
              },
            ]}
          />
        )}
      </div>
    </div>
  )
}
