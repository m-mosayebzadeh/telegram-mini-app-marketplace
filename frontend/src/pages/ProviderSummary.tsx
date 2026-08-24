import { useEffect, useState } from 'react'
import { useParams } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { Cell, List, Placeholder, Section, Spinner } from '@telegram-apps/telegram-ui'
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
    <List>
      <Section header={t('providerSummary.title')}>
        <Cell subtitle={t('providerSummary.status')}>
          {summary.status === 'established' ? t('providerSummary.established') : t('providerSummary.new')}
        </Cell>
        <Cell subtitle={t('providerSummary.joinedAt')}>
          {new Date(summary.joined_at).toLocaleDateString()}
        </Cell>
        <Cell subtitle={t('providerSummary.completedServices')}>{summary.completed_services_count}</Cell>
        <Cell subtitle={t('providerSummary.responseRate')}>{percent(summary.response_rate)}</Cell>
        <Cell subtitle={t('providerSummary.rejectionRate')}>{percent(summary.rejection_rate)}</Cell>
        <Cell subtitle={t('providerSummary.disputedTransactions')}>{summary.disputed_transactions_count}</Cell>
      </Section>
    </List>
  )
}
