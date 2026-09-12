import type { ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import { DropAmount } from './ui/Drop'
import type { Withdrawal, WithdrawalQuote } from '../lib/withdrawalApi'

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
        {new Date(row.created_at).toLocaleString(i18n.language)} ·{' '}
        <DropAmount amount={row.stars} locale={i18n.language} size={16} />
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
