import { useCallback, useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useMe } from '../lib/MeContext'
import { apiFetch } from '../lib/api'
import {
  financeError,
  type Withdrawal,
  type WithdrawalStatus,
} from '../lib/withdrawalApi'
import { FinanceHeader, WithdrawalCard } from '../components/Finance'
import { Sheet } from '../components/Sheet'
const states: WithdrawalStatus[] = [
  'pending',
  'processing',
  'bank_pending',
  'paid',
  'rejected',
  'failed',
  'cancelled',
]
export default function AdminWithdrawals() {
  const { t } = useTranslation()
  const { me, adminAccess } = useMe()
  const allowed =
    !!adminAccess &&
    (adminAccess.is_owner || adminAccess.scopes.includes('finance.withdrawals'))
  const [filter, setFilter] = useState('pending')
  const [rows, setRows] = useState<Withdrawal[]>([])
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const [loading, setLoading] = useState(true)
  const [review, setReview] = useState<{
    row: Withdrawal
    action: string
  } | null>(null)
  const [reference, setReference] = useState('')
  const [reason, setReason] = useState('')
  const load = useCallback(() => {
    apiFetch<Withdrawal[]>(`/admin/withdrawals?status=${filter}`)
      .then(setRows)
      .catch((e) => setError(financeError(e, t)))
      .finally(() => setLoading(false))
  }, [filter, t])
  useEffect(() => {
    if (allowed) load()
  }, [allowed, load])
  function open(row: Withdrawal, action: string) {
    setError('')
    setReference(row.reference || '')
    setReason('')
    setReview({ row, action })
  }
  async function submit() {
    if (!review) return
    setBusy(true)
    setError('')
    try {
      await apiFetch(`/admin/withdrawals/${review.row.id}/review`, {
        method: 'POST',
        body: JSON.stringify({
          action: review.action,
          reference: reference.trim() || null,
          reason: reason.trim() || null,
        }),
      })
      setReview(null)
      load()
    } catch (e) {
      setError(financeError(e, t))
      load()
    } finally {
      setBusy(false)
    }
  }
  if (!adminAccess) return <p>{t('common.loading')}</p>
  if (!allowed) return <p>{t('admin.noAccess')}</p>
  return (
    <div className="hp-page finance-page">
      <FinanceHeader
        title={t('finance.adminWithdrawals')}
        back="/admin/finance"
      />
      <label className="finance-form">
        {t('finance.statusFilter')}
        <select
          value={filter}
          onChange={(e) => {
            setLoading(true)
            setRows([])
            setFilter(e.target.value)
          }}
        >
          {states.map((s) => (
            <option key={s} value={s}>
              {t(`finance.status.${s}`)}
            </option>
          ))}
        </select>
      </label>
      {error && !review && (
        <p className="hp-error" role="alert">
          {error}
        </p>
      )}
      {loading && <p>{t('common.loading')}</p>}
      {!loading && !rows.length && <p>{t('finance.emptyHistory')}</p>}
      {rows.map((row) => (
        <WithdrawalCard key={row.id} row={row}>
          <p>{t('finance.userNumber', { id: row.user_id })}</p>
          {row.assigned_to_user_id && (
            <p>{t('finance.staffNumber', { id: row.assigned_to_user_id })}</p>
          )}
          <div className="finance-actions">
            {row.status === 'pending' && (
              <>
                <button
                  className="hp-btn-sm"
                  onClick={() => open(row, 'processing')}
                >
                  {t('finance.startReview')}
                </button>
                <button
                  className="hp-btn-sm"
                  onClick={() => open(row, 'rejected')}
                >
                  {t('finance.reject')}
                </button>
              </>
            )}
            {['processing', 'bank_pending'].includes(row.status) &&
              (adminAccess.is_owner || row.assigned_to_user_id === me?.id) && (
                <>
                  <button
                    className="hp-btn-sm"
                    onClick={() => open(row, 'paid')}
                  >
                    {t('finance.markPaid')}
                  </button>
                  {row.status === 'processing' && (
                    <button
                      className="hp-btn-sm"
                      onClick={() => open(row, 'bank_pending')}
                    >
                      {t('finance.markUnknown')}
                    </button>
                  )}
                  <button
                    className="hp-btn-sm"
                    onClick={() => open(row, 'failed')}
                  >
                    {t('finance.markFailed')}
                  </button>
                </>
              )}
          </div>
        </WithdrawalCard>
      ))}
      {review && (
        <Sheet
          title={t(`finance.status.${review.action}`)}
          onClose={() => {
            if (!busy) setReview(null)
          }}
        >
          <div className="finance-form">
            <MoneySummaryForReview row={review.row} />
            {review.action === 'processing' ? (
              <p>{t('finance.claimNotice')}</p>
            ) : (
              <>
                {review.action !== 'rejected' && (
                  <label>
                    {t('finance.reference')}
                    <input
                      value={reference}
                      maxLength={128}
                      onChange={(e) => setReference(e.target.value)}
                    />
                  </label>
                )}
                {review.action !== 'paid' && (
                  <label>
                    {t('finance.reason')}
                    <textarea
                      value={reason}
                      maxLength={500}
                      onChange={(e) => setReason(e.target.value)}
                    />
                  </label>
                )}
                {review.action === 'failed' && (
                  <p className="finance-note">{t('finance.failureWarning')}</p>
                )}
              </>
            )}
            {error && (
              <p role="alert" className="hp-error">
                {error}
              </p>
            )}
            <button
              className="hp-btn hp-btn-gradient"
              disabled={
                busy ||
                (review.action === 'paid' && !reference.trim()) ||
                (['failed', 'rejected', 'bank_pending'].includes(
                  review.action,
                ) &&
                  !reason.trim())
              }
              onClick={submit}
            >
              {t(busy ? 'common.loading' : 'finance.confirm')}
            </button>
          </div>
        </Sheet>
      )}
    </div>
  )
}
function MoneySummaryForReview({ row }: { row: Withdrawal }) {
  const { t, i18n } = useTranslation()
  return (
    <p>
      {row.holder_name}
      <br />
      <bdi dir="ltr">{row.card_number}</bdi>
      <br />
      <bdi dir="ltr">{row.iban}</bdi>
      <br />
      {t('finance.net_toman')}:{' '}
      {t('finance.toman', {
        amount: row.net_toman.toLocaleString(i18n.language),
      })}
    </p>
  )
}
