import { useCallback, useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { apiFetch, ApiError } from '../lib/api'
import {
  bankAccounts,
  withdrawals,
  quoteWithdrawal,
  financeError,
  digits,
  type BankAccount,
  type Withdrawal,
  type WithdrawalQuote,
} from '../lib/withdrawalApi'
import {
  FinanceHeader,
  MoneySummary,
  WithdrawalCard,
} from '../components/Finance'

const draftKey = 'withdrawal-draft'
function initialDraft() {
  try {
    return JSON.parse(sessionStorage.getItem(draftKey) || '{}')
  } catch {
    return {}
  }
}
export default function Withdraw() {
  const { t, i18n } = useTranslation()
  const navigate = useNavigate()
  const [draft] = useState(initialDraft)
  const [stars, setStars] = useState<string>(draft.stars || '')
  const [bankId, setBankId] = useState<string>(draft.bankId || '')
  const [retryKey, setRetryKey] = useState<string>(
    draft.retryKey || crypto.randomUUID(),
  )
  const [banks, setBanks] = useState<BankAccount[]>([])
  const [rows, setRows] = useState<Withdrawal[]>([])
  const [quote, setQuote] = useState<WithdrawalQuote | null>(null)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const [loading, setLoading] = useState(true)
  const [notice, setNotice] = useState('')
  useEffect(() => {
    sessionStorage.setItem(
      draftKey,
      JSON.stringify({ stars, bankId, retryKey }),
    )
  }, [stars, bankId, retryKey])
  const load = useCallback(() => {
    Promise.all([bankAccounts(), withdrawals()])
      .then(([b, r]) => {
        setBanks(b)
        setRows(r)
      })
      .catch((e) => setError(financeError(e, t)))
      .finally(() => setLoading(false))
  }, [t])
  useEffect(load, [load])
  function changed() {
    setQuote(null)
    setError('')
    setNotice('')
    setRetryKey(crypto.randomUUID())
  }
  async function preview() {
    setBusy(true)
    setError('')
    setNotice('')
    try {
      setQuote(await quoteWithdrawal(Number(stars)))
    } catch (e) {
      setError(financeError(e, t))
    } finally {
      setBusy(false)
    }
  }
  async function submit() {
    if (!quote) return
    setBusy(true)
    setError('')
    try {
      await apiFetch('/wallet/withdrawals', {
        method: 'POST',
        body: JSON.stringify({
          stars: quote.stars,
          bank_account_id: Number(bankId),
          quote_token: quote.quote_token,
          idempotency_key: retryKey,
        }),
      })
      setQuote(null)
      setStars('')
      setRetryKey(crypto.randomUUID())
      setNotice(t('finance.submitted'))
      load()
    } catch (e) {
      if (e instanceof ApiError) {
        const detail = (
          e.body as { detail?: { reason?: string; quote?: WithdrawalQuote } }
        )?.detail
        if (detail?.reason === 'quote_changed' && detail.quote)
          setQuote(detail.quote)
      }
      setError(financeError(e, t))
    } finally {
      setBusy(false)
    }
  }
  async function cancel(id: number) {
    if (!window.confirm(t('finance.confirmCancel'))) return
    setBusy(true)
    setError('')
    try {
      await apiFetch(`/wallet/withdrawals/${id}/cancel`, { method: 'POST' })
      load()
    } catch (e) {
      setError(financeError(e, t))
      load()
    } finally {
      setBusy(false)
    }
  }
  const selected = banks.find((b) => b.id === Number(bankId))
  const valid =
    /^\d+$/.test(stars) &&
    Number.isSafeInteger(Number(stars)) &&
    Number(stars) > 0 &&
    Number(stars) <= 1_000_000_000 &&
    !!selected
  return (
    <div className="hp-page finance-page">
      <FinanceHeader title={t('finance.withdraw')} />
      <div className="hp-card finance-card">
        <div className="finance-form">
          <label>
            {t('finance.stars')}
            <input
              dir="ltr"
              inputMode="numeric"
              disabled={busy}
              value={stars}
              onChange={(e) => {
                changed()
                setStars(digits(e.target.value))
              }}
            />
          </label>
          <label>
            {t('finance.destination')}
            <select
              disabled={busy}
              value={bankId}
              onChange={(e) => {
                changed()
                setBankId(e.target.value)
              }}
            >
              <option value="">{t('finance.selectBank')}</option>
              {banks.map((b) => (
                <option key={b.id} value={b.id}>
                  {b.holder_name} · {b.card_number.slice(-4)}
                </option>
              ))}
            </select>
          </label>
          <button
            className="hp-btn-sm"
            disabled={busy}
            onClick={() =>
              navigate('/wallet/banks', { state: { from: '/wallet/withdraw' } })
            }
          >
            {t('finance.manageBanks')}
          </button>
          {!quote && (
            <button
              className="hp-btn hp-btn-gradient"
              disabled={!valid || busy}
              onClick={preview}
            >
              {t(busy ? 'common.loading' : 'finance.preview')}
            </button>
          )}
          {quote && (
            <>
              <p>
                {quote.stars} ⭐ ·{' '}
                {t('finance.rate', {
                  amount: quote.star_rate.toLocaleString(i18n.language),
                })}
              </p>
              <MoneySummary quote={quote} />
              <p className="finance-note">
                {t('finance.minimum', {
                  amount: quote.minimum_toman.toLocaleString(i18n.language),
                })}
              </p>
              {/* Only money earned on the platform can be withdrawn, so the
                  ceiling is usually lower than the wallet balance. Saying it
                  here, before the confirm button, is the difference between a
                  clear limit and a rejected request. */}
              <p className="finance-note">
                {t('finance.withdrawableCeiling', {
                  amount: quote.withdrawable_toman.toLocaleString(i18n.language),
                })}
              </p>
              {selected && (
                <p>
                  {selected.holder_name}
                  <br />
                  <bdi dir="ltr">{selected.card_number}</bdi>
                  <br />
                  <bdi dir="ltr">{selected.iban}</bdi>
                </p>
              )}
              <button
                className="hp-btn hp-btn-gradient"
                disabled={
                  busy ||
                  !valid ||
                  quote.gross_toman < quote.minimum_toman ||
                  quote.net_toman <= 0
                }
                onClick={submit}
              >
                {t(busy ? 'common.loading' : 'finance.confirmWithdrawal')}
              </button>
            </>
          )}
          <p className="finance-note">{t('finance.transferTime')}</p>
          {error && (
            <p role="alert" className="hp-error">
              {error}
            </p>
          )}
          {notice && <p role="status">{notice}</p>}
        </div>
      </div>
      <h2>{t('finance.withdrawHistory')}</h2>
      {loading && <p>{t('common.loading')}</p>}
      {!loading && !rows.length && <p>{t('finance.emptyHistory')}</p>}
      {rows.map((row) => (
        <WithdrawalCard key={row.id} row={row}>
          {row.status === 'pending' && (
            <button
              className="hp-btn-sm"
              disabled={busy}
              onClick={() => cancel(row.id)}
            >
              {t('finance.cancel')}
            </button>
          )}
        </WithdrawalCard>
      ))}
    </div>
  )
}
