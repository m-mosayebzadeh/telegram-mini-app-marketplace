import { useCallback, useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { apiFetch, formatApiError } from '../lib/api'
import { PageHeader, Button, ErrorState } from '../components/ui'
import { IconChevron, IconDrop } from '../components/icons'
import type { Balance } from '../lib/types'

/**
 * The wallet shows at most TWO figures, on purpose.
 *
 * The backend can tell us five — spendable, earned-but-held, queued for
 * withdrawal, paid-for-a-chat-still-running, and withdrawable. On a phone
 * five labelled amounts in a column read as a spreadsheet and get
 * skipped entirely. Four of them mean one thing to the person looking,
 * "money that exists but is not available right now", so the backend
 * sums those into in_flight_toman and this screen shows them as one
 * line, hidden when it is zero. A buyer who has never sold anything sees
 * a single number.
 *
 * The withdrawal ceiling is deliberately NOT here: it only matters while
 * deciding how much to withdraw, so it lives on the withdraw screen
 * where it is actionable. Per-entry detail stays in the history.
 */
export default function WalletPage() {
  const { t, i18n } = useTranslation()
  const navigate = useNavigate()
  const [balance, setBalance] = useState<Balance | null>(null)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(() => {
    setError(null)
    apiFetch<Balance>('/wallet/balance')
      .then(setBalance)
      .catch((err) => setError(formatApiError(err)))
  }, [])

  useEffect(load, [load])

  const format = (toman: number) => toman.toLocaleString(i18n.language)

  return (
    <div className="ui-page">
      <PageHeader title={t('wallet.title')} onBack={() => navigate(-1)} />

      <div className="ui-page-body">
        {error ? (
          <ErrorState text={error} onRetry={load} />
        ) : (
          <>
            {/* The balance is the one thing this screen exists to show,
                so it is the largest thing on it — not a row in a list of
                equals. */}
            <section className="wl-balance">
              <span className="wl-balance-label">{t('wallet.spendable')}</span>
              {balance ? (
                <>
                  <span className="wl-balance-amount tabular">
                    {t('wallet.tomanAmount', { amount: format(balance.balance_toman) })}
                  </span>
                  <span className="wl-balance-drop tabular">
                    <IconDrop size={18} />
                    {balance.balance_stars_equivalent.toLocaleString(i18n.language)}
                  </span>
                </>
              ) : (
                <>
                  <span className="ui-skeleton wl-skeleton-amount" />
                  <span className="ui-skeleton wl-skeleton-drop" />
                </>
              )}
            </section>

            {/* One line, only when there is something to say. */}
            {balance && balance.in_flight_toman > 0 && (
              <p className="wl-inflight">
                {t('wallet.inFlight', { amount: format(balance.in_flight_toman) })}
              </p>
            )}

            {/* The two money moves come first and full width — they are
                why anyone opens this screen. Top up is primary: it is the
                one that unblocks everything else in the app. */}
            <div className="ui-btn-row wl-actions">
              <Button variant="secondary" size="md" onClick={() => navigate('/wallet/withdraw')}>
                {t('finance.withdraw')}
              </Button>
              <Button variant="primary" size="md" onClick={() => navigate('/wallet/topup')}>
                {t('wallet.topUpButton')}
              </Button>
            </div>

            <div className="ui-list wl-links">
              <button className="ui-row" onClick={() => navigate('/wallet/history')}>
                <span className="ui-row-main">
                  <span className="ui-row-title">{t('finance.history')}</span>
                </span>
                <span className="ui-row-trailing">
                  <IconChevron size={20} className="ui-row-chevron" />
                </span>
              </button>
              <button className="ui-row" onClick={() => navigate('/wallet/banks')}>
                <span className="ui-row-main">
                  <span className="ui-row-title">{t('finance.banks')}</span>
                </span>
                <span className="ui-row-trailing">
                  <IconChevron size={20} className="ui-row-chevron" />
                </span>
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  )
}
