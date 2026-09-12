import { useTranslation } from 'react-i18next'
import { Button } from '../ui/Button'
import { ProsCons } from './ProsCons'
import { DropAmountField } from './DropAmountField'

interface TopUpStarsProps {
  amount: string
  onAmountChange: (digits: string) => void
  onBuy: () => void
  buying: boolean
  error: string | null
  /** Set once Telegram has taken the payment and we are waiting for the
   *  webhook to confirm it. Until it clears, buying again would create a
   *  second invoice for money already paid. */
  awaitingCredit: boolean
  onCheckNow: () => void
}

/**
 * Telegram Stars, paid through Telegram's own invoice sheet. The only
 * method that credits the wallet automatically, the instant Telegram
 * confirms — see backend/app/telegram_webhook/router.py.
 */
export function TopUpStars({
  amount,
  onAmountChange,
  onBuy,
  buying,
  error,
  awaitingCredit,
  onCheckNow,
}: TopUpStarsProps) {
  const { t } = useTranslation()

  return (
    <>
      <ProsCons pros={[t('topup.starsPro1')]} cons={[t('topup.starsCon1')]} />

      <section className="ui-section">
        <DropAmountField id="topup-stars-amount" value={amount} onChange={onAmountChange} />
      </section>

      {/* Payment has gone through Telegram and we are waiting on the
          webhook. It polls on its own; the button is for someone who
          does not want to wait and watch. */}
      {awaitingCredit && (
        <section className="tu-awaiting" role="status">
          <span className="ui-status ui-status-warning">{t('finance.awaitingCredit')}</span>
          <Button variant="ghost" size="sm" onClick={onCheckNow}>
            {t('finance.checkPayment')}
          </Button>
        </section>
      )}

      {error && <p className="ui-field-error tu-submit-error">{error}</p>}

      <div className="ui-action-bar">
        <Button
          variant="primary"
          size="lg"
          block
          disabled={!Number(amount) || awaitingCredit}
          loading={buying}
          onClick={onBuy}
        >
          {t('topup.buyStarsButton')}
        </Button>
      </div>
    </>
  )
}
