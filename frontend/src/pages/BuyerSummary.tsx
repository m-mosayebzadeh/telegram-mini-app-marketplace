import { useEffect, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { Placeholder, Spinner } from '@telegram-apps/telegram-ui'
import { apiFetch, formatApiError } from '../lib/api'
import { IconArrowNarrowLeft } from '../components/icons'
import type { BuyerSummary as BuyerSummaryType } from '../lib/types'

/** GET /profiles/{id}/buyer-summary — what a provider sees about a
 * buyer before accepting/rejecting their request. Reached from the
 * "buyer summary" action next to each incoming request on
 * OfferDetail.tsx. Disputes, buyer-initiated cancellations, and both
 * rating averages are intentionally absent here — none of those exist
 * yet, see TECHNICAL_REQUIREMENTS.md. */
export default function BuyerSummary() {
  const { t } = useTranslation()
  const { id } = useParams()
  const navigate = useNavigate()
  const [summary, setSummary] = useState<BuyerSummaryType | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    apiFetch<BuyerSummaryType>(`/profiles/${id}/buyer-summary`)
      .then(setSummary)
      .catch((err) => setError(formatApiError(err)))
  }, [id])

  if (error) return <Placeholder header={t('common.error')}>{error}</Placeholder>
  if (!summary) {
    return (
      <Placeholder>
        <Spinner size="l" />
      </Placeholder>
    )
  }

  return (
    <div className="hp-page">
      <div className="hp-page-back-header">
        <button className="hp-chat-back" onClick={() => navigate(-1)} aria-label={t('common.back')}>
          <IconArrowNarrowLeft size={20} />
        </button>
        <span className="hp-page-back-title">{t('buyerSummary.title')}</span>
      </div>

      <div className="hp-card">
        <div className="hp-kv-row">
          <span className="hp-kv-label">{t('buyerSummary.status')}</span>
          <span className="hp-kv-value">
            {summary.status === 'established' ? t('buyerSummary.established') : t('buyerSummary.new')}
          </span>
        </div>
        <div className="hp-kv-row">
          <span className="hp-kv-label">{t('buyerSummary.joinedAt')}</span>
          <span className="hp-kv-value">{new Date(summary.joined_at).toLocaleDateString()}</span>
        </div>
        <div className="hp-kv-row">
          <span className="hp-kv-label">{t('buyerSummary.completedTransactions')}</span>
          <span className="hp-kv-value">{summary.completed_transactions_count}</span>
        </div>
        <div className="hp-kv-row">
          <span className="hp-kv-label">{t('buyerSummary.totalStarsSpent')}</span>
          <span className="hp-kv-value">{summary.total_stars_spent.toLocaleString('en-US')}</span>
        </div>
      </div>
    </div>
  )
}
