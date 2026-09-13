import { useCallback, useEffect, useState } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { PageHeader } from '../components/ui'
import { apiFetch } from '../lib/api'
import { bankAccounts, financeError, type BankAccount } from '../lib/withdrawalApi'
import { Sheet } from '../components/ui/Sheet'
import { Button, ConfirmDialog, EmptyState, ErrorState, SkeletonRows, useToast } from '../components/ui'
import { IconMore } from '../components/icons'
import { CardNumberField, IbanField } from '../components/finance/BankNumberFields'
import {
  CARD_LENGTH,
  IBAN_DIGIT_LENGTH,
  bankFromCard,
  onlyDigits,
} from '../lib/iranBanking'

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
  const [editing, setEditing] = useState<Draft | null>(null)
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
            holder_name: editing.holder_name.trim(),
            card_number: editing.card,
            // The IR is the field's, not the typist's — see
            // components/finance/BankNumberFields.tsx.
            iban: `IR${editing.iban}`,
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
  const complete =
    !!editing &&
    editing.holder_name.trim().length >= 2 &&
    editing.card.length === CARD_LENGTH &&
    editing.iban.length === IBAN_DIGIT_LENGTH

  return (
    <div className="ui-page">
      <PageHeader title={t('finance.banks')} onBack={() => navigate(back)} />

      <div className="ui-page-body ui-page-body-action">
        {/* Stated before anyone enters an account, not under the list
            where it would read as a footnote to accounts already saved. */}
        <p className="ba-warning">{t('finance.bankWarning')}</p>

        {error && !editing ? (
          <ErrorState text={error} onRetry={load} />
        ) : loading ? (
          <SkeletonRows count={2} />
        ) : rows.length === 0 ? (
          <EmptyState title={t('finance.noBanks')} text={t('finance.noBanksHint')} />
        ) : (
          <div className="bk-cards">
            {rows.map((row) => {
              const bank = bankFromCard(row.card_number)
              return (
                <article className="bk-card" key={row.id}>
                  {/* The one place a card-shaped thing is honest: this
                      IS a card, and the person is looking for theirs
                      among several. It is still the information that
                      does the work — no fake chip, no gradient, no
                      pretend plastic. */}
                  <header className="bk-card-top">
                    <span className="bk-card-bank">
                      {bank ? t('finance.bankName', { name: bank }) : t('finance.banks')}
                    </span>
                    <button
                      type="button"
                      className="ui-btn ui-btn-icon bk-card-manage"
                      disabled={busy}
                      onClick={() => setRemoving(row.id)}
                      aria-label={t('finance.remove')}
                    >
                      <IconMore size={20} />
                    </button>
                  </header>

                  {/* The last four digits, the way a bank shows a saved
                      card — enough to tell two of your own cards apart,
                      and no more of the number on screen than that
                      needs. The whole number is on the edit sheet. */}
                  <button
                    type="button"
                    className="bk-card-number tabular"
                    onClick={() => {
                      setError('')
                      setEditing({
                        id: row.id,
                        holder_name: row.holder_name,
                        card: onlyDigits(row.card_number),
                        iban: onlyDigits(row.iban),
                      })
                    }}
                  >
                    <bdi dir="ltr">•••• •••• •••• {row.card_number.slice(-4)}</bdi>
                  </button>

                  <footer className="bk-card-holder" dir="auto">
                    {row.holder_name}
                  </footer>
                </article>
              )
            })}
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
            setEditing({ holder_name: '', card: '', iban: '' })
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
              disabled={!complete}
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
                value={editing.holder_name}
                maxLength={128}
                onChange={(e) => setEditing({ ...editing, holder_name: e.target.value })}
                placeholder={t('finance.holderPlaceholder')}
                dir="auto"
              />
              {/* The rule that actually gets withdrawals rejected, said
                  next to the field it applies to rather than only in the
                  banner at the top of the page. */}
              <span className="ui-field-help">{t('finance.holderHint')}</span>
            </label>

            <CardNumberField
              value={editing.card}
              onChange={(card) => setEditing({ ...editing, card })}
            />

            <IbanField
              value={editing.iban}
              onChange={(iban) => setEditing({ ...editing, iban })}
            />

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

/**
 * What the sheet is editing. Deliberately not a Partial<BankAccount>:
 * the two numbers are kept as bare digits, and the IBAN's "IR" is added
 * on submit — so there is no state in which the form holds an IBAN
 * without its prefix.
 */
interface Draft {
  id?: number
  holder_name: string
  /** 16 digits, no spaces. */
  card: string
  /** The 24 digits after IR. */
  iban: string
}
