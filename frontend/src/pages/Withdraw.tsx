import { useCallback, useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import {
  PageHeader,
  Button,
  EmptyState,
  SkeletonRows,
  StatList,
} from '../components/ui'
import { DropAmount } from '../components/ui/Drop'
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
    <div className="ui-page">
      <PageHeader title={t('finance.withdraw')} onBack={() => navigate('/wallet')} />

      <div className="ui-page-body">
        <div className="co-form">
          <label className="ui-field" htmlFor="withdraw-amount">
            <span className="ui-field-label">{t('finance.stars')}</span>
            <input
              id="withdraw-amount"
              className="ui-input ui-input-numeric wd-amount"
              inputMode="numeric"
              disabled={busy}
              value={stars}
              onChange={(e) => {
                changed()
                setStars(digits(e.target.value))
              }}
            />
          </label>

          <div className="ui-field">
            <label className="ui-field-label" htmlFor="withdraw-bank">
              {t('finance.destination')}
            </label>
            <select
              id="withdraw-bank"
              className="ui-input wd-select"
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
            <button
              type="button"
              className="wd-manage"
              disabled={busy}
              onClick={() => navigate('/wallet/banks', { state: { from: '/wallet/withdraw' } })}
            >
              {t('finance.manageBanks')}
            </button>
          </div>
        </div>

        {/* Two steps on purpose: nothing is requested until the exact
            figures have been shown and confirmed. The fee comes out of
            the amount, so "how much do I actually receive" has to be
            answered before the decision, not after it. */}
        {quote && (
          <section className="wd-quote">
            <StatList
              stats={[
                {
                  label: t('finance.stars'),
                  value: <DropAmount amount={quote.stars} locale={i18n.language} size={16} />,
                  note: t('finance.rate', {
                    amount: quote.star_rate.toLocaleString(i18n.language),
                  }),
                },
                {
                  label: t('finance.gross_toman'),
                  value: t('finance.toman', {
                    amount: quote.gross_toman.toLocaleString(i18n.language),
                  }),
                },
                {
                  label: `${t('finance.fee_toman')} (${quote.fee_percent}%)`,
                  value: t('finance.toman', {
                    amount: quote.fee_toman.toLocaleString(i18n.language),
                  }),
                },
                {
                  label: t('finance.net_toman'),
                  value: t('finance.toman', {
                    amount: quote.net_toman.toLocaleString(i18n.language),
                  }),
                },
              ]}
            />

            <p className="wd-note">
              {t('finance.minimum', {
                amount: quote.minimum_toman.toLocaleString(i18n.language),
              })}
            </p>
            {/* Only money EARNED on the platform can be withdrawn, so the
                ceiling is usually lower than the wallet balance. Said
                before the confirm button, this is the difference between
                a clear limit and a rejected request. */}
            <p className="wd-note">
              {t('finance.withdrawableCeiling', {
                amount: quote.withdrawable_toman.toLocaleString(i18n.language),
              })}
            </p>

            {selected && (
              <div className="wd-destination">
                <span className="wd-destination-name" dir="auto">
                  {selected.holder_name}
                </span>
                <span className="ba-number tabular">
                  <bdi dir="ltr">{selected.card_number.replace(/(.{4})/g, '$1 ').trim()}</bdi>
                </span>
                <span className="ba-number tabular">
                  <bdi dir="ltr">{selected.iban}</bdi>
                </span>
              </div>
            )}
          </section>
        )}

        <p className="wd-note wd-transfer-time">{t('finance.transferTime')}</p>

        {error && (
          <p className="ui-field-error" role="alert">
            {error}
          </p>
        )}
        {notice && (
          <p className="wd-notice" role="status">
            {notice}
          </p>
        )}

        <section className="ui-section">
          <h2 className="ui-section-title">{t('finance.withdrawHistory')}</h2>
          {loading ? (
            <SkeletonRows count={2} />
          ) : rows.length === 0 ? (
            <EmptyState title={t('finance.emptyHistory')} text={t('finance.emptyWithdrawalsHint')} />
          ) : (
            rows.map((row) => (
              <WithdrawalCard key={row.id} row={row}>
                {row.status === 'pending' && (
                  <Button variant="danger" size="sm" disabled={busy} onClick={() => cancel(row.id)}>
                    {t('finance.cancel')}
                  </Button>
                )}
              </WithdrawalCard>
            ))
          )}
        </section>
      </div>

      {/* One pinned action that changes what it does: preview first,
          then confirm. Two buttons would offer a confirm before there is
          anything to confirm. */}
      <div className="ui-action-bar">
        {quote ? (
          <Button
            variant="primary"
            size="lg"
            block
            loading={busy}
            disabled={!valid || quote.gross_toman < quote.minimum_toman || quote.net_toman <= 0}
            onClick={submit}
          >
            {t('finance.confirmWithdrawal')}
          </Button>
        ) : (
          <Button
            variant="primary"
            size="lg"
            block
            loading={busy}
            disabled={!valid}
            onClick={preview}
          >
            {t('finance.preview')}
          </Button>
        )}
      </div>
    </div>
  )
}
