import { useRef } from 'react'
import { useTranslation } from 'react-i18next'
import { Button } from '../ui/Button'
import { EmptyState, SkeletonRows } from '../ui/States'
import { DropAmountField } from './DropAmountField'
import { IconCamera, IconCopy, IconDrop } from '../icons'
import type { TopUpCardInfo, TopUpRequest } from '../../lib/types'

interface TopUpDirectProps {
  cardInfo: TopUpCardInfo | null
  rate: number | null
  amount: string
  onAmountChange: (digits: string) => void
  receipt: File | null
  previewUrl: string | null
  onPickReceipt: (file: File | null) => void
  onCopyCard: () => void
  onSubmit: () => void
  submitting: boolean
  submitError: string | null
  history: TopUpRequest[] | null
}

/** The three states a submitted receipt can be in, mapped onto the
 *  shared status palette. Pending is neutral: waiting is not a problem. */
const STATUS_TONE = {
  pending: 'ui-status-neutral',
  approved: 'ui-status-success',
  rejected: 'ui-status-danger',
} as const

const STATUS_KEY = {
  pending: 'statusPending',
  approved: 'statusApproved',
  rejected: 'statusRejected',
} as const

/**
 * Card-to-card: the user transfers money themselves and uploads the
 * receipt, an admin reviews it. Nothing here touches the wallet — see
 * backend/app/topup/router.py.
 *
 * It is the first tab because it is the cheapest route, and the trade —
 * cheaper, but it takes an hour — is stated up front rather than
 * discovered after paying.
 */
export function TopUpDirect({
  cardInfo,
  rate,
  amount,
  onAmountChange,
  receipt,
  previewUrl,
  onPickReceipt,
  onCopyCard,
  onSubmit,
  submitting,
  submitError,
  history,
}: TopUpDirectProps) {
  const { t, i18n } = useTranslation()
  const fileInputRef = useRef<HTMLInputElement>(null)

  return (
    <>
      {/* Where the money goes. The number is the only thing anyone
          needs from this block and the only thing they will act on, so
          it is what is large — and the whole row is the copy control,
          because a separate button below it was one more tap for the
          same intent. */}
      <section className="tu-card">
        <span className="tu-card-label">{t('topup.cardNumberLabel')}</span>

        <button
          type="button"
          className="tu-card-copy"
          onClick={onCopyCard}
          disabled={!cardInfo?.card_number}
          aria-label={t('topup.cardCopy')}
        >
          {/* Latin digits reading left-to-right whichever way the page
              runs, grouped in fours so they can be checked against a
              banking app a glance at a time. */}
          <span className="tu-card-number tabular">
            {cardInfo?.card_number ? formatCard(cardInfo.card_number) : '—'}
          </span>
          <IconCopy size={20} />
        </button>

        <span className="tu-card-holder" dir="auto">
          {cardInfo?.card_holder_name || '—'}
        </span>
      </section>

      <section className="ui-section">
        <DropAmountField
          id="topup-direct-amount"
          value={amount}
          onChange={onAmountChange}
          rate={rate}
        />
      </section>

      <section className="ui-section">
        <h2 className="ui-section-title">{t('topup.receiptLabel')}</h2>
        <button
          type="button"
          className={`tu-receipt${previewUrl ? ' tu-receipt-filled' : ''}`}
          onClick={() => fileInputRef.current?.click()}
        >
          {previewUrl ? (
            <>
              <img src={previewUrl} alt="" />
              <span className="tu-receipt-change">{t('topup.changeReceiptFile')}</span>
            </>
          ) : (
            <>
              <IconCamera size={24} />
              <span>{t('topup.chooseReceiptFile')}</span>
            </>
          )}
        </button>
        <input
          ref={fileInputRef}
          type="file"
          accept="image/*"
          hidden
          onChange={(event) => onPickReceipt(event.target.files?.[0] ?? null)}
        />
        {submitError && <p className="ui-field-error tu-submit-error">{submitError}</p>}
      </section>

      <section className="ui-section">
        <h2 className="ui-section-title">{t('topup.historyTitle')}</h2>
        {history === null ? (
          <SkeletonRows count={2} />
        ) : history.length === 0 ? (
          <EmptyState title={t('topup.historyEmpty')} text={t('topup.historyEmptyHint')} />
        ) : (
          <div className="ui-list">
            {history.map((row) => (
              <div className="ui-row" key={row.id}>
                <span className="ui-row-main">
                  <span className="ui-row-title tu-history-amount tabular">
                    <IconDrop size={16} />
                    {row.requested_drops.toLocaleString(i18n.language)}
                    <span className="of-own-dot" aria-hidden="true" />
                    {t('wallet.tomanAmount', {
                      amount: row.requested_toman_amount,
                    })}
                  </span>
                  {row.status === 'approved' && row.final_toman_amount != null && (
                    <span className="ui-row-subtitle">
                      {t('topup.finalAmountLabel')}:{' '}
                      {row.final_toman_amount.toLocaleString(i18n.language)}
                    </span>
                  )}
                  {row.status === 'rejected' && row.rejection_reason && (
                    <span className="ui-row-subtitle">{row.rejection_reason}</span>
                  )}
                </span>
                <span className="ui-row-trailing">
                  <span className={`ui-status ${STATUS_TONE[row.status]}`}>
                    {t(`topup.${STATUS_KEY[row.status]}`)}
                  </span>
                </span>
              </div>
            ))}
          </div>
        )}
      </section>

      <div className="ui-action-bar">
        <Button
          variant="primary"
          size="lg"
          block
          disabled={!receipt || !Number(amount)}
          loading={submitting}
          onClick={onSubmit}
        >
          {t('topup.submitButton')}
        </Button>
      </div>
    </>
  )
}

/** Groups of four, the way a card number is printed and the way anyone
 *  reads one back off a banking app. */
function formatCard(raw: string) {
  return raw.replace(/\D/g, '').replace(/(.{4})/g, '$1 ').trim()
}
