import { useCallback, useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { apiFetch, formatApiError } from '../lib/api'
import type { Balance } from '../lib/types'

/**
 * The wallet screen shows at most TWO figures, on purpose.
 *
 * The backend can tell us five (spendable, earned-but-held, queued for
 * withdrawal, paid-for-a-chat-still-running, and withdrawable), but on a phone
 * five labelled amounts stacked in a column read as a spreadsheet and get
 * skipped entirely. Four of them mean the same thing to the person looking —
 * "money that exists but is not available right now" — so the backend sums
 * those into `in_flight_toman` and this screen shows it as one line, hidden
 * whenever it is zero. A buyer who has never sold anything therefore sees a
 * single number.
 *
 * The withdrawal ceiling is deliberately NOT here: it only matters while
 * deciding how much to withdraw, so it lives on the withdraw screen where it
 * is actionable. The per-entry detail stays in the wallet history.
 */
export default function WalletPage() {
  const { t, i18n } = useTranslation()
  const navigate = useNavigate()
  const [balance, setBalance] = useState<Balance | null>(null)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(() => {
    apiFetch<Balance>('/wallet/balance')
      .then(setBalance)
      .catch((err) => setError(formatApiError(err)))
  }, [])

  useEffect(load, [load])

  // Loading and error use the app's own design system rather than the
  // Telegram UI kit's Placeholder/Spinner, which follow the platform's
  // light/dark theme and clash with this app's fixed dark palette.
  if (error)
    return (
      <div className="hp-page">
        <div className="hp-page-header">{t('wallet.title')}</div>
        <p className="hp-error">{error}</p>
      </div>
    )
  if (!balance)
    return (
      <div className="hp-page">
        <div className="hp-page-header">{t('wallet.title')}</div>
        <p className="hp-empty">{t('common.loading')}</p>
      </div>
    )

  const format = (toman: number) => toman.toLocaleString(i18n.language)

  return (
    <div className="hp-page">
      <div className="hp-page-header">{t('wallet.title')}</div>

      <div className="hp-wallet-card">
        <span className="hp-wallet-card-label">{t('wallet.spendable')}</span>
        <span className="hp-wallet-card-amount">
          {t('wallet.tomanAmount', { amount: format(balance.balance_toman) })}
        </span>
        <span className="hp-wallet-card-secondary">
          {t('wallet.starsApprox', {
            stars: balance.balance_stars_equivalent.toLocaleString(i18n.language),
          })}
        </span>
      </div>

      {/* One line, only when there is something to say. */}
      {balance.in_flight_toman > 0 && (
        <div className="hp-wallet-note">
          <span className="hp-wallet-note-dot" aria-hidden="true" />
          {t('wallet.inFlight', { amount: format(balance.in_flight_toman) })}
        </div>
      )}

      {/* The two money moves come first and full width — they are why anyone
          opens this screen. Everything else is secondary navigation. */}
      <div className="hp-wallet-actions">
        <button
          className="hp-btn hp-btn-gradient"
          onClick={() => navigate('/wallet/topup')}
        >
          {t('wallet.topUpButton')}
        </button>
        <button className="hp-btn hp-btn-outline" onClick={() => navigate('/wallet/withdraw')}>
          {t('finance.withdraw')}
        </button>
      </div>

      <div className="hp-list">
        <button className="hp-list-row" onClick={() => navigate('/wallet/history')}>
          <span className="hp-list-title">{t('finance.history')}</span>
        </button>
        <button className="hp-list-row" onClick={() => navigate('/wallet/banks')}>
          <span className="hp-list-title">{t('finance.banks')}</span>
        </button>
      </div>
    </div>
  )
}
