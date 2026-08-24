import { useEffect, useState } from 'react'
import { useParams } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { Cell, List, Placeholder, Section, Spinner } from '@telegram-apps/telegram-ui'
import { apiFetch, ApiError } from '../lib/api'
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
  const [summary, setSummary] = useState<BuyerSummaryType | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    apiFetch<BuyerSummaryType>(`/profiles/${id}/buyer-summary`)
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

  return (
    <List>
      <Section header={t('buyerSummary.title')}>
        <Cell subtitle={t('buyerSummary.status')}>
          {summary.status === 'established' ? t('buyerSummary.established') : t('buyerSummary.new')}
        </Cell>
        <Cell subtitle={t('buyerSummary.joinedAt')}>{new Date(summary.joined_at).toLocaleDateString()}</Cell>
        <Cell subtitle={t('buyerSummary.completedTransactions')}>{summary.completed_transactions_count}</Cell>
        <Cell subtitle={t('buyerSummary.totalStarsSpent')}>
          {summary.total_stars_spent.toLocaleString('en-US')}
        </Cell>
      </Section>
    </List>
  )
}
