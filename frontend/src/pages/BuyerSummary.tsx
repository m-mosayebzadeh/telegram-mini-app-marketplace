import { useEffect, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { apiFetch, formatApiError } from '../lib/api'
import { PageHeader, ErrorState, SkeletonRows, StatList } from '../components/ui'
import { DropAmount } from '../components/ui/Drop'
import type { BuyerSummary as BuyerSummaryType } from '../lib/types'

/**
 * What a provider can find out about a buyer before accepting or
 * rejecting their request.
 *
 * Disputes, buyer-initiated cancellations and rating averages are
 * deliberately absent: none of them exist yet, and a figure standing in
 * for missing data is worse than no figure.
 */
export default function BuyerSummary() {
  const { t, i18n } = useTranslation()
  const { id } = useParams()
  const navigate = useNavigate()
  const [summary, setSummary] = useState<BuyerSummaryType | null>(null)
  const [error, setError] = useState<string | null>(null)

  function load() {
    setError(null)
    apiFetch<BuyerSummaryType>(`/profiles/${id}/buyer-summary`)
      .then(setSummary)
      .catch((err) => setError(formatApiError(err)))
  }

  useEffect(load, [id])

  return (
    <div className="ui-page">
      <PageHeader title={t('buyerSummary.title')} onBack={() => navigate(-1)} />

      <div className="ui-page-body">
        {error ? (
          <ErrorState text={error} onRetry={load} />
        ) : !summary ? (
          <SkeletonRows count={4} />
        ) : (
          <StatList
            stats={[
              {
                label: t('buyerSummary.status'),
                value:
                  summary.status === 'established'
                    ? t('buyerSummary.established')
                    : t('buyerSummary.new'),
              },
              {
                label: t('buyerSummary.joinedAt'),
                value: new Date(summary.joined_at).toLocaleDateString(i18n.language),
              },
              {
                label: t('buyerSummary.completedTransactions'),
                value: summary.completed_transactions_count.toLocaleString(i18n.language),
              },
              {
                label: t('buyerSummary.totalStarsSpent'),
                value: <DropAmount amount={summary.total_stars_spent} locale={i18n.language} size={16} />,
              },
            ]}
          />
        )}
      </div>
    </div>
  )
}
