import { useCallback, useEffect, useState } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { apiFetch } from '../lib/api'
import {
  bankAccounts,
  digits,
  financeError,
  type BankAccount,
} from '../lib/withdrawalApi'
import { FinanceHeader } from '../components/Finance'
import { Sheet } from '../components/Sheet'

export default function BankAccounts() {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const location = useLocation()
  const back =
    (location.state as { from?: string } | null)?.from === '/wallet/withdraw'
      ? '/wallet/withdraw'
      : '/wallet'
  const [rows, setRows] = useState<BankAccount[]>([])
  const [loading, setLoading] = useState(true)
  const [editing, setEditing] = useState<Partial<BankAccount> | null>(null)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const load = useCallback(() => {
    bankAccounts()
      .then(setRows)
      .catch((e) => setError(financeError(e, t)))
      .finally(() => setLoading(false))
  }, [t])
  useEffect(load, [load])
  async function save() {
    if (!editing) return
    setBusy(true)
    setError('')
    try {
      await apiFetch(
        `/wallet/bank-accounts${editing.id ? `/${editing.id}` : ''}`,
        {
          method: editing.id ? 'PUT' : 'POST',
          body: JSON.stringify({
            holder_name: editing.holder_name,
            card_number: editing.card_number,
            iban: editing.iban,
          }),
        },
      )
      setEditing(null)
      if (back === '/wallet/withdraw') navigate(back)
      else load()
    } catch (e) {
      setError(financeError(e, t))
    } finally {
      setBusy(false)
    }
  }
  async function remove(id: number) {
    if (!window.confirm(t('finance.confirmRemove'))) return
    setBusy(true)
    try {
      await apiFetch(`/wallet/bank-accounts/${id}`, { method: 'DELETE' })
      load()
    } catch (e) {
      setError(financeError(e, t))
    } finally {
      setBusy(false)
    }
  }
  return (
    <div className="hp-page finance-page">
      <FinanceHeader title={t('finance.banks')} back={back} />
      {error && !editing && (
        <p className="hp-error" role="alert">
          {error}
        </p>
      )}
      <button
        className="hp-btn hp-btn-gradient"
        onClick={() => {
          setError('')
          setEditing({ holder_name: '', card_number: '', iban: 'IR' })
        }}
      >
        {t('finance.addBank')}
      </button>
      <p className="finance-note">{t('finance.bankWarning')}</p>
      {loading ? (
        <p>{t('common.loading')}</p>
      ) : rows.length === 0 ? (
        <p>{t('finance.noBanks')}</p>
      ) : (
        rows.map((row) => (
          <article className="hp-card finance-card" key={row.id}>
            <strong>{row.holder_name}</strong>
            <p>
              <bdi dir="ltr">{row.card_number.replace(/(.{4})/g, '$1 ')}</bdi>
            </p>
            <p>
              <bdi dir="ltr">{row.iban}</bdi>
            </p>
            <div className="finance-actions">
              <button
                className="hp-btn-sm"
                disabled={busy}
                onClick={() => {
                  setError('')
                  setEditing(row)
                }}
              >
                {t('finance.edit')}
              </button>
              <button
                className="hp-btn-sm"
                disabled={busy}
                onClick={() => remove(row.id)}
              >
                {t('finance.remove')}
              </button>
            </div>
          </article>
        ))
      )}
      {editing && (
        <Sheet
          title={t(editing.id ? 'finance.editBank' : 'finance.addBank')}
          onClose={() => {
            if (!busy) setEditing(null)
          }}
        >
          <form
            className="finance-form"
            onSubmit={(e) => {
              e.preventDefault()
              void save()
            }}
          >
            <label>
              {t('finance.holder')}
              <input
                required
                minLength={2}
                maxLength={128}
                value={editing.holder_name || ''}
                onChange={(e) =>
                  setEditing({ ...editing, holder_name: e.target.value })
                }
              />
            </label>
            <label>
              {t('finance.card')}
              <input
                required
                dir="ltr"
                inputMode="numeric"
                pattern="[0-9]{16}"
                maxLength={16}
                value={editing.card_number || ''}
                onChange={(e) =>
                  setEditing({
                    ...editing,
                    card_number: digits(e.target.value).replace(/[ -]/g, ''),
                  })
                }
              />
            </label>
            <label>
              {t('finance.iban')}
              <input
                required
                dir="ltr"
                pattern="IR[0-9]{24}"
                maxLength={26}
                value={editing.iban || ''}
                onChange={(e) =>
                  setEditing({
                    ...editing,
                    iban: digits(e.target.value)
                      .replace(/[ -]/g, '')
                      .toUpperCase(),
                  })
                }
              />
            </label>
            <p className="finance-note">{t('finance.bankWarning')}</p>
            {error && (
              <p className="hp-error" role="alert">
                {error}
              </p>
            )}
            <button className="hp-btn hp-btn-gradient" disabled={busy}>
              {t(busy ? 'common.loading' : 'finance.save')}
            </button>
          </form>
        </Sheet>
      )}
    </div>
  )
}
