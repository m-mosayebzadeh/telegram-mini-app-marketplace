import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useNavigate } from 'react-router-dom'
import { apiFetch } from '../lib/api'
import { financeError } from '../lib/withdrawalApi'
import { PageHeader } from '../components/ui'
interface Entry {
  id: number
  type: string
  amount_toman: number
  withdrawal_id: number | null
  created_at: string
}
export default function WalletHistory() {
  const { t, i18n } = useTranslation()
  const navigate = useNavigate()
  const [rows, setRows] = useState<Entry[] | null>(null)
  const [error, setError] = useState('')
  useEffect(() => {
    apiFetch<Entry[]>('/wallet/history')
      .then(setRows)
      .catch((e) => setError(financeError(e, t)))
  }, [t])
  return (
    <div className="ui-page finance-page">
      <PageHeader title={t('finance.history')} onBack={() => navigate('/wallet')} />
      {error && (
        <p role="alert" className="hp-error">
          {error}
        </p>
      )}
      {!rows && !error && <p>{t('common.loading')}</p>}
      {rows?.length === 0 && <p>{t('finance.emptyHistory')}</p>}
      {rows?.map((e) => (
        <article className="hp-card finance-card" key={e.id}>
          <strong>{t(`finance.ledger.${e.type}`)}</strong>
          <p>
            <bdi>
              {t('finance.toman', {
                amount: e.amount_toman.toLocaleString(i18n.language),
              })}
            </bdi>
          </p>
          <p>{new Date(e.created_at).toLocaleString(i18n.language)}</p>
          {e.withdrawal_id && (
            <button
              className="hp-btn-sm"
              onClick={() => navigate('/wallet/withdraw')}
            >
              {t('finance.requestNumber', { id: e.withdrawal_id })}
            </button>
          )}
        </article>
      ))}
    </div>
  )
}
