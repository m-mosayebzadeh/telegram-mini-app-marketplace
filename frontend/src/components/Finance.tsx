import type { ReactNode } from 'react'
import { useNavigate } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import type { Withdrawal, WithdrawalQuote } from '../lib/withdrawalApi'

export function FinanceHeader({
  title,
  back = '/wallet',
}: {
  title: string
  back?: string
}) {
  const navigate = useNavigate()
  const { t } = useTranslation()
  return (
    <div className="hp-page-back-header">
      <button className="hp-btn-sm" onClick={() => navigate(back)}>
        {t('common.back')}
      </button>
      <h1 className="hp-page-header">{title}</h1>
    </div>
  )
}
export function MoneySummary({
  quote,
}: {
  quote: WithdrawalQuote | Withdrawal
}) {
  const { t, i18n } = useTranslation()
  return (
    <dl className="finance-summary">
      {(['gross_toman', 'fee_toman', 'net_toman'] as const).map((key) => (
        <div key={key}>
          <dt>
            {t(`finance.${key}`)}
            {key === 'fee_toman' ? ` (${quote.fee_percent}%)` : ''}
          </dt>
          <dd>
            {t('finance.toman', {
              amount: quote[key].toLocaleString(i18n.language),
            })}
          </dd>
        </div>
      ))}
    </dl>
  )
}
export function WithdrawalCard({
  row,
  children,
}: {
  row: Withdrawal
  children?: ReactNode
}) {
  const { t, i18n } = useTranslation()
  return (
    <article className="hp-card finance-card">
      <div className="finance-row">
        <strong>{t('finance.requestNumber', { id: row.id })}</strong>
        <span className={`hp-status-pill finance-status-${row.status}`}>
          {t(`finance.status.${row.status}`)}
        </span>
      </div>
      <p>
        {new Date(row.created_at).toLocaleString(i18n.language)} · {row.stars} ⭐
      </p>
      <p>{row.holder_name}</p>
      <p>
        <bdi dir="ltr">{row.card_number.replace(/(.{4})/g, '$1 ')}</bdi>
      </p>
      <p>
        <bdi dir="ltr">{row.iban}</bdi>
      </p>
      <MoneySummary quote={row} />
      {row.reference && (
        <p>
          {t('finance.reference')}: <bdi>{row.reference}</bdi>
        </p>
      )}
      {row.reason && (
        <p>
          {t('finance.reason')}: {row.reason}
        </p>
      )}
      {children}
    </article>
  )
}
