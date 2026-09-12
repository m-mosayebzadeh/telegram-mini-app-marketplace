import { useCallback, useEffect, useState } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { PageHeader } from '../components/ui'
import { apiFetch } from '../lib/api'
import {
  bankAccounts,
  digits,
  financeError,
  type BankAccount,
} from '../lib/withdrawalApi'
import { Sheet } from '../components/ui/Sheet'
import { Button, ConfirmDialog, EmptyState, ErrorState, SkeletonRows, useToast } from '../components/ui'
import { IconMore } from '../components/icons'

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
  const [removing, setRemoving] = useState<number | null>(null)
  const toast = useToast()
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
    setBusy(true)
    try {
      await apiFetch(`/wallet/bank-accounts/${id}`, { method: 'DELETE' })
      setRemoving(null)
      load()
    } catch (e) {
      toast.error(financeError(e, t))
    } finally {
      setBusy(false)
    }
  }
  return (
    <div className="ui-page">
      <PageHeader title={t('finance.banks')} onBack={() => navigate(back)} />

      <div className="ui-page-body ui-page-body-action">
        {/* The warning belongs at the top, before anyone adds an
            account — not under the list where it reads as a footnote to
            accounts already entered. */}
        <p className="ba-warning">{t('finance.bankWarning')}</p>

        {error && !editing ? (
          <ErrorState text={error} onRetry={load} />
        ) : loading ? (
          <SkeletonRows count={2} />
        ) : rows.length === 0 ? (
          <EmptyState title={t('finance.noBanks')} text={t('finance.noBanksHint')} />
        ) : (
          <div className="ui-list">
            {rows.map((row) => (
              <div className="ba-row" key={row.id}>
                <button
                  type="button"
                  className="ui-row ba-row-main"
                  onClick={() => {
                    setError('')
                    setEditing(row)
                  }}
                >
                  <span className="ui-row-main">
                    <span className="ui-row-title" dir="auto">
                      {row.holder_name}
                    </span>
                    {/* Card numbers and IBANs are Latin digits that read
                        left-to-right whichever way the page runs, and
                        are grouped so they can be checked a glance at a
                        time. */}
                    <span className="ui-row-subtitle ba-number tabular">
                      <bdi dir="ltr">{row.card_number.replace(/(.{4})/g, '$1 ').trim()}</bdi>
                    </span>
                    <span className="ui-row-subtitle ba-number tabular">
                      <bdi dir="ltr">{row.iban}</bdi>
                    </span>
                  </span>
                </button>

                <button
                  type="button"
                  className="ui-btn ui-btn-icon ba-manage"
                  disabled={busy}
                  onClick={() => setRemoving(row.id)}
                  aria-label={t('finance.remove')}
                >
                  <IconMore size={20} />
                </button>
              </div>
            ))}
          </div>
        )}
      </div>

      <div className="ui-action-bar">
        <Button
          variant="primary"
          size="lg"
          block
          onClick={() => {
            setError('')
            setEditing({ holder_name: '', card_number: '', iban: 'IR' })
          }}
        >
          {t('finance.addBank')}
        </Button>
      </div>

      {removing != null && (
        <ConfirmDialog
          title={t('finance.remove')}
          text={t('finance.confirmRemove')}
          confirmLabel={t('finance.remove')}
          destructive
          loading={busy}
          onCancel={() => setRemoving(null)}
          onConfirm={() => remove(removing)}
        />
      )}

      {editing && (
        <Sheet
          title={t(editing.id ? 'finance.editBank' : 'finance.addBank')}
          onClose={() => {
            if (!busy) setEditing(null)
          }}
          // A half-entered bank account is worth protecting from a stray
          // tap on the backdrop.
          dismissible={!busy}
          footer={
            <Button
              variant="primary"
              size="lg"
              block
              loading={busy}
              onClick={() => void save()}
            >
              {t('finance.save')}
            </Button>
          }
        >
          <div className="co-form">
            <label className="ui-field" htmlFor="bank-holder">
              <span className="ui-field-label">{t('finance.holder')}</span>
              <input
                id="bank-holder"
                className="ui-input"
                required
                minLength={2}
                maxLength={128}
                value={editing.holder_name || ''}
                onChange={(e) => setEditing({ ...editing, holder_name: e.target.value })}
              />
            </label>

            <label className="ui-field" htmlFor="bank-card">
              <span className="ui-field-label">{t('finance.card')}</span>
              <input
                id="bank-card"
                className="ui-input ui-input-numeric"
                required
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

            <label className="ui-field" htmlFor="bank-iban">
              <span className="ui-field-label">{t('finance.iban')}</span>
              <input
                id="bank-iban"
                className="ui-input ui-input-numeric"
                required
                pattern="IR[0-9]{24}"
                maxLength={26}
                value={editing.iban || ''}
                onChange={(e) =>
                  setEditing({
                    ...editing,
                    iban: digits(e.target.value).replace(/[ -]/g, '').toUpperCase(),
                  })
                }
              />
            </label>

            {error && (
              <p className="ui-field-error" role="alert">
                {error}
              </p>
            )}
          </div>
        </Sheet>
      )}
    </div>
  )
}
