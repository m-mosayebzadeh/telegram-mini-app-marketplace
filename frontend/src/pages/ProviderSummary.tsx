import { useEffect, useState } from 'react'
import { useParams } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { Placeholder, Spinner } from '@telegram-apps/telegram-ui'
import { apiFetch, ApiError } from '../lib/api'
import type { ProviderSummary as ProviderSummaryType } from '../lib/types'

/** GET /profiles/{id}/provider-summary — what a buyer sees about a
 * provider before requesting their offer. Reached from the "provider
 * summary" action on OfferDetail.tsx. Average rating is intentionally
 * absent here — it's still blocked on the (unbuilt) Rating entity, see
 * TECHNICAL_REQUIREMENTS.md. */
export default function ProviderSummary() {
  const { t } = useTranslation()
  const { id } = useParams()
  const [summary, setSummary] = useState<ProviderSummaryType | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    apiFetch<ProviderSummaryType>(`/profiles/${id}/provider-summary`)
      .then(setSummary)
      .catch((err) => setError(err instanceof ApiError ? JSON.stringify(err.body) : String(err)))
  }, [id])

  if (error) return <Placeholder header={t('common.error')}>{error}</Placeholder>
  if (!summary) {
    return (
      <Placeholder>
        <Spinner size="l" />
      </Placeholder>
    )
  }

  const percent = (value: number | null) => (value === null ? '—' : `${Math.round(value * 100)}%`)

  return (
    <div className="hp-page">
      <div className="hp-page-header">{t('providerSummary.title')}</div>

      <div className="hp-card">
        <div className="hp-kv-row">
          <span className="hp-kv-label">{t('providerSummary.status')}</span>
          <span className="hp-kv-value">
            {summary.status === 'established' ? t('providerSummary.established') : t('providerSummary.new')}
          </span>
        </div>
        <div className="hp-kv-row">
          <span className="hp-kv-label">{t('providerSummary.joinedAt')}</span>
          <span className="hp-kv-value">{new Date(summary.joined_at).toLocaleDateString()}</span>
        </div>
        <div className="hp-kv-row">
          <span className="hp-kv-label">{t('providerSummary.completedServices')}</span>
          <span className="hp-kv-value">{summary.completed_services_count}</span>
        </div>
        <div className="hp-kv-row">
          <span className="hp-kv-label">{t('providerSummary.responseRate')}</span>
          <span className="hp-kv-value">{percent(summary.response_rate)}</span>
        </div>
        <div className="hp-kv-row">
          <span className="hp-kv-label">{t('providerSummary.rejectionRate')}</span>
          <span className="hp-kv-value">{percent(summary.rejection_rate)}</span>
        </div>
        <div className="hp-kv-row">
          <span className="hp-kv-label">{t('providerSummary.disputedTransactions')}</span>
          <span className="hp-kv-value">{summary.disputed_transactions_count}</span>
        </div>
      </div>
    </div>
  )
}
