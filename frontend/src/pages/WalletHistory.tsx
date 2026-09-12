import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useNavigate } from 'react-router-dom'
import { apiFetch } from '../lib/api'
import { financeError } from '../lib/withdrawalApi'
import { PageHeader, EmptyState, ErrorState, SkeletonRows } from '../components/ui'
import { IconChevron, IconWallet } from '../components/icons'

interface Entry {
  id: number
  type: string
  amount_toman: number
  withdrawal_id: number | null
  created_at: string
}

/**
 * Every movement of money in and out of the wallet, newest first.
 *
 * Each entry is a ROW, not a card: they are a homogeneous list, and a
 * page of boxes makes a ledger harder to scan, not easier. The sign is
 * carried by the amount's own colour and by the leading sign character,
 * so a credit and a debit are told apart without reading either label.
 */
export default function WalletHistory() {
  const { t, i18n } = useTranslation()
  const navigate = useNavigate()
  const [rows, setRows] = useState<Entry[] | null>(null)
  const [error, setError] = useState('')

  function load() {
    setError('')
    apiFetch<Entry[]>('/wallet/history')
      .then(setRows)
      .catch((e) => setError(financeError(e, t)))
  }

  useEffect(load, [t])

  return (
    <div className="ui-page">
      <PageHeader title={t('finance.history')} onBack={() => navigate('/wallet')} />

      <div className="ui-page-body">
        {error ? (
          <ErrorState text={error} onRetry={load} />
        ) : rows === null ? (
          <SkeletonRows count={5} />
        ) : rows.length === 0 ? (
          <EmptyState
            icon={<IconWallet size={24} />}
            title={t('finance.emptyHistory')}
            text={t('finance.emptyHistoryHint')}
          />
        ) : (
          <div className="ui-list">
            {rows.map((entry) => {
              const credit = entry.amount_toman > 0
              return (
                <div className="ui-row" key={entry.id}>
                  <span className="ui-row-main">
                    <span className="ui-row-title">{t(`finance.ledger.${entry.type}`)}</span>
                    <span className="ui-row-subtitle">
                      {new Date(entry.created_at).toLocaleString(i18n.language)}
                    </span>
                  </span>

                  <span className="ui-row-trailing wh-trailing">
                    <span className={`wh-amount tabular${credit ? ' wh-amount-credit' : ''}`}>
                      <bdi>
                        {credit ? '+' : '−'}
                        {t('finance.toman', {
                          amount: Math.abs(entry.amount_toman).toLocaleString(i18n.language),
                        })}
                      </bdi>
                    </span>
                    {/* Only a withdrawal entry has somewhere to go. */}
                    {entry.withdrawal_id && (
                      <button
                        type="button"
                        className="wh-link"
                        onClick={() => navigate('/wallet/withdraw')}
                      >
                        {t('finance.requestNumber', { id: entry.withdrawal_id })}
                        <IconChevron size={16} className="ui-row-chevron" />
                      </button>
                    )}
                  </span>
                </div>
              )
            })}
          </div>
        )}
      </div>
    </div>
  )
}
